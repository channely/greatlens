// 数据迁移与稳定 hash。
// 目标：旧库可重复升级；语义节点获得稳定 ID；版本 hash 排除易变字段。
import crypto from 'node:crypto';

export const CURRENT_SCHEMA_VERSION = 1;
const uid = () => crypto.randomUUID();

const VOLATILE_KEYS = new Set(['updatedAt', 'revision', 'versionHash', 'viewLayouts', 'lastSavedAt']);

function stableValue(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map(stableValue);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (VOLATILE_KEYS.has(key)) continue;
    out[key] = stableValue(value[key]);
  }
  return out;
}

export function stableHash(project) {
  const json = JSON.stringify(stableValue(project || {}));
  return crypto.createHash('sha256').update(json).digest('hex');
}

function normalizeEntity(value) {
  if (typeof value === 'string') return { id: uid(), name: value };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out = { ...value };
    if (!out.id) out.id = uid();
    if (out.name === undefined && out.title !== undefined) out.name = out.title;
    if (out.name === undefined) out.name = '';
    return out;
  }
  return { id: uid(), name: '' };
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const out = { ...item };
      if (!out.id) out.id = uid();
      return out;
    }
    return { id: uid(), text: String(item ?? '') };
  });
}

function normalizeProject(project) {
  const p = project && typeof project === 'object' && !Array.isArray(project)
    ? project
    : { id: uid(), name: '未命名项目' };

  p.schemaVersion = CURRENT_SCHEMA_VERSION;
  if (!Number.isInteger(p.revision) || p.revision < 1) p.revision = 1;
  if (typeof p.versionHash !== 'string') p.versionHash = '';
  if (!p.cover || typeof p.cover !== 'object' || Array.isArray(p.cover)) p.cover = {};
  if (!p.viewLayouts || typeof p.viewLayouts !== 'object' || Array.isArray(p.viewLayouts)) p.viewLayouts = {};
  if (!Array.isArray(p.audioSessions)) p.audioSessions = [];

  for (const key of ['characters', 'locations', 'props']) {
    p[key] = (Array.isArray(p[key]) ? p[key] : []).map(normalizeEntity);
  }
  if (!Array.isArray(p.relationships)) p.relationships = [];
  if (!Array.isArray(p.knowledge)) p.knowledge = [];
  if (!Array.isArray(p.assets)) p.assets = [];
  if (!p.settings || typeof p.settings !== 'object' || Array.isArray(p.settings)) {
    p.settings = { format: 'hollywood', language: 'zh', exportConvention: 'hollywood' };
  }

  const episodes = Array.isArray(p.episodes) ? p.episodes : [];
  for (const ep of episodes) {
    if (!ep || typeof ep !== 'object') continue;
    if (!ep.id) ep.id = uid();
    for (const key of ['nodes', 'outline', 'beats', 'scenes', 'shots', 'reels']) {
      if (ep[key] !== undefined) ep[key] = normalizeItems(ep[key]);
    }
    if (!Array.isArray(ep.revisionNotes)) ep.revisionNotes = [];
    if (!Array.isArray(ep.optionGroups)) ep.optionGroups = [];
  }
  p.episodes = episodes;

  // virtual 项目：科普叙事导演台数据。幂等补字段，不覆盖已有内容（DSL 是事实来源）。
  if (p.type === 'virtual') {
    if (!p.virtual || typeof p.virtual !== 'object' || Array.isArray(p.virtual)) p.virtual = {};
    const v = p.virtual;
    if (v.dsl !== null && (typeof v.dsl !== 'object' || Array.isArray(v.dsl))) v.dsl = null;
    if (!v.compiled || typeof v.compiled !== 'object' || Array.isArray(v.compiled)) v.compiled = {};
    if (typeof v.compiled.hash !== 'string') v.compiled.hash = '';
    if (typeof v.compiled.dslHash !== 'string') v.compiled.dslHash = '';
    if (!Array.isArray(v.compiled.diagnostics)) v.compiled.diagnostics = [];
    if (v.compiled.scenePlan === undefined) v.compiled.scenePlan = null;
    if (v.compiled.timeline === undefined) v.compiled.timeline = null;
    if (typeof v.compiled.compiledAt !== 'string') v.compiled.compiledAt = '';
    if (!v.assets || typeof v.assets !== 'object' || Array.isArray(v.assets)) v.assets = {};
    if (typeof v.assets.registryId !== 'string') v.assets.registryId = 'default';
    if (!Array.isArray(v.assets.bindings)) v.assets.bindings = [];
    if (!v.knowledgeState || typeof v.knowledgeState !== 'object' || Array.isArray(v.knowledgeState)) v.knowledgeState = {};
    if (!Array.isArray(v.knowledgeState.facts)) v.knowledgeState.facts = [];
    if (!Array.isArray(v.knowledgeState.transitions)) v.knowledgeState.transitions = [];
    for (const key of ['ipLocks', 'workflowRuns', 'renderJobs']) if (!Array.isArray(v[key])) v[key] = [];
  }
  return p;
}

// 幂等迁移：重复执行结果一致，只填补缺失字段，不覆盖已有身份。
export function migrateDb(raw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const key of ['projects', 'tasks', 'usage', 'assets', 'versions', 'ideaDrafts', 'taste']) {
    if (!Array.isArray(d[key])) d[key] = [];
  }
  if (d.schemaVersion !== CURRENT_SCHEMA_VERSION) d.schemaVersion = CURRENT_SCHEMA_VERSION;
  d.projects = d.projects.map(normalizeProject);
  return d;
}
