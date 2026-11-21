// 虚拟制片资产层：模型目录加载、GLB URL 白名单、路径穿越防护、controls 钳制、资产绑定。
import fs from 'node:fs';
import path from 'node:path';
import { db, ROOT } from './store.js';

const CATALOG_PATH = path.join(ROOT, 'public', 'models', 'catalog.json');
const BAD = (message, status = 422) => Object.assign(new Error(message), { status });
let catalogCache = null;

// 内置细胞器模板的白名单兜底（catalog.json 未生成 GLB 前也能跑通校验）。
function templateFallbackCatalog() {
  return {
    version: 0, fallback: true, models: [
      { id: 'nucleus', glb: '/models/nucleus.glb', license: 'Apache-2.0', source: 'polyspoon', runtimeControls: ['color', 'emissive', 'scale', 'rotationY', 'visible'] },
      { id: 'mitochondrion', glb: '/models/mitochondrion.glb', license: 'Apache-2.0', source: 'polyspoon', runtimeControls: ['color', 'emissive', 'scale', 'rotationY', 'visible'] },
    ],
  };
}

export function loadCatalog({ refresh = false } = {}) {
  if (catalogCache && !refresh) return catalogCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    if (!Array.isArray(parsed.models)) throw new Error('models 必须是数组');
    catalogCache = parsed;
  } catch {
    catalogCache = templateFallbackCatalog();
  }
  return catalogCache;
}

// 仅允许同源 /models/* 与 /media/*，拒绝 .. 与协议/域名，防路径穿越与 SSRF。
export function isSafeModelUrl(url) {
  if (typeof url !== 'string') return false;
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith('//')) return false;
  if (url.includes('..') || url.includes('\\') || url.includes('%')) return false;
  return url.startsWith('/models/') || url.startsWith('/media/');
}

export function resolveModel(url, catalog = loadCatalog()) {
  if (!isSafeModelUrl(url)) throw BAD(`不允许的模型 URL（须为同源 /models/* 或 /media/*）：${url}`);
  const item = (catalog.models || []).find(m => m.glb === url || m.fallbackUrl === url);
  // /media/* 是生成/上传的资产，允许但不在静态目录清单中。
  return {
    url,
    catalogItem: item || null,
    license: item?.license || (url.startsWith('/media/') ? 'user-generated' : 'unknown'),
    controls: item?.runtimeControls || ['color', 'emissive', 'scale', 'rotationY', 'visible'],
  };
}

// 把 controls 收敛到白名单键与合法范围（服务端再校验一次，防前端绕过）。
export function clampControls(controls, item = null) {
  const out = {};
  if (!controls || typeof controls !== 'object') return out;
  const allowed = new Set(item?.runtimeControls || ['color', 'emissive', 'emissiveIntensity', 'scale', 'rotationY', 'visible']);
  for (const [k, v] of Object.entries(controls)) {
    if (!allowed.has(k)) continue;
    if ((k === 'color' || k === 'emissive') && /^#[0-9a-fA-F]{3,8}$/.test(String(v))) out[k] = String(v);
    else if (k === 'emissiveIntensity') { const n = Number(v); if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(5, n)); }
    else if (k === 'scale') { const n = Number(v); if (Number.isFinite(n)) out[k] = Math.max(0.05, Math.min(20, n)); }
    else if (k === 'rotationY') { const n = Number(v); if (Number.isFinite(n)) out[k] = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, n)); }
    else if (k === 'visible') out[k] = Boolean(v);
  }
  return out;
}

// 供 DSL 校验使用的 registry：把 catalog URL 作为白名单。
export function virtualRegistry() {
  const catalog = loadCatalog();
  const allowedUrls = [];
  for (const m of catalog.models || []) { if (m.glb) allowedUrls.push(m.glb); if (m.fallbackUrl) allowedUrls.push(m.fallbackUrl); }
  // 模板默认 URL 也纳入，保证内置案例可校验。
  allowedUrls.push('/models/nucleus.glb', '/models/mitochondrion.glb', '/media/bg-cell.png');
  return {
    allowedUrls: [...new Set(allowedUrls)],
    assets: (catalog.models || []).map(m => ({ id: m.id, kind: 'character', source: m.source })),
    voices: ['voice-narrator', 'voice-mito'],
  };
}

// 列出 virtual 项目可用资产：静态目录模型 + 项目已生成/上传资产。
export function listVirtualAssets(projectId) {
  const catalog = loadCatalog();
  const p = db.all().projects.find(x => x.id === projectId);
  const generated = p ? db.all().assets.filter(a => a.projectId === projectId || (a.bindings || []).some(b => b.projectId === projectId)) : [];
  return {
    models: catalog.models || [],
    generated: generated.map(a => ({ id: a.id, url: a.url, type: a.type, name: a.name || a.prompt, taskId: a.taskId })),
    fallback: catalog.fallback === true,
  };
}

// 把生成/上传的资产绑定到 virtual 项目背景槽（project.background），供 DSL environment 引用。
export function bindVirtualBackground(projectId, assetId) {
  return db.update(d => {
    const p = d.projects.find(x => x.id === projectId);
    if (!p || p.type !== 'virtual') throw BAD('虚拟项目不存在', 404);
    const asset = d.assets.find(a => a.id === assetId);
    if (!asset) throw BAD('资产不存在', 404);
    const before = structuredClone(p);
    if (!p.virtual.assets) p.virtual.assets = {};
    p.virtual.assets.background = { assetId: asset.id, url: asset.url, name: asset.name || asset.prompt || '背景' };
    if (!p.virtual.assets.bindings) p.virtual.assets.bindings = [];
    if (!p.virtual.assets.bindings.some(b => b.assetId === asset.id && b.slot === 'background')) {
      p.virtual.assets.bindings.push({ assetId: asset.id, slot: 'background', url: asset.url });
    }
    p.updatedAt = new Date().toISOString();
    p.revision = (p.revision || 1) + 1;
    void before;
    return { project: p, ref: p.virtual.assets.background };
  });
}
