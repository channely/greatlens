import test, { before, after } from 'node:test';
import { acquireTestPort } from './helpers/port.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = path.resolve(import.meta.dirname, '..');
const portLease = acquireTestPort();
const PORT = portLease.port;
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-views-'));
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT, env: { ...process.env, GL_DATA_DIR: dataDir, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/settings')).ok) return; } catch { /* 等待启动 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('测试服务启动失败');
});

after(async () => {
  portLease.release();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('场景投影保留 nodeId，画布布局可单独持久化', async () => {
  const created = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'script', name: '视图测试' }) });
  const project = created.data;
  const next = structuredClone(project);
  next.episodes[0].nodes = [
    { id: 'scene-node-1', type: 'scene', text: 'INT. 旧书店 - 夜' },
    { id: 'action-node-1', type: 'action', text: '她推门进来。' },
  ];
  const saved = await api(`/projects/${project.id}`, {
    method: 'PUT', headers: { 'If-Match': '1' }, body: JSON.stringify(next),
  });
  assert.equal(saved.status, 200);

  const entities = await api(`/projects/${project.id}/entities`);
  assert.equal(entities.data.scenes[0].nodeId, 'scene-node-1');

  const withLayout = structuredClone(saved.data);
  withLayout.viewLayouts = { storyboard: { [saved.data.episodes[0].id]: { shot1: { x: 20, y: 40 } } } };
  const layoutSaved = await api(`/projects/${project.id}`, {
    method: 'PUT', headers: { 'If-Match': String(saved.data.revision) }, body: JSON.stringify(withLayout),
  });
  assert.equal(layoutSaved.status, 200);
  assert.deepEqual(layoutSaved.data.viewLayouts.storyboard[saved.data.episodes[0].id].shot1, { x: 20, y: 40 });
});
