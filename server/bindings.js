// 资产 → 项目实体绑定：槽位写入与反向索引在同一次 db.update 中完成。
import { db, uid } from './store.js';
import { stableHash } from './migrations.js';
import { autoVersionForSave } from './versions.js';

const ENTITY_GROUPS = {
  character: 'characters',
  location: 'locations',
  prop: 'props',
};
const ALLOWED_SLOTS = {
  project: ['posterImage', 'asset', 'background'],
  character: ['lookImage', 'posterImage', 'voiceRef', 'model'],
  location: ['lookImage', 'posterImage'],
  prop: ['lookImage', 'posterImage', 'model'],
  knowledge: ['image'],
  scene: ['backgroundImage', 'posterImage', 'environment'],
  shot: ['refImage', 'storyboardImage'],
};

const clone = v => JSON.parse(JSON.stringify(v));
const bad = (message, status = 422) => Object.assign(new Error(message), { status });
const notFound = (message = 'not found') => Object.assign(new Error(message), { status: 404 });

export function normalizeBinding(raw = {}) {
  const kind = String(raw.kind || '');
  if (!ALLOWED_SLOTS[kind]) throw bad(`不支持的绑定类型：${kind || '空'}`);
  const slot = String(raw.slot || 'asset');
  if (!ALLOWED_SLOTS[kind].includes(slot)) throw bad(`类型 ${kind} 不支持槽位 ${slot}`);
  const projectId = String(raw.projectId || '');
  if (!projectId) throw bad('缺少 projectId');
  const episodeId = raw.episodeId ? String(raw.episodeId) : '';
  const entityId = raw.entityId ? String(raw.entityId) : projectId;
  const side = raw.side ? String(raw.side) : '';
  return { kind, projectId, entityId, episodeId, slot, side };
}

export function bindingKey(b) {
  return [b.kind, b.projectId, b.entityId, b.episodeId, b.slot, b.side].join('|');
}

function findProject(d, projectId) {
  const p = d.projects.find(x => x.id === projectId);
  if (!p) throw notFound('项目不存在');
  return p;
}

function locateTarget(project, b) {
  if (b.kind === 'project') return project;
  if (b.kind === 'knowledge') {
    const item = (project.knowledge || []).find(x => x.id === b.entityId);
    if (!item) throw notFound('知识条目不存在');
    return item;
  }
  const group = ENTITY_GROUPS[b.kind];
  if (group) {
    const item = (project[group] || []).find(x => x.id === b.entityId);
    if (!item) throw notFound('实体不存在');
    return item;
  }
  const episode = b.episodeId
    ? (project.episodes || []).find(e => e.id === b.episodeId)
    : (project.episodes || [])[0];
  if (!episode) throw notFound('剧集不存在');
  const collection = b.kind === 'scene' ? 'scenes' : 'shots';
  const item = (episode[collection] || []).find(x => x.id === b.entityId);
  if (!item) throw notFound('场景/镜头不存在');
  return item;
}

export function assetRef(asset, note = '') {
  return {
    assetId: asset.id,
    url: asset.url,
    name: asset.name || asset.prompt || asset.model || '素材',
    note,
  };
}

function setSlot(target, slot, ref) {
  if (slot !== 'asset') target[slot] = ref;
}

function clearSlot(target, slot) {
  if (slot !== 'asset') delete target[slot];
}

function bumpProject(d, projectId, before) {
  const p = findProject(d, projectId);
  p.revision = Number(p.revision || 1) + 1;
  p.updatedAt = new Date().toISOString();
  p.versionHash = stableHash(p);
  autoVersionForSave(d, before, p);
  return p;
}

function removeBindingFromAll(d, key) {
  for (const asset of d.assets) {
    asset.bindings = (asset.bindings || []).filter(b => bindingKey(b) !== key);
  }
}

export function applyBinding(d, asset, binding, note = '') {
  const normalized = normalizeBinding(binding);
  if (!asset.bindings) asset.bindings = [];
  const project = findProject(d, normalized.projectId);
  const target = locateTarget(project, normalized);
  const key = bindingKey(normalized);

  removeBindingFromAll(d, key);
  if (!asset.bindings.some(b => bindingKey(b) === key)) asset.bindings.push(normalized);
  const ref = assetRef(asset, note);
  setSlot(target, normalized.slot, ref);
  return { ref, project };
}

export function removeBinding(d, assetId, binding) {
  const normalized = normalizeBinding(binding);
  const asset = d.assets.find(a => a.id === assetId);
  if (!asset) throw notFound('素材不存在');
  const project = findProject(d, normalized.projectId);
  const key = bindingKey(normalized);
  const had = (asset.bindings || []).some(b => bindingKey(b) === key);
  asset.bindings = (asset.bindings || []).filter(b => bindingKey(b) !== key);
  const stillBound = d.assets.some(a => (a.bindings || []).some(b => bindingKey(b) === key));
  if (had && !stillBound) {
    const target = locateTarget(project, normalized);
    clearSlot(target, normalized.slot);
  }
  return project;
}

export function bindAsset(assetId, binding, note = '') {
  return db.update(d => {
    const asset = d.assets.find(a => a.id === assetId);
    if (!asset) throw notFound('素材不存在');
    const normalized = normalizeBinding(binding);
    const project = findProject(d, normalized.projectId);
    const before = clone(project);
    const result = applyBinding(d, asset, normalized, note);
    bumpProject(d, normalized.projectId, before);
    return { ref: result.ref, asset, project: findProject(d, normalized.projectId) };
  });
}

export function unbindAsset(assetId, binding) {
  return db.update(d => {
    const normalized = normalizeBinding(binding);
    const project = findProject(d, normalized.projectId);
    const before = clone(project);
    removeBinding(d, assetId, normalized);
    bumpProject(d, normalized.projectId, before);
    return { ok: true };
  });
}

export function listProjectAssets(projectId) {
  const d = db.all();
  findProject(d, projectId);
  return d.assets
    .filter(a => a.projectId === projectId || (a.bindings || []).some(b => b.projectId === projectId))
    .map(a => ({
      ...a,
      bindings: (a.bindings || []).filter(b => b.projectId === projectId),
    }));
}

// 上传时在同一事务里落资产与可选绑定，避免“文件写了一半、项目没关联”。
export function recordUploadedAsset(meta, binding) {
  return db.update(d => {
    const asset = { id: uid(), bindings: [], ...meta };
    const before = binding ? clone(findProject(d, binding.projectId)) : null;
    d.assets.unshift(asset);
    if (binding) {
      applyBinding(d, asset, binding);
      bumpProject(d, binding.projectId, before);
    }
    return asset;
  });
}
