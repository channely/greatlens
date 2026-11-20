import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 9500 + Math.floor(Math.random() * 400);
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-audio-'));
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
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('导演圆桌 / 剧本围读使用 stub 同步合成并按 token 记账', async () => {
  const created = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'script', name: '音频测试' }) });
  const project = created.data;
  const next = structuredClone(project);
  next.episodes[0].nodes = [
    { id: 'c1', type: 'character', text: '林夏' },
    { id: 'd1', type: 'dialogue', text: '你总是来得比我准备道歉的时间更早。' },
  ];
  const saved = await api(`/projects/${project.id}`, {
    method: 'PUT', headers: { 'If-Match': '1' }, body: JSON.stringify(next),
  });
  assert.equal(saved.status, 200);

  const plan = await api(`/projects/${project.id}/audio/plan`, {
    method: 'POST', body: JSON.stringify({ scene: 'roundtable', episodeId: saved.data.episodes[0].id }),
  });
  assert.equal(plan.status, 200);
  assert.equal(plan.data.scene, 'roundtable');
  assert.equal(plan.data.limit, 240);
  assert.match(plan.data.script, /导演：/);

  const generated = await api('/media/audio', {
    method: 'POST',
    body: JSON.stringify({ scene: 'roundtable', prompt: plan.data.script, seconds: 45, projectId: project.id }),
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.data.status, 'succeeded');
  assert.equal(generated.data.costKnown, true);
  assert.ok(generated.data.cost > 0);
  assert.match(generated.data.url, /stub:/);

  const assets = await api('/media/assets?type=audio');
  assert.ok(assets.data.some(a => a.id === generated.data.assetId));

  const readthrough = await api(`/projects/${project.id}/audio/plan`, {
    method: 'POST',
    body: JSON.stringify({ scene: 'readthrough', episodeId: saved.data.episodes[0].id }),
  });
  assert.equal(readthrough.status, 200);
  assert.equal(readthrough.data.limit, 120);
  assert.match(readthrough.data.script, /对白：/);

  const tooLong = await api('/media/audio', {
    method: 'POST', body: JSON.stringify({ scene: 'readthrough', prompt: '台词', seconds: 121 }),
  });
  assert.equal(tooLong.status, 422);

  const tooLarge = await api('/media/audio', {
    method: 'POST', body: JSON.stringify({ scene: 'roundtable', prompt: '字'.repeat(3001), seconds: 30 }),
  });
  assert.equal(tooLarge.status, 422);

  const report = await api('/usage?days=30');
  assert.ok(report.data.recent.some(r => r.type === 'audio'));
});
