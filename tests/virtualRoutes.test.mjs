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
  const r = await fetch(BASE + p, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

test('虚拟制片 DSL 路由集成（stub 模式，零扣费）', async t => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-virtual-'));
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

  // 建 virtual 项目
  const created = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'virtual', name: '细胞器对话' }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.type, 'virtual');
  assert.equal(created.body.virtual.dsl, null);
  const id = created.body.id;

  // 读空 DSL
  const empty = await api(`/virtual/${id}/dsl`);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.dsl, null);

  // NL 生成（stub → local 模板，草稿不写库）
  const gen = await api(`/virtual/${id}/dsl`, { method: 'POST', body: JSON.stringify({ seed: '30秒科普：细胞核与线粒体的对话' }) });
  assert.equal(gen.status, 200);
  assert.equal(gen.body.source, 'local');
  assert.equal(gen.body.dsl.meta.durationSec, 30);
  const stillEmpty = await api(`/virtual/${id}/dsl`);
  assert.equal(stillEmpty.body.dsl, null, 'NL 生成不应写库');

  // 校验通过
  const val = await api(`/virtual/${id}/validate`, { method: 'POST', body: JSON.stringify({ dsl: gen.body.dsl }) });
  assert.equal(val.status, 200);
  assert.equal(val.body.ok, true);

  // 幻觉注入 → 422 且不写库
  const bad = structuredClone(gen.body.dsl);
  bad.characters[0].assetId = 'hallucinated';
  const badVal = await api(`/virtual/${id}/validate`, { method: 'POST', body: JSON.stringify({ dsl: bad }) });
  assert.equal(badVal.status, 422);
  assert.ok(badVal.body.diagnostics.some(d => d.code === 'REF'));
  const badSave = await api(`/virtual/${id}/dsl`, { method: 'PUT', body: JSON.stringify({ dsl: bad }) });
  assert.equal(badSave.status, 422);
  const afterBad = await api(`/virtual/${id}/dsl`);
  assert.equal(afterBad.body.dsl, null, '幻觉 DSL 不得写库');

  // 保存合法 DSL
  const saved = await api(`/virtual/${id}/dsl`, { method: 'PUT', body: JSON.stringify({ dsl: gen.body.dsl }) });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.dsl.meta.title.length > 0, true);
  assert.ok(saved.body.revision >= 2);

  // revision 冲突
  const conflict = await api(`/virtual/${id}/dsl`, { method: 'PUT', body: JSON.stringify({ dsl: gen.body.dsl, baseRevision: 1 }) });
  assert.equal(conflict.status, 409);

  // 编译并持久化
  const compiled = await api(`/virtual/${id}/compile`, { method: 'POST', body: JSON.stringify({ persist: true }) });
  assert.equal(compiled.status, 200);
  assert.equal(compiled.body.ok, true);
  assert.equal(compiled.body.hash.length, 64);
  assert.equal(compiled.body.timeline.totalSec, 30);
  const afterCompile = await api(`/virtual/${id}/dsl`);
  assert.equal(afterCompile.body.compiled.hash, compiled.body.hash);

  // patch 局部修改
  const patched = await api(`/virtual/${id}/patch`, { method: 'POST', body: JSON.stringify({ patches: [{ op: 'set', targetId: 'sh-1', path: 'camera.fov', value: 40 }] }) });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.dsl.shots[0].camera.fov, 40);
  assert.equal(patched.body.dsl.shots[1].camera.fov, 38);

  // 非 virtual 项目访问 → 404
  const script = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'script', name: 'S' }) });
  const wrong = await api(`/virtual/${script.body.id}/dsl`);
  assert.equal(wrong.status, 404);
});
