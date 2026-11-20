// idea-first brief 专业分析填充：seed 解构成六字段 + 失败本地兜底 + 不覆盖用户已填字段。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { analyzeBrief } from '../server/idea.js';

test('localBriefAnalysis 从 seed 抽取六字段（stub/无 key 路径不卡死）', async () => {
  process.env.GL_STUB_MODELS = '1';
  const r = await analyzeBrief('一个 30 秒短片，关于迟到的道歉，克制、潮湿的调性', {});
  assert.ok(r.brief.length.includes('30'));
  assert.ok(r.brief.tone.includes('克制'));
  assert.ok(r.brief.theme.includes('道歉'));
  assert.ok(r.brief.protagonist && r.brief.desire && r.brief.opposition, '三要素都有默认值');
  assert.equal(r.source, 'local');
  delete process.env.GL_STUB_MODELS;
});

test('用户已填字段不被覆盖', async () => {
  process.env.GL_STUB_MODELS = '1';
  const r = await analyzeBrief('一段海边的告别', { protagonist: '林夏', theme: '我手动写的主题' });
  assert.equal(r.brief.protagonist, '林夏');
  assert.equal(r.brief.theme, '我手动写的主题');
  delete process.env.GL_STUB_MODELS;
});

// HTTP 端点（stub 模式）返回结构
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 25000 + Math.floor(Math.random() * 15000);
const BASE = `http://127.0.0.1:${PORT}/api`;
let dataDir, server;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-ideabrief-'));
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

test('POST /api/ai/idea/brief 可用且返回六字段（不再 404）', async () => {
  const res = await fetch(BASE + '/ai/idea/brief', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed: '一个关于 30 秒海边告别的克制故事' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  for (const k of ['protagonist', 'desire', 'opposition', 'length', 'tone', 'theme']) {
    assert.ok(k in data.brief, `brief 应含字段 ${k}`);
  }
  assert.ok(['ai', 'local'].includes(data.source));
});
