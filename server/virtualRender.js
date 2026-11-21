// 渲染适配器 seam + 渲染作业 + 配音。浏览器适配器下发指令；服务端接收成片并落库。
// headless 适配器抛 501，未来可替换而不动 DSL/解释器/场景图。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, uid, ASSETS_DIR } from './store.js';
import { stableHash } from './migrations.js';
import { autoVersionForSave } from './versions.js';
import { generateAudio } from './audio.js';

const BAD = (m, s = 422) => Object.assign(new Error(m), { status: s });

class BrowserRenderAdapter {
  async renderScene(scene, options = {}) {
    return {
      mode: 'browser', jobId: `rj_${uid()}`, format: 'webm', status: 'awaiting-browser',
      instructions: {
        width: options.width || 1280, height: options.height || 720,
        fps: options.fps || 30, burnSubtitles: options.burnSubtitles !== false,
        durationSec: options.durationSec || 30,
      },
    };
  }
}
class HeadlessRenderAdapter {
  async renderScene() { throw Object.assign(new Error('headless 渲染尚未启用（MVP 使用浏览器同源导出）'), { status: 501 }); }
}
export function getRenderAdapter(mode = 'browser') {
  return mode === 'headless' ? new HeadlessRenderAdapter() : new BrowserRenderAdapter();
}

export async function createRenderJob(projectId, options = {}) {
  const adapter = getRenderAdapter(options.mode);
  const result = await adapter.renderScene(null, options);
  db.update(d => {
    const p = d.projects.find(x => x.id === projectId);
    if (!p || p.type !== 'virtual') throw BAD('虚拟项目不存在', 404);
    if (!p.virtual.renderJobs) p.virtual.renderJobs = [];
    p.virtual.renderJobs.push({
      id: result.jobId, mode: result.mode, status: result.status,
      options: result.instructions, createdAt: new Date().toISOString(),
    });
  });
  return result;
}

export function getRenderJob(projectId, jobId) {
  const p = db.all().projects.find(x => x.id === projectId);
  if (!p || p.type !== 'virtual') throw BAD('虚拟项目不存在', 404);
  const job = (p.virtual.renderJobs || []).find(j => j.id === jobId);
  if (!job) throw BAD('渲染作业不存在', 404);
  return job;
}

// WebM/Matroska EBML 魔数 1A 45 DF A3。有效成片必须以此开头。
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const MIN_VIDEO_BYTES = 1024;

// 纯函数：校验成片字节是否是有效 WebM 容器。抽出来便于单测与前端口径对齐。
export function validateVideoBuffer(buf, ext = '.webm') {
  if (!buf || !buf.length) return '成片数据为空';
  if (buf.length > 200 * 1024 * 1024) return '成片超过 200MB 上限';
  if (ext === '.webm') {
    if (buf.length < MIN_VIDEO_BYTES) return `成片数据过小（${buf.length} 字节），未产生有效画面，请重新导出`;
    if (!EBML_MAGIC.every((m, i) => buf[i] === m)) return '成片格式无效：不是 WebM 容器，请重新导出';
  }
  return null;
}

export function saveBase64Asset(dataBase64, ext = '.webm', meta = {}) {
  if (!dataBase64 || typeof dataBase64 !== 'string') throw BAD('缺少 dataBase64');
  const buf = Buffer.from(dataBase64, 'base64');
  const invalid = validateVideoBuffer(buf, ext);
  if (invalid) throw BAD(invalid);
  const id = crypto.randomUUID();
  const filename = `virtual-${Date.now()}-${id.slice(0, 8)}${ext}`;
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ASSETS_DIR, filename), buf);
  return { id, url: '/media/' + filename, file: filename, size: buf.length };
}

export function completeRenderJob(projectId, jobId, artifact = {}) {
  const ext = /vp9|vp8/.test(String(artifact.mimeType || '')) || /webm/i.test(String(artifact.mimeType || '')) ? '.webm' : '.webm';
  const saved = saveBase64Asset(artifact.dataBase64, ext, { projectId });
  return db.update(d => {
    const idx = d.projects.findIndex(x => x.id === projectId);
    if (idx < 0 || d.projects[idx].type !== 'virtual') throw BAD('虚拟项目不存在', 404);
    const before = d.projects[idx];
    const after = structuredClone(before);
    const job = (after.virtual.renderJobs || []).find(j => j.id === jobId);
    if (!job) throw BAD('渲染作业不存在', 404);
    job.status = 'succeeded';
    job.finishedAt = new Date().toISOString();
    job.artifact = { url: saved.url, size: saved.size, durationSec: artifact.durationSec || 30 };
    const asset = {
      id: saved.id, type: 'video', name: `虚拟制片成片 ${new Date().toLocaleString()}`,
      bindings: [], url: saved.url, remoteUrl: '', path: saved.url,
      model: 'browser-render', prompt: '虚拟制片浏览器同源导出', projectId,
      taskId: jobId, createdAt: new Date().toISOString(), size: saved.size,
      subtitles: artifact.subtitles || [],
    };
    d.assets.unshift(asset);
    after.revision = (before.revision || 1) + 1;
    after.updatedAt = new Date().toISOString();
    after.versionHash = stableHash(after);
    try { autoVersionForSave(d, before, after); } catch {}
    d.projects[idx] = after;
    return { url: saved.url, size: saved.size, assetId: asset.id, jobId, durationSec: artifact.durationSec };
  });
}

// 逐角色 TTS：把对白按 characterId 分组，各角色用自己的 voiceId 生成音轨。
// stub 模式返回 stub:// 音轨 URL；真实模式每段对白一条音频资产（不承诺跨段音色一致，与 audio.js 口径一致）。
export async function generateVoiceover(projectId, payload = {}) {
  const p = db.all().projects.find(x => x.id === projectId);
  if (!p || p.type !== 'virtual') throw BAD('虚拟项目不存在', 404);
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!lines.length) throw BAD('没有需要配音的对白');
  const dsl = p.virtual?.dsl || {};
  const voiceByChar = Object.fromEntries((dsl.characters || []).map(c => [c.id, c.voiceId]));
  const results = [];
  for (const line of lines.slice(0, 20)) {
    try {
      const r = await generateAudio({
        projectId, scene: 'virtual-voiceover', voice: voiceByChar[line.characterId] || undefined,
        prompt: String(line.text || '').slice(0, 300),
      });
      results.push({ lineId: line.id, characterId: line.characterId, url: r.url, status: r.status });
    } catch (e) { results.push({ lineId: line.id, characterId: line.characterId, error: e.message }); }
  }
  const ok = results.find(r => r.url);
  return { lines: results, url: ok?.url || null, count: results.length };
}
