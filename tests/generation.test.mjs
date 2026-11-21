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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-generation-'));
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

test('上下文生成使用 stub、grounded prompt 并自动回填实体槽', async () => {
  const created = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'script', name: '生成测试' }) });
  const project = created.data;
  const withChar = structuredClone(project);
  withChar.characters = [{ id: 'char-1', name: '林夏', look: '短发，深色风衣' }];
  withChar.cover = { logline: '雨夜里，她寻找一封未寄出的信。' };
  const saved = await api(`/projects/${project.id}`, {
    method: 'PUT', headers: { 'If-Match': '1' }, body: JSON.stringify(withChar),
  });
  assert.equal(saved.status, 200);

  const generated = await api(`/projects/${project.id}/generations`, {
    method: 'POST',
    body: JSON.stringify({
      purpose: 'casting', targetKind: 'character', targetId: 'char-1', slot: 'lookImage',
      extraPrompt: '冷蓝色调',
    }),
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.data.status, 'succeeded');
  assert.match(generated.data.prompt, /生成测试/);
  assert.match(generated.data.prompt, /林夏/);
  assert.match(generated.data.prompt, /冷蓝色调/);
  assert.ok(generated.data.boundRef?.assetId);

  const after = await api(`/projects/${project.id}`);
  assert.equal(after.data.characters[0].lookImage.assetId, generated.data.boundRef.assetId);

  const tasks = await api('/media/tasks?limit=10');
  const task = tasks.data.find(t => t.taskId === generated.data.taskId);
  assert.equal(task.purpose, 'casting');
  assert.equal(task.bindingStatus, 'bound');
  assert.equal(task.binding.slot, 'lookImage');

  const missing = await api(`/projects/${project.id}/generations`, {
    method: 'POST',
    body: JSON.stringify({ purpose: 'casting', targetKind: 'character', targetId: 'missing' }),
  });
  assert.equal(missing.status, 404);
});
