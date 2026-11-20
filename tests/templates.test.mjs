import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-templates-'));
process.env.GL_DATA_DIR = dataDir;
process.env.GL_STUB_MODELS = '1';

const { makeProject } = await import('../server/store.js');
const { applyStartTemplate, START_TEMPLATES } = await import('../server/templates.js');

test('模板目录包含三种起始模板', () => {
  assert.deepEqual(START_TEMPLATES.map(t => t.id), ['blank', 'three-act', 'character-first']);
});

test('三幕结构预置大纲与节拍，且每个节拍有稳定 id', () => {
  const p = applyStartTemplate(makeProject('script', '三幕'), 'three-act');
  const ep = p.episodes[0];
  assert.equal(ep.template, 'three-act');
  assert.equal(ep.outline.length, 3);
  assert.ok(ep.beats.length >= 6);
  assert.ok(ep.beats.every(b => b.id && b.name && b.summary));
});

test('角色优先预置角色骨架与节拍', () => {
  const p = applyStartTemplate(makeProject('script', '角色'), 'character-first');
  assert.equal(p.episodes[0].template, 'character-first');
  assert.equal(p.characters.length, 3);
  assert.ok(p.characters.every(c => c.id && c.name));
  assert.ok(p.episodes[0].beats.length >= 3);
});

test('空白模板保持空结构；未知模板回退空白；Cinema 不受影响', () => {
  const blank = applyStartTemplate(makeProject('script', '空白'), 'blank');
  assert.equal(blank.episodes[0].beats.length, 0);
  assert.equal(blank.characters.length, 0);
  const unknown = applyStartTemplate(makeProject('script', '未知'), 'nonsense');
  assert.equal(unknown.episodes[0].template, 'blank');
  const cinema = applyStartTemplate(makeProject('cinema', '短片'), 'three-act');
  assert.equal(cinema.episodes[0].template, undefined);
  assert.ok(Array.isArray(cinema.episodes[0].reels));
});

test.after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });
