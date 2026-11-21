import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireTestPort } from './helpers/port.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = path.resolve(import.meta.dirname, '..');
let server, dataDir, BASE, PORT;

async function api(p, opts = {}) {
  const r = await fetch(BASE + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

test('MVP 端到端：DSL → 编译 → 知识状态 → 工作流 → 渲染落库（stub）', async t => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-virtual-mvp-'));
  const portLease = acquireTestPort();
  PORT = portLease.port;
  BASE = `http://127.0.0.1:${PORT}/api`;
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT, env: { ...process.env, GL_DATA_DIR: dataDir, PORT: String(PORT), GL_STUB_MODELS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/settings')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
    if (i === 79) throw new Error('测试服务启动超时');
  }
  t.after(async () => {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([once(server, 'exit'), new Promise(r => setTimeout(r, 2000))]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    portLease.release();
  });

  const created = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'virtual', name: '细胞器对话' }) });
  const id = created.body.id;

  // 生成 + 保存 + 编译
  const gen = await api(`/virtual/${id}/dsl`, { method: 'POST', body: JSON.stringify({ seed: '细胞核与线粒体科普对话' }) });
  assert.equal(gen.body.source, 'local');
  await api(`/virtual/${id}/dsl`, { method: 'PUT', body: JSON.stringify({ dsl: gen.body.dsl }) });
  const compile = await api(`/virtual/${id}/compile`, { method: 'POST', body: JSON.stringify({ persist: true }) });
  assert.equal(compile.body.ok, true);

  // 知识状态推进
  const know = await api(`/virtual/${id}/knowledge`);
  assert.equal(know.body.facts.length, 2);
  const tr = await api(`/virtual/${id}/knowledge/k-cellfactory/transition`, { method: 'POST', body: JSON.stringify({ to: 'resolved' }) });
  assert.equal(tr.status, 200);
  const badTr = await api(`/virtual/${id}/knowledge/k-cellfactory/transition`, { method: 'POST', body: JSON.stringify({ to: 'introduced' }) });
  assert.equal(badTr.status, 422, '知识状态不允许回退');

  // 模型目录与资产
  const catalog = await api('/virtual/catalog');
  assert.equal(catalog.status, 200);
  assert.ok(Array.isArray(catalog.body.models));
  const assets = await api(`/virtual/${id}/assets`);
  assert.equal(assets.status, 200);

  // 工作流
  const wf = await api(`/virtual/${id}/workflow`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(wf.status, 201);
  assert.equal(wf.body.steps.length, 7);
  const wfGet = await api(`/virtual/${id}/workflow?runId=${encodeURIComponent(wf.body.id)}`);
  assert.equal(wfGet.body.id, wf.body.id);
  const adv = await api(`/virtual/${id}/workflow/${wf.body.id}/parse/advance`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(adv.body.steps[0].status, 'succeeded');
  const retried = await api(`/virtual/${id}/workflow/${wf.body.id}/parse/retry`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(retried.body.steps[0].status, 'pending');

  // 配音（stub）
  const voice = await api(`/virtual/${id}/voiceover`, { method: 'POST', body: JSON.stringify({ lines: compile.body.timeline.dialogue }) });
  assert.equal(voice.status, 200);
  assert.ok(voice.body.count >= 1);

  // 渲染 job → 浏览器回传成片（用极小 base64 模拟 WebM 字节）
  const render = await api(`/virtual/${id}/render`, { method: 'POST', body: JSON.stringify({ mode: 'browser', width: 1280, height: 720, fps: 30, durationSec: 30 }) });
  assert.equal(render.status, 200);
  assert.equal(render.body.mode, 'browser');
  assert.equal(render.body.status, 'awaiting-browser');
  const job = await api(`/virtual/${id}/render/${render.body.jobId}`);
  assert.equal(job.body.id, render.body.jobId);
  const tinyWebm = Buffer.from('GkXfo0AgQoaBAUL3gQFC8oMOTl3A==', 'base64').toString('base64');
  const done = await api(`/virtual/${id}/render/${render.body.jobId}/complete`, {
    method: 'POST', body: JSON.stringify({
      dataBase64: tinyWebm, mimeType: 'video/webm;codecs=vp9', durationSec: 30,
      subtitles: [{ text: '测试字幕', startSec: 0, endSec: 2 }],
    }),
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.ok(done.body.url.startsWith('/media/virtual-'));
  assert.ok(fs.existsSync(path.join(dataDir, 'assets', path.basename(done.body.url))), '成片文件应落盘');

  // 资产与版本都出现
  const allAssets = await api(`/media/assets?type=video`);
  assert.ok(allAssets.body.some(a => a.id === done.body.assetId));
  const versions = await api(`/projects/${id}/versions`);
  assert.ok(versions.body.length >= 1, '导出应创建/更新 auto 版本（60s 窗口内合并为一个是预期行为）');
  const live = await api(`/projects/${id}`);
  assert.ok((live.body.virtual?.renderJobs || []).some(j => j.id === render.body.jobId && j.status === 'succeeded'),
    '项目应记录成功的渲染作业');
  assert.ok((live.body.virtual?.renderJobs || []).find(j => j.id === render.body.jobId)?.artifact?.url.startsWith('/media/virtual-'));

  // 空数据保护
  const emptyRender = await api(`/virtual/${id}/render/${render.body.jobId}/complete`, { method: 'POST', body: JSON.stringify({ dataBase64: '' }) });
  assert.equal(emptyRender.status, 422);
});

test('内置演示案例：一键创建可直接预演的 30 秒细胞器项目', async () => {
  const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-demo-'));
  const demoLease = acquireTestPort();
  const port = demoLease.port;
  const base = `http://127.0.0.1:${port}/api`;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT, env: { ...process.env, GL_DATA_DIR: demoDir, PORT: String(port), GL_STUB_MODELS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    for (let i = 0; i < 80; i++) {
      try { if ((await fetch(base + '/settings')).ok) break; } catch {}
      await new Promise(r => setTimeout(r, 100));
      if (i === 79) throw new Error('服务启动超时');
    }
    const info = await fetch(base + '/virtual/demo').then(r => r.json());
    assert.ok(info.seed.includes('细胞核'));
    const created = await fetch(base + '/virtual/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(created.status, 201);
    const p = await created.json();
    assert.equal(p.type, 'virtual');
    assert.equal(p.virtual.dsl.meta.durationSec, 30);
    assert.ok(p.virtual.compiled.scenePlan.nodes.length >= 3);
    assert.equal(p.virtual.knowledgeState.facts.length, 2);
    assert.equal(p.virtual.ipLocks.length, 3, '应预置主角与音色 IP 锁');
    // 幂等：二次调用返回同一个项目
    const again = await fetch(base + '/virtual/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).id, p.id);
  } finally {
    if (srv.exitCode === null) { srv.kill('SIGTERM'); await Promise.race([once(srv, 'exit'), new Promise(r => setTimeout(r, 2000))]); }
    fs.rmSync(demoDir, { recursive: true, force: true });
    demoLease.release();
  }
});
