// P1 对齐能力回归：分镜连续性硬约束 + Script→Cinema 显式转换。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 21000 + Math.floor(Math.random() * 20000);
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
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-p1-'));
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), GL_DATA_DIR: dataDir, GL_STUB_MODELS: '1' },
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

async function makeScript(name) {
  const r = await api('/projects', { method: 'POST', body: JSON.stringify({ type: 'script', name }) });
  assert.equal(r.status, 201);
  return r.data;
}

test('Script→Cinema 一次性转换：场景→reel、角色/道具复制、源项目不变、不往返', async () => {
  const src = await makeScript('转换源');
  const full = await api(`/projects/${src.id}`);
  const p = full.data;
  p.episodes[0].nodes = [
    { id: 'n1', type: 'scene', text: 'INT. 旧书店 - 雨夜' },
    { id: 'n2', type: 'character', text: '林夏' },
    { id: 'n3', type: 'dialogue', text: '你还是来了' },
    { id: 'n4', type: 'scene', text: 'EXT. 海边 - 黎明' },
    { id: 'n5', type: 'action', text: '她把信投入海中' },
  ];
  p.characters = [{ id: 'c1', name: '林夏', bio: '' }];
  p.props = [{ id: 'pr1', name: '未寄出的信' }];
  const saved = await api(`/projects/${src.id}`, { method: 'PUT', body: JSON.stringify(p), headers: { 'If-Match': String(p.revision) } });
  assert.equal(saved.status, 200, saved.data.error || '');

  const conv = await api(`/projects/${src.id}/to-cinema`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(conv.status, 201, conv.data.error || '');
  const c = conv.data;
  assert.equal(c.type, 'cinema');
  assert.equal(c.episodes[0].reels.length, 2, '两个场景应生成两个 reel');
  assert.ok(c.episodes[0].reels[0].scene.includes('旧书店'));
  assert.ok(c.episodes[0].reels[0].performance.includes('你还是来了'));
  assert.equal(c.characters[0].name, '林夏');
  assert.equal(c.props[0].name, '未寄出的信');
  assert.equal(c.convertedFrom.projectId, src.id);

  // 源项目仍是 script，节点未被改写
  const srcAfter = await api(`/projects/${src.id}`);
  assert.equal(srcAfter.data.type, 'script');
  assert.equal(srcAfter.data.episodes[0].nodes.length, 5);
});

test('分镜连续性硬约束：第一镜不要求前帧；后续镜要求前帧但缺失时在派发前阻断（不建任务/不扣费）', async () => {
  const p = await makeScript('连续性测试');
  const full = await api(`/projects/${p.id}`);
  const proj = full.data;
  const shots = [
    { id: 's1', scene: 'A', visual: '', continuity: false },
    { id: 's2', scene: 'B', visual: '', continuity: true },
  ];
  proj.episodes[0].shots = shots;
  await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(proj), headers: { 'If-Match': String(proj.revision) } });

  const epId = proj.episodes[0].id;
  // 第二镜开启续前帧，但第一镜没有分镜图 → 428
  const blocked = await api(`/projects/${p.id}/generations`, {
    method: 'POST',
    body: JSON.stringify({ purpose: 'storyboard', targetKind: 'shot', targetId: 's2', episodeId: epId, slot: 'refImage', requirePrevFrame: true, size: '1024*1024' }),
  });
  assert.equal(blocked.status, 428, JSON.stringify(blocked.data));
  assert.ok(String(blocked.data.error).includes('前帧'));

  // 未建任务：任务列表里没有 belong 到该 shot 的 storyboard 任务
  const tasks = await api('/media/tasks?limit=50');
  const leaked = (tasks.data.items || tasks.data || []).filter(t => t?.purpose === 'storyboard' && t?.binding?.entityId === 's2');
  assert.equal(leaked.length, 0, '阻断时不应生成任何任务');

  // 第一镜（无前帧要求）正常提交（外部模型用 stub，不真实扣费）
  const ok = await api(`/projects/${p.id}/generations`, {
    method: 'POST',
    body: JSON.stringify({ purpose: 'storyboard', targetKind: 'shot', targetId: 's1', episodeId: epId, slot: 'refImage', size: '1024*1024' }),
  });
  assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.data));
});
