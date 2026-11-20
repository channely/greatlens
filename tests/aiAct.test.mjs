import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 10000 + Math.floor(Math.random() * 8000);
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-aiact-'));
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: { ...process.env, GL_DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/settings')).ok) return; } catch { /* 等待启动 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('测试服务启动失败');
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('Script Doctor 先诊断后处方，结构化动作按稳定 ID 采纳', async () => {
  const created = await api('/projects', {
    method: 'POST', body: JSON.stringify({ type: 'script', name: '医生测试' }),
  });
  const project = created.data;
  const targetId = 'node-target-1';
  const longText = '她推开门。'.repeat(40);
  const next = structuredClone(project);
  next.episodes[0].nodes = [
    { id: 'node-scene-1', type: 'scene', text: 'INT. 旧书店 - 夜' },
    { id: targetId, type: 'action', text: longText },
  ];
  const saved = await api(`/projects/${project.id}`, {
    method: 'PUT', headers: { 'If-Match': '1' }, body: JSON.stringify(next),
  });
  assert.equal(saved.status, 200);
  const episodeId = saved.data.episodes[0].id;

  const skip = await api('/ai/act', {
    method: 'POST',
    body: JSON.stringify({ projectId: project.id, episodeId, mode: 'doctor-prescribe' }),
  });
  assert.equal(skip.status, 428, '没有诊断令牌不能跳到处方');

  const diag = await api('/ai/act', {
    method: 'POST',
    body: JSON.stringify({ projectId: project.id, episodeId, mode: 'doctor-diagnose' }),
  });
  assert.equal(diag.status, 200);
  assert.equal(diag.data.envelope.stage, 'diagnosis');
  assert.ok(diag.data.envelope.diagnosisToken);
  assert.equal(diag.data.envelope.actions.length, 0);

  const rx = await api('/ai/act', {
    method: 'POST',
    body: JSON.stringify({
      projectId: project.id, episodeId, mode: 'doctor-prescribe',
      diagnosis: diag.data.envelope.diagnosis,
      diagnosisToken: diag.data.envelope.diagnosisToken,
    }),
  });
  assert.equal(rx.status, 200);
  assert.equal(rx.data.envelope.stage, 'prescription');
  assert.equal(rx.data.envelope.actions[0].targetNodeId, targetId);
  assert.equal(rx.data.envelope.actions[0].op, 'insert_after');

  const badTarget = await api('/ai/act', {
    method: 'POST',
    body: JSON.stringify({
      projectId: project.id, episodeId,
      actions: [{ ...rx.data.envelope.actions[0], targetNodeId: 'missing-node' }],
      baseRevision: saved.data.revision, apply: true,
    }),
  });
  assert.equal(badTarget.status, 409, '目标不存在必须拒绝');

  const applied = await api('/ai/act', {
    method: 'POST',
    body: JSON.stringify({
      projectId: project.id, episodeId,
      actions: rx.data.envelope.actions,
      baseRevision: saved.data.revision, apply: true,
    }),
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.project.revision, saved.data.revision + 1);
  const nodes = applied.data.project.episodes[0].nodes;
  assert.equal(nodes.length, 3);
  assert.equal(nodes[2].type, 'comment');

  const stale = await api('/ai/act', {
    method: 'POST',
    body: JSON.stringify({
      projectId: project.id, episodeId,
      actions: rx.data.envelope.actions,
      baseRevision: saved.data.revision, apply: true,
    }),
  });
  assert.equal(stale.status, 409, '过期 revision 不能重复采纳');
});
