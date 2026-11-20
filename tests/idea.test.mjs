import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 50000 + Math.floor(Math.random() * 9000);
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-idea-'));
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

test('idea-first 分阶段提案、幂等建项与项目设置同源', async () => {
  const beforeList = await api('/projects');
  const clientDraftId = 'idea-test-001';
  const brief = {
    protagonist: '林夏', desire: '找到未寄出的信', opposition: '旧书店主',
    length: '短片 30 分钟', tone: '克制、潮湿', theme: '迟到的道歉能否被听见',
  };
  const draft = { brief, title: '', logline: '' };

  for (const stage of ['brief', 'title', 'outline', 'beats', 'characters', 'locations', 'opening', 'review']) {
    const r = await api('/ai/idea', { method: 'POST', body: JSON.stringify({ stage, draft, clientDraftId }) });
    assert.equal(r.status, 200, `stage=${stage}`);
    assert.equal(r.data.stage, stage);
    assert.ok(r.data.payload);
    if (stage === 'title') {
      draft.title = r.data.payload.options[0];
      draft.logline = r.data.payload.logline;
    }
    if (stage === 'outline') draft.outline = { acts: r.data.payload.acts };
    if (stage === 'beats') draft.beats = { beats: r.data.payload.beats };
    if (stage === 'characters') draft.characters = r.data.payload;
    if (stage === 'locations') draft.locations = r.data.payload;
    if (stage === 'opening') draft.opening = r.data.payload;
  }
  const afterIdea = await api('/projects');
  assert.equal(afterIdea.data.length, beforeList.data.length, '提案阶段不写项目');

  const created = await api('/projects/from-idea', {
    method: 'POST', body: JSON.stringify({ clientDraftId, draft, type: 'script' }),
  });
  assert.equal(created.status, 201);
  const project = created.data.project;
  assert.equal(project.name, draft.title);
  assert.equal(project.cover.title, draft.title);
  assert.ok(project.episodes[0].outline.length >= 3);
  assert.ok(project.episodes[0].beats.length >= 8);
  assert.ok(project.episodes[0].nodes.length >= 2);
  assert.ok(project.characters.length >= 2);
  assert.ok(project.locations.length >= 2);
  assert.equal(project.versionHash.length, 64);

  const versions = await api(`/projects/${project.id}/versions`);
  assert.ok(versions.data.some(v => v.name === 'AI 创意初始版本' && v.kind === 'manual'));

  const repeated = await api('/projects/from-idea', {
    method: 'POST', body: JSON.stringify({ clientDraftId, draft, type: 'script' }),
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.created, false);
  assert.equal(repeated.data.project.id, project.id);

  const settings = await api(`/projects/${project.id}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({ baseRevision: project.revision, settings: { format: 'asian', exportConvention: 'asian' } }),
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.data.settings.exportConvention, 'asian');
  assert.equal(settings.data.revision, project.revision + 1);

  const stale = await api(`/projects/${project.id}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({ baseRevision: project.revision, settings: { format: 'hollywood' } }),
  });
  assert.equal(stale.status, 409);
});
