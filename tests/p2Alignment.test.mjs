// P2 对齐能力回归：AI 知识正文注入、Cinema 视频任务 reel 绑定、世界观值可写。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { buildMessages } from '../server/ai.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 23000 + Math.floor(Math.random() * 18000);
const BASE = `http://127.0.0.1:${PORT}/api`;
let dataDir;
let server;

async function api(urlPath, opts = {}) {
  const res = await fetch(BASE + urlPath, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-p2-'));
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), GL_DATA_DIR: dataDir, GL_STUB_MODELS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', () => {});
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/projects'); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('服务器启动超时');
});

after(async () => {
  if (server && !server.killed) { server.kill('SIGTERM'); await once(server, 'exit'); }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('AI prompt 注入本次点名的知识正文与用途，且世界观规则可读', () => {
  const msgs = buildMessages({
    prompt: '按资料写开场',
    project: {
      worldview: { '通信延迟': '消息需要九年' },
      knowledgeIndex: [{ id: 'k1', name: '设定集', type: 'reference', summary: '灯塔背景' }],
      knowledgeExcerpts: [{ name: '设定集', role: '时代背景证据', body: '灯塔在第三礁石上，守塔人失踪。' }],
    },
  });
  const sys = msgs[0].content;
  assert.ok(sys.includes('本次点名加载的资料正文'));
  assert.ok(sys.includes('时代背景证据'));
  assert.ok(sys.includes('灯塔在第三礁石上'));
  assert.ok(sys.includes('通信延迟 = 消息需要九年'));
});

test('世界观值可就地改写并随 revision 保存', async () => {
  const c = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'script', name: '世界观写入' }) });
  const p = (await api(`/projects/${c.data.id}`)).data;
  p.worldview = { '规则A': '旧值' };
  await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(p), headers: { 'If-Match': String(p.revision) } });
  const cur = (await api(`/projects/${p.id}`)).data;
  cur.worldview['规则A'] = '新值';
  const saved = await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(cur), headers: { 'If-Match': String(cur.revision) } });
  assert.equal(saved.status, 200);
  assert.equal((await api(`/projects/${p.id}`)).data.worldview['规则A'], '新值');
});

test('Cinema 视频任务在后端带 reelId/binding，可与自由生成区分', async () => {
  const c = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'cinema', name: '任务分流' }) });
  const gen = await api('/media/video', {
    method: 'POST',
    body: JSON.stringify({
      prompt: '海边告别', duration: 30, resolution: '480P', projectId: c.data.id,
      reelId: 'reel-1', binding: { kind: 'project', projectId: c.data.id, entityId: c.data.id, episodeId: 'ep1', slot: 'asset', side: 'reel:reel-1' },
    }),
  });
  assert.ok([200, 201].includes(gen.status), JSON.stringify(gen.data));
  const tasks = await api('/media/tasks?limit=50');
  const list = tasks.data.items || tasks.data || [];
  const reelTask = list.find(t => t.taskId === gen.data.taskId);
  assert.ok(reelTask, '任务应出现在列表');
  assert.equal(reelTask.reelId, 'reel-1');
  assert.equal(reelTask.binding.side, 'reel:reel-1');
});
