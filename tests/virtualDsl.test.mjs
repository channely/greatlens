import test from 'node:test';
import assert from 'node:assert/strict';
import {
  organelleDialogueTemplate, validateDsl, parseDslText, normalizeDsl,
  applyPatches, dslHash, buildDslSystemPrompt, DSL_SCHEMA_ID,
} from '../server/virtualDsl.js';

const REG = (() => {
  const t = organelleDialogueTemplate();
  return { allowedUrls: t.assets.map(a => a.modelRef?.url).filter(Boolean), assets: t.assets, voices: ['voice-narrator'] };
})();

test('内置细胞器模板通过校验且为 30 秒', () => {
  const t = organelleDialogueTemplate();
  const r = validateDsl(t, REG);
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.equal(r.dsl.meta.durationSec, 30);
  assert.equal(r.dsl.timeline.totalSec, 30);
  assert.equal(r.dsl.shots.reduce((s, x) => s + x.durationSec, 0), 30);
  assert.equal(r.dsl.dialogue.length, 4);
});

test('validateDsl 是确定性的：同输入同结果', () => {
  const t = organelleDialogueTemplate();
  const a = validateDsl(t, REG), b = validateDsl(t, REG);
  assert.deepEqual(a.diagnostics, b.diagnostics);
  assert.equal(dslHash(a.dsl), dslHash(b.dsl));
});

test('拒绝幻觉资产引用（未声明 assetId）', () => {
  const t = organelleDialogueTemplate();
  t.characters[0].assetId = 'hallucinated-nucleus';
  const r = validateDsl(t, REG);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'REF' && d.message.includes('hallucinated-nucleus')));
});

test('拒绝白名单外的 GLB URL', () => {
  const t = organelleDialogueTemplate();
  t.assets[0].modelRef.url = '/models/evil.glb';
  const r = validateDsl(t, REG);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'UNKNOWN_ASSET'));
});

test('拒绝未知顶层字段与非法枚举', () => {
  const t = organelleDialogueTemplate();
  t.unknownField = 1;
  t.meta.stylePreset = 'not-a-preset';
  const r = validateDsl(t, REG);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'UNKNOWN_KEY'));
  assert.ok(r.diagnostics.some(d => d.code === 'ENUM'));
});

test('拒绝时间闭包错误：镜头时长之和与 totalSec 不符', () => {
  const t = organelleDialogueTemplate();
  t.shots[0].durationSec = 9;
  const r = validateDsl(t, REG);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'TIMELINE'));
});

test('拒绝非法知识状态迁移与未知依赖', () => {
  const t = organelleDialogueTemplate();
  t.knowledge[1].dependencies = ['k-never-existed'];
  const r = validateDsl(t, REG);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'REF' && d.message.includes('k-never-existed')));
});

test('applyPatches 局部修改，仅目标字段变化', () => {
  const t = organelleDialogueTemplate();
  const before = dslHash(t);
  const { dsl, results } = applyPatches(t, [{ op: 'set', targetId: 'sh-1', path: 'camera.fov', value: 40 }], []);
  assert.ok(results.some(r => r.code === 'OK'));
  assert.equal(dsl.shots[0].camera.fov, 40);
  assert.equal(dsl.shots[1].camera.fov, 38);
  assert.notEqual(dslHash(dsl), before);
});

test('applyPatches 命中 IP 锁即拒绝且原子不生效', () => {
  const t = organelleDialogueTemplate();
  const locks = [{ refId: 'sh-1', path: 'camera.fov', locked: true }];
  const { dsl, results } = applyPatches(t, [{ op: 'set', targetId: 'sh-1', path: 'camera.fov', value: 12 }], locks);
  assert.ok(results.some(r => r.code === 'IP_LOCK'));
  assert.equal(dsl, t); // 原子：整批未生效
});

test('applyPatches 幻觉 targetId 被拒绝', () => {
  const t = organelleDialogueTemplate();
  const { dsl, results } = applyPatches(t, [{ op: 'set', targetId: 'shot-ghost', path: 'camera.fov', value: 40 }], []);
  assert.ok(results.some(r => r.code === 'PATCH' && r.message.includes('不存在')));
  assert.equal(dsl, t);
});

test('parseDslText 容忍 markdown fence 与前后解释文字', () => {
  const raw = '下面是 DSL：\n```json\n{\"a\":1}\n```\n以上是。';
  assert.deepEqual(parseDslText(raw), { a: 1 });
});

test('buildDslSystemPrompt 注入资产白名单', () => {
  const p = buildDslSystemPrompt(REG);
  assert.ok(p.includes('voice-narrator'));
  assert.ok(p.includes(DSL_SCHEMA_ID));
});

test('normalizeDsl 补默认数组，不改身份', () => {
  const t = organelleDialogueTemplate();
  delete t.dialogue;
  delete t.knowledge[0].dependencies;
  const n = normalizeDsl(t);
  assert.deepEqual(n.dialogue, []);
  assert.deepEqual(n.knowledge[0].dependencies, []);
  assert.equal(n.meta.id, t.meta.id);
});
