// 项目版本：元数据留在 db.versions，完整快照独立写 data/versions/<projectId>/。
// 恢复前自动备份，所有替换都带 baseRevision 检查，避免旧标签页覆盖新状态。
import fs from 'node:fs';
import path from 'node:path';
import { db, uid, DATA_DIR } from './store.js';
import { stableHash, CURRENT_SCHEMA_VERSION } from './migrations.js';

const AUTO_LIMIT = 50;
const PRE_RESTORE_LIMIT = 20;
const WINDOW_MS = 60_000;

const clone = v => JSON.parse(JSON.stringify(v));
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function versionRoot(projectId) {
  return path.join(DATA_DIR, 'versions', String(projectId));
}

function snapshotAbs(entry) {
  if (!entry?.snapshotPath) return '';
  return path.resolve(DATA_DIR, entry.snapshotPath);
}

function relativeSnapshot(projectId, versionId) {
  return ['versions', String(projectId), `${versionId}.json`].join('/');
}

function writeSnapshot(meta, project) {
  const target = snapshotAbs(meta);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const safe = clone(project);
  delete safe.versions; // db 顶层版本集合不应嵌进项目快照
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(safe, null, 2));
  fs.renameSync(tmp, target);
}

function readSnapshot(entry) {
  const target = snapshotAbs(entry);
  if (!target || !fs.existsSync(target)) return null;
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch { return null; }
}

function removeSnapshot(entry) {
  const target = snapshotAbs(entry);
  if (target && fs.existsSync(target)) {
    try { fs.unlinkSync(target); } catch { /* 快照清理失败不阻断主流程 */ }
  }
}

function publicEntry(entry) {
  const target = snapshotAbs(entry);
  const { snapshotPath, ...rest } = entry;
  return { ...rest, hasSnapshot: !!target && fs.existsSync(target) };
}

function sortDesc(list) {
  return [...list].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function trimVersions(d, projectId) {
  const groups = [
    { kind: 'auto', limit: AUTO_LIMIT },
    { kind: 'pre-restore', limit: PRE_RESTORE_LIMIT },
  ];
  for (const { kind, limit } of groups) {
    const rows = sortDesc(d.versions.filter(v => v.projectId === projectId && v.kind === kind));
    for (const stale of rows.slice(limit)) {
      removeSnapshot(stale);
      d.versions = d.versions.filter(v => v.id !== stale.id);
    }
  }
}

function insertVersion(d, project, kind, opts = {}) {
  const now = new Date().toISOString();
  const id = uid();
  const meta = {
    id,
    projectId: project.id,
    kind,
    name: opts.name || `${kind === 'auto' ? '自动版本' : kind === 'pre-restore' ? '恢复前备份' : '手动版本'} · ${stamp()}`,
    description: opts.description || '',
    createdAt: now,
    sourceUpdatedAt: project.updatedAt || now,
    hash: stableHash(project),
    schemaVersion: project.schemaVersion || CURRENT_SCHEMA_VERSION,
    snapshotPath: relativeSnapshot(project.id, id),
  };
  writeSnapshot(meta, project);
  d.versions.unshift(meta);
  trimVersions(d, project.id);
  return publicEntry(meta);
}

function findProject(d, projectId) {
  return d.projects.find(p => p.id === projectId);
}

function findVersion(d, projectId, versionId) {
  return d.versions.find(v => v.id === versionId && v.projectId === projectId);
}

function conflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

function notFound(message = '版本不存在') {
  return Object.assign(new Error(message), { status: 404 });
}

// 保存前调用：内容未变不建版本；60 秒编辑窗口内只保留“本次编辑前最后已保存状态”。
export function autoVersionForSave(d, before, after) {
  const beforeHash = stableHash(before);
  const afterHash = stableHash(after);
  if (beforeHash === afterHash) return null;

  const latest = sortDesc(d.versions.filter(v => v.projectId === before.id && v.kind === 'auto'))[0];
  const inWindow = latest && (Date.now() - Date.parse(latest.createdAt)) < WINDOW_MS;
  if (inWindow) {
    writeSnapshot(latest, before);
    latest.hash = beforeHash;
    latest.sourceUpdatedAt = before.updatedAt || latest.sourceUpdatedAt;
    latest.schemaVersion = before.schemaVersion || CURRENT_SCHEMA_VERSION;
    return publicEntry(latest);
  }
  return insertVersion(d, before, 'auto');
}

export function listVersions(projectId) {
  const d = db.all();
  if (!findProject(d, projectId)) throw notFound('项目不存在');
  return sortDesc(d.versions.filter(v => v.projectId === projectId)).map(publicEntry);
}

export function getVersion(projectId, versionId) {
  const d = db.all();
  if (!findProject(d, projectId)) throw notFound('项目不存在');
  const entry = findVersion(d, projectId, versionId);
  if (!entry) throw notFound();
  const project = readSnapshot(entry);
  if (!project) throw notFound('版本快照文件不存在');
  return { ...publicEntry(entry), project };
}

export function createVersion(projectId, opts = {}) {
  return db.update(d => {
    const project = findProject(d, projectId);
    if (!project) throw notFound('项目不存在');
    return insertVersion(d, project, 'manual', {
      name: String(opts.name || '').trim(),
      description: String(opts.description || '').trim(),
    });
  });
}

export function updateVersion(projectId, versionId, patch = {}) {
  return db.update(d => {
    const entry = findVersion(d, projectId, versionId);
    if (!entry) throw notFound();
    if (patch.name !== undefined) entry.name = String(patch.name || '').trim() || entry.name;
    if (patch.description !== undefined) entry.description = String(patch.description || '');
    return publicEntry(entry);
  });
}

export function deleteVersion(projectId, versionId) {
  return db.update(d => {
    const entry = findVersion(d, projectId, versionId);
    if (!entry) throw notFound();
    removeSnapshot(entry);
    d.versions = d.versions.filter(v => v.id !== versionId);
    return { ok: true };
  });
}

// 批次 2 起按 asset.bindings 重建实体槽引用。当前资产只记录 projectId，不做破坏性改写。
function rebuildBindings(d, project) {
  void d;
  void project;
}

export function restoreVersion(projectId, versionId, baseRevision) {
  return db.update(d => {
    const idx = d.projects.findIndex(p => p.id === projectId);
    if (idx < 0) throw notFound('项目不存在');
    const current = d.projects[idx];
    if (baseRevision !== undefined && baseRevision !== null && Number(baseRevision) !== Number(current.revision)) {
      throw conflict(`项目已被其他会话更新（当前 r${current.revision}，请求基于 r${baseRevision}）。请刷新后再恢复。`);
    }
    const entry = findVersion(d, projectId, versionId);
    if (!entry) throw notFound();
    const snapshot = readSnapshot(entry);
    if (!snapshot) throw notFound('版本快照文件不存在');

    insertVersion(d, current, 'pre-restore', {
      name: `恢复前备份 · ${stamp()}`,
      description: `恢复到「${entry.name}」前自动保存`,
    });

    const restored = clone(snapshot);
    restored.id = current.id;
    restored.type = current.type;
    restored.createdAt = current.createdAt;
    restored.revision = Number(current.revision || 1) + 1;
    restored.updatedAt = new Date().toISOString();
    restored.versionHash = stableHash(restored);
    rebuildBindings(d, restored);
    d.projects[idx] = restored;
    return restored;
  });
}
