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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-poster-'));
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: { ...process.env, GL_DATA_DIR: dataDir, PORT: String(PORT), GL_STUB_MODELS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
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

test('电影海报作为独立目的：专用 prompt + 回填 project.posterImage', async () => {
  const created = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'script', name: '海报测试' }) });
  const project = created.data;
  const next = structuredClone(project);
  next.cover = { title: '雨夜来客', subtitle: '一座城的秘密', logline: '一个记者在雨夜揭开旧案。' };
  next.logline = '一个记者在雨夜揭开旧案。';
  next.worldview = { 视觉风格: '冷蓝雨夜', 基调: '克制悬疑' };
  next.characters = [{ id: 'c1', name: '林夏' }];
  const saved = await api(`/projects/${project.id}`, {
    method: 'PUT', headers: { 'If-Match': '1' }, body: JSON.stringify(next),
  });
  assert.equal(saved.status, 200);

  const generated = await api(`/projects/${project.id}/generations`, {
    method: 'POST', body: JSON.stringify({ purpose: 'poster' }),
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.data.purpose, 'poster');
  assert.match(generated.data.prompt, /电影海报设计/);
  assert.match(generated.data.prompt, /雨夜来客/);
  assert.match(generated.data.prompt, /林夏/);
  assert.match(generated.data.prompt, /冷蓝雨夜/);
  assert.equal(generated.data.binding.kind, 'project');
  assert.equal(generated.data.binding.slot, 'posterImage');

  const after = await api(`/projects/${project.id}`);
  assert.ok(after.data.posterImage?.assetId, '海报回填到 project.posterImage');
  assert.ok(after.data.posterImage?.url);

  const tasks = await api('/media/tasks?limit=10');
  const task = tasks.data.find(t => t.taskId === generated.data.taskId);
  assert.equal(task.purpose, 'poster');
  assert.equal(task.bindingStatus, 'bound');
});
