import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { settings, db, DATA_DIR, DB_PATH, SETTINGS_PATH } from './store.js';

const SYNC_DIR = path.join(DATA_DIR, '.sync');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: SYNC_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'GreatLens', GIT_AUTHOR_EMAIL: 'greatlens@local', GIT_COMMITTER_NAME: 'GreatLens', GIT_COMMITTER_EMAIL: 'greatlens@local' },
    ...opts,
  });
}

function authenticatedRemote(remote, token) {
  if (!token || !/^https?:\/\//i.test(remote)) return remote;
  try {
    const u = new URL(remote);
    u.username = 'oauth2';
    u.password = token;
    return u.toString();
  } catch { return remote; }
}

function snapshotSettings() {
  const s = settings.get();
  // 密钥类字段不进入远端
  const { apiKey, syncToken, ...safe } = s;
  return safe;
}

function ensureRepo() {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
  if (!fs.existsSync(path.join(SYNC_DIR, '.git'))) {
    git(['init', '-b', 'main', '.']);
    fs.writeFileSync(path.join(SYNC_DIR, '.gitignore'), '*.tmp\n.DS_Store\n');
  }
  const cfg = settings.get();
  if (cfg.syncRemote) {
    const url = authenticatedRemote(cfg.syncRemote, cfg.syncToken);
    try { git(['remote', 'remove', 'origin']); } catch {}
    git(['remote', 'add', 'origin', url]);
  }
}

function writeSnapshot(device) {
  fs.writeFileSync(path.join(SYNC_DIR, 'db.json'), JSON.stringify(db.all(), null, 2));
  fs.writeFileSync(path.join(SYNC_DIR, 'settings.json'), JSON.stringify(snapshotSettings(), null, 2));
  fs.writeFileSync(path.join(SYNC_DIR, 'snapshot.json'), JSON.stringify({
    app: 'GreatLens', version: 1, device: device || '未命名设备', exportedAt: new Date().toISOString(),
  }, null, 2));
}

function readCommits(limit = 8) {
  try {
    const out = git(['log', '--date=iso', '--pretty=format:%h|%ad|%s', '-n', String(limit)]);
    return out.split('\n').filter(Boolean).map(line => {
      const [hash, date, message] = line.split('|');
      return { hash, date, message };
    });
  } catch { return []; }
}

export function syncStatus() {
  const cfg = settings.get();
  let dirty = false;
  let commits = [];
  if (fs.existsSync(path.join(SYNC_DIR, '.git'))) {
    try { dirty = !!git(['status', '--porcelain']).trim(); } catch {}
    commits = readCommits();
  }
  return {
    configured: !!(cfg.syncRemote && cfg.syncToken),
    remote: cfg.syncRemote || '',
    device: cfg.syncDevice || '',
    lastSyncAt: commits[0]?.date || '',
    lastError: cfg.syncError || '',
    dirty,
    commits,
    syncDir: SYNC_DIR,
  };
}

export function configureSync({ remote, token, device }) {
  const patch = {};
  if (remote !== undefined) patch.syncRemote = String(remote || '').trim();
  if (token !== undefined && !/^\*{2,}/.test(String(token))) patch.syncToken = String(token || '').trim();
  if (device !== undefined) patch.syncDevice = String(device || '').trim();
  const next = settings.set(patch);
  if (next.syncRemote) {
    ensureRepo();
  }
  return syncStatus();
}

export function pushSync() {
  const cfg = settings.get();
  if (!cfg.syncRemote || !cfg.syncToken) {
    throw Object.assign(new Error('请先配置 Git 仓库地址与访问令牌。'), { status: 428 });
  }
  ensureRepo();
  writeSnapshot(cfg.syncDevice);
  git(['add', '-A']);
  let committed = false;
  try {
    git(['commit', '-m', `snapshot from ${cfg.syncDevice || 'device'} @ ${new Date().toISOString()}`]);
    committed = true;
  } catch { /* 无变更 */ }

  try { git(['fetch', 'origin', 'main']); } catch {}
  let pulled = '';
  try {
    pulled = git(['pull', '--no-edit', '-X', 'ours', 'origin', 'main']);
  } catch (e) {
    // 远端为空或无关历史时不阻断首次推送
    const msg = String(e.stderr || e.message || '');
    if (!/no remote|couldn't find remote ref|refusing to merge unrelated|There is no tracking/i.test(msg)) {
      settings.set({ syncError: msg.slice(0, 300) });
      throw Object.assign(new Error(`拉取远端失败：${msg.slice(0, 200)}`), { status: 502 });
    }
  }
  try {
    git(['push', '-u', 'origin', 'HEAD:main']);
  } catch (e) {
    const msg = String(e.stderr || e.message || '').slice(0, 300);
    settings.set({ syncError: msg });
    throw Object.assign(new Error(`推送失败：${msg}`), { status: 502 });
  }
  settings.set({ syncError: '' });
  return { ok: true, hash: readCommits(1)[0]?.hash || '', message: committed ? '已推送本地快照' : '无变更，已同步远端状态', pulled: !!pulled };
}

export function pullSync() {
  const cfg = settings.get();
  if (!cfg.syncRemote || !cfg.syncToken) {
    throw Object.assign(new Error('请先配置 Git 仓库地址与访问令牌。'), { status: 428 });
  }
  ensureRepo();
  // 拉取前备份本地数据
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(DB_PATH, path.join(BACKUP_DIR, `db-before-pull-${stamp}.json`));

  try { git(['fetch', 'origin', 'main']); }
  catch (e) {
    const msg = String(e.stderr || e.message || '').slice(0, 300);
    throw Object.assign(new Error(`获取远端失败：${msg}`), { status: 502 });
  }
  try {
    git(['merge', '--no-edit', '-X', 'theirs', 'FETCH_HEAD']);
  } catch (e) {
    const msg = String(e.stderr || e.message || '').slice(0, 300);
    settings.set({ syncError: msg });
    throw Object.assign(new Error(`合并远端失败：${msg}`), { status: 502 });
  }
  const remoteDb = path.join(SYNC_DIR, 'db.json');
  if (!fs.existsSync(remoteDb)) throw Object.assign(new Error('远端快照中没有 db.json。'), { status: 502 });
  const parsed = JSON.parse(fs.readFileSync(remoteDb, 'utf8'));
  if (!Array.isArray(parsed.projects)) throw Object.assign(new Error('远端快照格式不正确。'), { status: 502 });
  db.save(parsed);

  // 安全合并设置：只取非敏感字段
  const remoteSettings = JSON.parse(fs.readFileSync(path.join(SYNC_DIR, 'settings.json'), 'utf8'));
  const patch = {};
  for (const k of Object.keys(remoteSettings)) {
    if (k === 'apiKey' || k === 'syncToken' || k === 'syncError') continue;
    patch[k] = remoteSettings[k];
  }
  settings.set(patch);

  settings.set({ syncError: '' });
  return { ok: true, applied: true, message: '已拉取远端快照并覆盖本地数据（本地已自动备份）', projects: parsed.projects.length, backupAt: stamp };
}
