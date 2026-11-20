import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { migrateDb } from '../server/migrations.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}/api`;
let dataDir;
let server;

async function api(urlPath, opts = {}) {
  const res = await fetch(BASE + urlPath, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-versions-'));
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: { ...process.env, GL_DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE + '/settings');
      if (r.ok) { ready = true; break; }
    } catch { /* 等待启动 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('测试服务启动失败');
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('migrateDb 幂等：字符串实体转对象，语义节点补稳定 ID', () => {
  const fixture = {
    projects: [{
      id: 'p1', name: '旧项目', characters: ['林夏'], locations: ['旧书店'],
      episodes: [{ id: 'e1', nodes: [{ type: 'action', text: '雨夜推门' }] }],
    }],
  };
  const onceMigrated = migrateDb(structuredClone(fixture));
  const twiceMigrated = migrateDb(structuredClone(onceMigrated));
  assert.deepEqual(onceMigrated, twiceMigrated);
  assert.equal(onceMigrated.schemaVersion, 1);
  assert.equal(typeof onceMigrated.projects[0].characters[0].id, 'string');
  assert.equal(typeof onceMigrated.projects[0].episodes[0].nodes[0].id, 'string');
  assert.equal(onceMigrated.projects[0].revision, 1);
  assert.equal(onceMigrated.projects[0].versionHash, '');
});

test('版本历史：自动基线、窗口内去重、命名版本、冲突检测、安全恢复', async () => {
  const created = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({ type: 'script', name: '未命名项目' }),
  });
  assert.equal(created.status, 201);
  const project = created.data;
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.revision, 1);
  assert.ok(project.versionHash);

  const first = structuredClone(project);
  first.name = '第一次';
  const save1 = await api(`/projects/${project.id}`, {
    method: 'PUT',
    headers: { 'If-Match': '1' },
    body: JSON.stringify(first),
  });
  assert.equal(save1.status, 200);
  assert.equal(save1.data.revision, 2);

  const versions1 = await api(`/projects/${project.id}/versions`);
  assert.equal(versions1.data.length, 1);
  assert.equal(versions1.data[0].kind, 'auto');

  const second = structuredClone(save1.data);
  second.name = '第二次';
  const save2 = await api(`/projects/${project.id}`, {
    method: 'PUT',
    headers: { 'If-Match': '2' },
    body: JSON.stringify(second),
  });
  assert.equal(save2.status, 200);
  assert.equal(save2.data.revision, 3);

  const versions2 = await api(`/projects/${project.id}/versions`);
  assert.equal(versions2.data.length, 1, '60 秒窗口内只保留一个自动版本');
  const autoSnapshot = await api(`/projects/${project.id}/versions/${versions2.data[0].id}`);
  assert.equal(autoSnapshot.data.project.name, '第一次', '自动版本保存本次编辑前的最后已保存状态');

  const manual = await api(`/projects/${project.id}/versions`, {
    method: 'POST',
    body: JSON.stringify({ name: '复核版', description: '关键节点' }),
  });
  assert.equal(manual.status, 201);
  assert.equal(manual.data.kind, 'manual');
  const manualSnapshotPath = path.join('versions', project.id, `${manual.data.id}.json`);
  assert.ok(fs.existsSync(path.join(dataDir, manualSnapshotPath)));

  const stale = await api(`/projects/${project.id}`, {
    method: 'PUT',
    headers: { 'If-Match': '1' },
    body: JSON.stringify(project),
  });
  assert.equal(stale.status, 409, '旧 revision 必须被拒绝');

  const restoredManual = await api(`/projects/${project.id}/versions/${manual.data.id}/restore`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision: save2.data.revision }),
  });
  assert.equal(restoredManual.status, 200);
  assert.equal(restoredManual.data.name, '第二次');
  assert.equal(restoredManual.data.revision, 4);

  const versionsAfterRestore = await api(`/projects/${project.id}/versions`);
  assert.ok(versionsAfterRestore.data.some(v => v.kind === 'pre-restore'), '恢复前自动生成备份');

  const restoredAuto = await api(`/projects/${project.id}/versions/${versions2.data[0].id}/restore`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision: restoredManual.data.revision }),
  });
  assert.equal(restoredAuto.status, 200);
  assert.equal(restoredAuto.data.name, '第一次');
  assert.equal(restoredAuto.data.revision, 5);

  const deleted = await api(`/projects/${project.id}/versions/${manual.data.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const finalVersions = await api(`/projects/${project.id}/versions`);
  assert.ok(!finalVersions.data.some(v => v.id === manual.data.id));
});

test('Cinema Reel 版本随项目快照一起保存与恢复', async () => {
  const created = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({ type: 'cinema', name: '海风与橘子 Cinema' }),
  });
  assert.equal(created.status, 201);
  const project = created.data;
  const next = structuredClone(project);
  next.episodes[0].reels.push({
    id: 'reel-test', title: 'Reel 1', duration: 30, continuity: 'natural',
    versions: [{ id: 'cv-test', url: '/media/test.mp4', taskId: 'task-test' }],
    clip: '/media/test.mp4',
  });
  const saved = await api(`/projects/${project.id}`, {
    method: 'PUT',
    headers: { 'If-Match': '1' },
    body: JSON.stringify(next),
  });
  assert.equal(saved.status, 200);

  const manual = await api(`/projects/${project.id}/versions`, {
    method: 'POST',
    body: JSON.stringify({ name: '带成片版本' }),
  });
  assert.equal(manual.status, 201);
  const snapshot = await api(`/projects/${project.id}/versions/${manual.data.id}`);
  assert.equal(snapshot.data.project.episodes[0].reels[0].duration, 30);
  assert.equal(snapshot.data.project.episodes[0].reels[0].versions.length, 1);
  assert.equal(snapshot.data.project.episodes[0].reels[0].clip, '/media/test.mp4');
});
