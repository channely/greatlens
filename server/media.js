import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { settings, db, usage, ASSETS_DIR } from './store.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function authHeaders() {
  const cfg = settings.get();
  if (!cfg.apiKey) throw Object.assign(new Error('尚未配置百炼 API Key。'), { status: 428 });
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  };
}

function apiBase() {
  const cfg = settings.get();
  return (cfg.mediaBaseUrl || 'https://dashscope.aliyuncs.com/api/v1').replace(/\/$/, '');
}

async function bailian(pathname, body, headers = {}) {
  const url = apiBase() + pathname;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(), ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json.code) {
    const msg = json.message || json.error?.message || text.slice(0, 300);
    throw Object.assign(new Error(`百炼接口错误 ${json.code || res.status}: ${msg}`), { status: 502 });
  }
  return json;
}

async function queryTask(taskId) {
  const cfg = settings.get();
  const url = apiBase() + '/tasks/' + encodeURIComponent(taskId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(`查询任务失败 ${res.status}: ${text.slice(0, 200)}`), { status: 502 });
  return json;
}

function extFromUrl(url, fallback) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.[a-zA-Z0-9]{2,5}$/);
    return m ? m[0] : fallback;
  } catch { return fallback; }
}

async function persist(url, type, meta = {}) {
  const id = crypto.randomUUID();
  const ext = extFromUrl(url, type === 'video' ? '.mp4' : '.png');
  const filename = `${type}-${Date.now()}-${id.slice(0, 8)}${ext}`;
  const target = path.join(ASSETS_DIR, filename);
  let localPath = null;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(target, buf);
      localPath = '/media/' + filename;
    }
  } catch { /* 远端 URL 仍保留，24h 内可用 */ }
  const asset = {
    id,
    type,
    url: localPath || url,
    remoteUrl: url,
    path: localPath || '',
    model: meta.model || '',
    prompt: meta.prompt || '',
    projectId: meta.projectId || '',
    taskId: meta.taskId || '',
    createdAt: new Date().toISOString(),
    size: fs.existsSync(target) ? fs.statSync(target).size : 0,
  };
  db.update(d => { d.assets.unshift(asset); });
  return asset;
}

function updateTask(taskId, patch) {
  return db.update(d => {
    const t = d.tasks.find(x => x.taskId === taskId || x.id === taskId);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: new Date().toISOString() });
    return t;
  });
}

function findTask(taskId) {
  return db.all().tasks.find(x => x.taskId === taskId || x.id === taskId);
}

function recordUsage(type, model, meta) {
  const cfg = settings.get();
  const priceKey = type === 'video' ? 'videoUnitPrice' : 'imageUnitPrice';
  const unit = Number(cfg[priceKey] ?? (type === 'video' ? 0.5 : 0.2)) || 0;
  const count = meta.count || 1;
  usage.add({
    type,
    model,
    mode: type,
    scope: '',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    detail: { unitPrice: unit, count, note: '按次计费，非 token' },
    costOverride: Math.round(unit * count * 1e4) / 1e4,
  });
}

// ---------- 图像 ----------

export async function generateImage(body = {}) {
  const cfg = settings.get();
  const model = body.model || cfg.imageModel || 'qwen-image-3.0-pro';
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw Object.assign(new Error('提示词不能为空。'), { status: 400 });
  const n = Math.max(1, Math.min(6, Number(body.n) || 1));
  const size = body.size || '1024*1024';
  const parameters = { n, prompt_extend: body.promptExtend !== false, watermark: false };
  if (size) parameters.size = size;
  if (body.negativePrompt) parameters.negative_prompt = body.negativePrompt;

  const localId = crypto.randomUUID();
  const isQwen = model.startsWith('qwen-image');
  const isWan25 = model.startsWith('wan2.5') || model.startsWith('wanx');

  if (isQwen) {
    const json = await bailian('/services/aigc/multimodal-generation/generation', {
      model,
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters,
    });
    const contents = json.output?.choices?.[0]?.message?.content || [];
    const urls = contents.map(c => c.image).filter(Boolean);
    if (!urls.length) throw Object.assign(new Error('接口未返回图像 URL。'), { status: 502 });
    const assets = [];
    for (const u of urls.slice(0, n)) {
      assets.push(await persist(u, 'image', { model, prompt, projectId: body.projectId, taskId: localId }));
    }
    const task = { id: localId, taskId: localId, type: 'image', status: 'succeeded', model, prompt, assets: assets.map(a => a.id), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.update(d => { d.tasks.unshift(task); });
    recordUsage('image', model, { count: assets.length });
    return { taskId: localId, status: 'succeeded', model, assets };
  }

  // 万相系列：异步任务
  const json = await bailian('/services/aigc/image-generation/generation', {
    model,
    input: { prompt, negative_prompt: body.negativePrompt || '' },
    parameters: { size, n, watermark: false },
  }, { 'X-DashScope-Async': 'enable' });
  const remoteTaskId = json.output?.task_id;
  if (!remoteTaskId) throw Object.assign(new Error('接口未返回 task_id。'), { status: 502 });
  const task = { id: localId, taskId: remoteTaskId, type: 'image', status: 'pending', model, prompt, projectId: body.projectId || '', assets: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.update(d => { d.tasks.unshift(task); });
  return { taskId: remoteTaskId, status: 'pending', model };
}

// ---------- 视频 ----------

export async function generateVideo(body = {}) {
  const cfg = settings.get();
  const model = body.model || cfg.videoModel || 'wan2.7-t2v';
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw Object.assign(new Error('提示词不能为空。'), { status: 400 });

  const parameters = {
    duration: Number(body.duration) || 5,
    resolution: body.resolution || '720P',
    watermark: body.watermark !== false,
  };
  if (body.ratio) parameters.ratio = body.ratio;
  if (body.negativePrompt) parameters.negative_prompt = body.negativePrompt;
  const input = { prompt };
  if (body.imageUrl) input.img_url = body.imageUrl;
  else if (body.firstFrameUrl) input.first_frame_url = body.firstFrameUrl;

  const json = await bailian('/services/aigc/video-generation/video-synthesis', {
    model, input, parameters,
  }, { 'X-DashScope-Async': 'enable' });
  const remoteTaskId = json.output?.task_id;
  if (!remoteTaskId) throw Object.assign(new Error('接口未返回 task_id。'), { status: 502 });
  const localId = crypto.randomUUID();
  const task = { id: localId, taskId: remoteTaskId, type: 'video', status: 'pending', model, prompt, projectId: body.projectId || '', assets: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.update(d => { d.tasks.unshift(task); });
  return { taskId: remoteTaskId, status: 'pending', model };
}

// ---------- 任务轮询 ----------

export async function pollTask(taskId) {
  const task = findTask(taskId);
  if (!task) throw Object.assign(new Error('任务不存在。'), { status: 404 });
  if (task.status === 'succeeded' || task.status === 'failed') {
    const assets = db.all().assets.filter(a => (task.assets || []).includes(a.id));
    return { taskId, status: task.status, url: assets[0]?.url || '', assets, error: task.error || '' };
  }

  const json = await queryTask(taskId);
  const out = json.output || {};
  const status = String(out.task_status || '').toUpperCase();
  if (status === 'SUCCEEDED') {
    let urls = [];
    if (task.type === 'video') {
      if (out.video_url) urls = [out.video_url];
    } else {
      urls = (out.results || []).map(r => r.url).filter(Boolean);
    }
    const assets = [];
    for (const u of urls) {
      assets.push(await persist(u, task.type, { model: task.model, prompt: task.prompt, projectId: task.projectId, taskId }));
    }
    updateTask(taskId, { status: 'succeeded', assets: assets.map(a => a.id) });
    recordUsage(task.type, task.model, { count: assets.length });
    return { taskId, status: 'succeeded', url: assets[0]?.url || '', assets, error: '' };
  }
  if (status === 'FAILED') {
    const msg = out.message || out.error_message || '生成失败';
    updateTask(taskId, { status: 'failed', error: msg });
    return { taskId, status: 'failed', url: '', assets: [], error: msg };
  }
  return { taskId, status: 'pending', url: '', assets: [], error: '' };
}

export function listAssets(type) {
  const all = db.all().assets;
  return type ? all.filter(a => a.type === type) : all;
}

export function removeAsset(id) {
  db.update(d => { d.assets = d.assets.filter(a => a.id !== id); });
  return { ok: true };
}
