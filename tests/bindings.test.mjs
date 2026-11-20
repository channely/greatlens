import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 40000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-bindings-'));
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

test('上传、实体槽绑定、项目资产查询与解绑', async () => {
  const created = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({ type: 'script', name: '绑定测试' }),
  });
  assert.equal(created.status, 201);
  const project = created.data;

  const withChar = structuredClone(project);
  withChar.characters = [{ id: 'char-1', name: '林夏', look: '短发' }];
  const saved = await api(`/projects/${project.id}`, {
    method: 'PUT',
    headers: { 'If-Match': '1' },
    body: JSON.stringify(withChar),
  });
  assert.equal(saved.status, 200);

  const binding = { kind: 'character', projectId: project.id, entityId: 'char-1', slot: 'lookImage' };
  const uploaded = await api('/media/assets/upload', {
    method: 'POST',
    body: JSON.stringify({ name: 'look.png', mime: 'image/png', dataBase64: PNG, binding }),
  });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.data.bindings.length, 1);
  assert.ok(fs.existsSync(path.join(dataDir, 'assets', path.basename(uploaded.data.url))));

  const afterBind = await api(`/projects/${project.id}`);
  assert.equal(afterBind.data.characters[0].lookImage.assetId, uploaded.data.id);
  assert.equal(afterBind.data.revision, 3);

  const projectAssets = await api(`/projects/${project.id}/assets`);
  assert.equal(projectAssets.data.length, 1);
  assert.equal(projectAssets.data[0].bindings[0].slot, 'lookImage');

  const repeated = await api(`/media/assets/${uploaded.data.id}/binding`, {
    method: 'PUT',
    body: JSON.stringify({ binding, note: '冷色调' }),
  });
  assert.equal(repeated.status, 200);
  const afterRepeat = await api(`/projects/${project.id}`);
  assert.equal(afterRepeat.data.characters[0].lookImage.note, '冷色调');
  const allAssets = await api('/media/assets');
  const boundCount = allAssets.data.filter(a => (a.bindings || []).some(b => b.entityId === 'char-1')).length;
  assert.equal(boundCount, 1, '重复绑定不产生反向索引副本');

  const unbound = await api(`/media/assets/${uploaded.data.id}/binding`, {
    method: 'DELETE',
    body: JSON.stringify({ binding }),
  });
  assert.equal(unbound.status, 200);
  const afterUnbind = await api(`/projects/${project.id}`);
  assert.equal(afterUnbind.data.characters[0].lookImage, undefined);
});

test('非法槽位返回 422', async () => {
  const created = await api('/projects', {
    method: 'POST',
    body: JSON.stringify({ type: 'script', name: '非法绑定' }),
  });
  const asset = await api('/media/assets/upload', {
    method: 'POST',
    body: JSON.stringify({ name: 'x.png', mime: 'image/png', dataBase64: PNG }),
  });
  const bad = await api(`/media/assets/${asset.data.id}/binding`, {
    method: 'PUT',
    body: JSON.stringify({ binding: { kind: 'character', projectId: created.data.id, entityId: 'x', slot: 'bogus' } }),
  });
  assert.equal(bad.status, 422);
});
