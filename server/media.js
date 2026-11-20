import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { settings, db, usage, ASSETS_DIR } from './store.js';
import {
  DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_VIDEO_RESOLUTION,
  clampVideoSeconds, normalizeResolution, normalizeImageSize,
  estimateImageCost, estimateVideoCost, videoRate,
} from './models.js';

// 测试环境用 stub provider，保证任何测试都不会真实调用百炼或产生费用。
const STUB_MODELS = process.env.GL_STUB_MODELS === '1';

// 服务端自愈：瞬时网络/5xx 错误有界重试；失败任务由后端自动重提（对齐官方 backend owns retries）。
// 均为保守默认，且只在 stub 模式下可确定性测试；不会让业务错误（4xx）反复重放。
const MAX_TRANSIENT_RETRIES = Math.max(0, Math.min(5, Number(process.env.GL_MAX_TRANSIENT_RETRIES ?? 2)));
const RETRY_BASE_MS = Math.max(50, Math.min(2000, Number(process.env.GL_RETRY_BASE_MS || 400)));
const MAX_TASK_RESUBMITS = Math.max(0, Math.min(3, Number(process.env.GL_MAX_TASK_RESUBMITS ?? 1)));

function isTransient(err) {
  const s = Number(err?.status || 0);
  return s === 0 || s === 408 || s === 429 || s >= 500;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 对瞬时错误做指数退避；确定成功/业务错误立即返回或抛出，不重复副作用。
async function withTransientRetry(fn) {
  let last;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try { return await fn(); }
    catch (err) {
      last = err;
      if (!isTransient(err) || attempt === MAX_TRANSIENT_RETRIES) break;
      await sleep(RETRY_BASE_MS * (2 ** attempt));
    }
  }
  throw last;
}

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
  if (STUB_MODELS) {
    if (pathname.includes('multimodal-generation')) {
      return { output: { choices: [{ message: { content: [{ image: `stub://image/${crypto.randomUUID()}.png` }] } }] } };
    }
    if (pathname.includes('video-synthesis')) return { output: { task_id: `stub-${crypto.randomUUID()}` } };
    return { output: {} };
  }
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

// stub 下可注入一次「远端失败」，用于确定性验证后端自动重提链路。
const stubFailOnce = new Set();
export function stubInjectFailure(taskId) { stubFailOnce.add(String(taskId)); }

async function queryTaskOnce(taskId) {
  if (STUB_MODELS) {
    if (stubFailOnce.has(taskId)) { stubFailOnce.delete(taskId); return { output: { task_status: 'FAILED', message: 'stub 注入的一次性失败' } }; }
    return {
      output: {
        task_status: 'SUCCEEDED',
        results: [{ url: `stub://image/${taskId}.png` }],
        video_url: `stub://video/${taskId}.mp4`,
      },
    };
  }
  const cfg = settings.get();
  const url = apiBase() + '/tasks/' + encodeURIComponent(taskId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw Object.assign(new Error(`查询任务失败 ${res.status}: ${text.slice(0, 200)}`), { status: res.status >= 500 || res.status === 429 ? res.status : 400 });
  return json;
}

async function queryTask(taskId) {
  return withTransientRetry(() => queryTaskOnce(taskId));
}

function extFromUrl(url, fallback) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.[a-zA-Z0-9]{2,5}$/);
    return m ? m[0] : fallback;
  } catch { return fallback; }
}

export async function persist(url, type, meta = {}) {
  const id = crypto.randomUUID();
  const ext = extFromUrl(url, type === 'video' ? '.mp4' : type === 'audio' ? '.mp3' : '.png');
  const filename = `${type}-${Date.now()}-${id.slice(0, 8)}${ext}`;
  const target = path.join(ASSETS_DIR, filename);
  let localPath = null;
  try {
    if (String(url).startsWith('stub:')) throw new Error('stub asset');
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
    name: meta.prompt ? String(meta.prompt).slice(0, 120) : `${type}-${id.slice(0, 8)}`,
    bindings: [],
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

// 计费统一走 models.js：图像按张（生成 + 输入），视频按秒（输出 + 输入视频，按输出分辨率分档）。
function recordUsage(type, model, meta = {}) {
  const cfg = settings.get();
  let detail;
  let cost;
  if (type === 'video') {
    const resolution = normalizeResolution(meta.resolution);
    const seconds = Math.max(0, Number(meta.seconds) || 0);
    const inputSeconds = Math.max(0, Number(meta.inputSeconds) || 0);
    const billable = seconds + inputSeconds;
    const rate = videoRate(cfg, resolution);
    cost = estimateVideoCost(cfg, { seconds, inputSeconds, resolution });
    detail = {
      unitPrice: rate,
      seconds,
      inputSeconds,
      billableSeconds: billable,
      resolution,
      note: `视频按秒计费：${billable}s × ¥${rate.toFixed(3)}/s（${resolution}，含限时折扣）`,
    };
  } else {
    const genCount = meta.genCount ?? meta.count ?? 1;
    const inputCount = meta.inputCount || 0;
    cost = estimateImageCost(cfg, { genCount, inputCount });
    detail = {
      genCount,
      inputCount,
      genUnitPrice: cfg.imageGenPrice,
      inputUnitPrice: cfg.imageInputPrice,
      note: `图像按张计费：生成 ${genCount} 张 × ¥${cfg.imageGenPrice}/张 + 输入 ${inputCount} 张 × ¥${cfg.imageInputPrice}/张`,
    };
  }
  usage.add({
    type,
    model,
    mode: type,
    scope: '',
    taskId: meta.taskId || '',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    detail,
    costOverride: cost,
  });
}

// ---------- 图像 ----------

export async function generateImage(body = {}) {
  const cfg = settings.get();
  const model = body.model || cfg.imageModel || DEFAULT_IMAGE_MODEL;
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw Object.assign(new Error('提示词不能为空。'), { status: 400 });
  const n = Math.max(1, Math.min(6, Number(body.n) || 1));
  // 百炼要求 '<宽>*<高>'，前端历史值用 'x'，统一在这里归一化。
  const size = normalizeImageSize(body.size);
  const parameters = { n, prompt_extend: body.promptExtend !== false, watermark: false };
  if (size) parameters.size = size;
  if (body.negativePrompt) parameters.negative_prompt = body.negativePrompt;

  const localId = crypto.randomUUID();
  const isQwen = model.startsWith('qwen-image');
  // 图生图：支持单张 / 多张输入图，按张计入输入费用。
  const inputImages = Array.isArray(body.inputImages) ? body.inputImages.filter(Boolean)
    : body.imageUrl ? [body.imageUrl] : [];

  if (isQwen) {
    const content = inputImages.map(url => ({ image: url }));
    content.push({ text: prompt });
    const json = await bailian('/services/aigc/multimodal-generation/generation', {
      model,
      input: { messages: [{ role: 'user', content }] },
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
    recordUsage('image', model, { genCount: assets.length, inputCount: inputImages.length, taskId: localId });
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
  const task = {
    id: localId, taskId: remoteTaskId, type: 'image', status: 'pending', model, prompt,
    projectId: body.projectId || '', assets: [], resubmits: 0,
    submit: { path: '/services/aigc/image-generation/generation', body: {
      model, input: { prompt, negative_prompt: body.negativePrompt || '' },
      parameters: { size, n, watermark: false },
    }, headers: { 'X-DashScope-Async': 'enable' } },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.update(d => { d.tasks.unshift(task); });
  return { taskId: remoteTaskId, status: 'pending', model };
}

// ---------- 视频 ----------

export async function generateVideo(body = {}) {
  const cfg = settings.get();
  const model = body.model || cfg.videoModel || DEFAULT_VIDEO_MODEL;
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw Object.assign(new Error('提示词不能为空。'), { status: 400 });

  // 单条最长 30 秒，越界钳制；分辨率默认 480P，仅允许 480P / 720P / 1080P。
  const seconds = clampVideoSeconds(body.duration ?? cfg.videoSeconds, 5);
  const resolution = normalizeResolution(body.resolution || cfg.videoResolution || DEFAULT_VIDEO_RESOLUTION);
  const inputSeconds = Math.max(0, Number(body.inputSeconds) || 0); // 输入视频时长，同样按秒计费

  const parameters = {
    duration: seconds,
    resolution,
    watermark: body.watermark !== false,
  };
  if (body.ratio) parameters.ratio = body.ratio;
  if (body.negativePrompt) parameters.negative_prompt = body.negativePrompt;
  const input = { prompt };
  if (body.imageUrl) input.img_url = body.imageUrl;
  else if (body.firstFrameUrl) input.first_frame_url = body.firstFrameUrl;
  if (body.videoUrl) input.video_url = body.videoUrl;
  if (body.audioUrl) input.audio_url = body.audioUrl;

  const json = await bailian('/services/aigc/video-generation/video-synthesis', {
    model, input, parameters,
  }, { 'X-DashScope-Async': 'enable' });
  const remoteTaskId = json.output?.task_id;
  if (!remoteTaskId) throw Object.assign(new Error('接口未返回 task_id。'), { status: 502 });
  const localId = crypto.randomUUID();
  const task = {
    id: localId, taskId: remoteTaskId, type: 'video', status: 'pending', model, prompt,
    seconds, resolution, inputSeconds, projectId: body.projectId || '', assets: [], resubmits: 0,
    // 任务分流：reel 绑定任务会带 reelId/binding；自由生成任务没有。数据层即可区分。
    ...(body.reelId ? { reelId: String(body.reelId) } : {}),
    ...(body.binding ? { binding: body.binding, bindingStatus: 'pending' } : {}),
    submit: { path: '/services/aigc/video-generation/video-synthesis', body: { model, input, parameters },
      headers: { 'X-DashScope-Async': 'enable' } },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.update(d => { d.tasks.unshift(task); });
  return { taskId: remoteTaskId, status: 'pending', model, seconds, resolution };
}

// ---------- 任务轮询 ----------

const finalizingTasks = new Set();

export async function pollTask(taskId) {
  const task = findTask(taskId);
  if (!task) throw Object.assign(new Error('任务不存在。'), { status: 404 });
  if (task.status === 'succeeded' || task.status === 'failed') {
    const assets = db.all().assets.filter(a => (task.assets || []).includes(a.id));
    return { taskId, status: task.status, url: assets[0]?.url || '', assets, error: task.error || '' };
  }
  // 并发 poll 只允许一个请求 finalize；其余返回 pending，由前端下一轮续查。
  if (finalizingTasks.has(taskId)) return { taskId, status: 'pending', url: '', assets: [], error: '' };

  const providerId = task.remoteTaskId || taskId;
  const json = await queryTask(providerId);
  const out = json.output || {};
  const status = String(out.task_status || '').toUpperCase();
  if (status === 'SUCCEEDED') {
    finalizingTasks.add(taskId);
    try {
      const fresh = findTask(taskId);
      if (fresh?.status === 'succeeded') {
        const assets = db.all().assets.filter(a => (fresh.assets || []).includes(a.id));
        return { taskId, status: 'succeeded', url: assets[0]?.url || '', assets, error: '' };
      }
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
      const usageRecordedAt = new Date().toISOString();
      updateTask(taskId, { status: 'succeeded', assets: assets.map(a => a.id), usageRecordedAt });
      if (!task.usageRecordedAt) {
        if (task.type === 'video') {
          recordUsage('video', task.model, {
            seconds: task.seconds, resolution: task.resolution, inputSeconds: task.inputSeconds, taskId,
          });
        } else {
          recordUsage('image', task.model, { genCount: assets.length, taskId });
        }
      }
      return { taskId, status: 'succeeded', url: assets[0]?.url || '', assets, error: '' };
    } finally {
      finalizingTasks.delete(taskId);
    }
  }
  if (status === 'FAILED') {
    const msg = out.message || out.error_message || '生成失败';

    // 后端自愈：远端任务首次失败时，用保存的 submit 规格自动重提一次。
    // 重提成功后换成新的 remote taskId，前端继续按新 id 轮询；失败次数封顶避免死循环。
    const resubmits = Number(task.resubmits || 0);
    if (resubmits < MAX_TASK_RESUBMITS && task.submit?.path && task.submit?.body) {
      try {
        const again = await withTransientRetry(() => bailian(task.submit.path, task.submit.body, task.submit.headers || {}));
        const newId = again.output?.task_id;
        if (newId) {
          // taskId 对前端保持稳定；只换 provider 侧 id，避免前端轮询落到失效 id 上。
          updateTask(taskId, {
            remoteTaskId: newId, resubmits: resubmits + 1, status: 'pending',
            error: '', lastResubmitReason: String(msg).slice(0, 200), resubmittedAt: new Date().toISOString(),
          });
          return { taskId, status: 'pending', url: '', assets: [], error: '', resubmitted: true };
        }
      } catch { /* 重提失败按原失败处理，下面正常冲正 + 判失败 */ }
    }

    // 失败即冲销：若该任务此前已计费（例如重试链中途曾成功记账），按 taskId 幂等冲正。
    refundTaskCharges(taskId, `任务失败：${msg}`);
    updateTask(taskId, { status: 'failed', error: msg });
    return { taskId, status: 'failed', url: '', assets: [], error: msg };
  }
  return { taskId, status: 'pending', url: '', assets: [], error: '' };
}

// 冲销某任务已记的费用（若有）。收费本就只在成功时发生，这里覆盖重试/补偿等边缘路径。
export function refundTaskCharges(taskId, reason = '任务失败冲销') {
  const charged = db.all().usage.filter(r => r.taskId === taskId && r.kind !== 'refund' && r.cost > 0);
  if (!charged.length) return null;
  const amount = charged.reduce((a, r) => a + (r.cost || 0), 0);
  return usage.refund({
    refundKey: `task:${taskId}`,
    refundOf: charged.map(r => r.id).join(','),
    taskId,
    model: charged[charged.length - 1]?.model || '',
    amount,
    reason,
  });
}

// 手动 / 兜底：允许对已完成任务发起一次幂等冲正（例如资产作废）。
export function refundTask(taskId, reason = '人工冲销') {
  const task = findTask(taskId);
  if (!task) throw Object.assign(new Error('任务不存在。'), { status: 404 });
  const result = refundTaskCharges(taskId, reason);
  if (!result) return { ok: true, created: false, reason: '该任务没有可冲销的费用' };
  return { ok: true, ...result };
}

// 供前端刷新后恢复未完成任务（含 succeeded，便于结果回填）。
export function listTasks(limit = 40) {
  return db.all().tasks.slice(0, Math.max(1, Math.min(200, Number(limit) || 40)));
}

export function listAssets(type) {
  const all = db.all().assets;
  return type ? all.filter(a => a.type === type) : all;
}

export function removeAsset(id) {
  db.update(d => { d.assets = d.assets.filter(a => a.id !== id); });
  return { ok: true };
}
