import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDsl, computeTimeline, advanceKnowledge, validateSceneGraph } from '../server/virtualInterpreter.js';
import { organelleDialogueTemplate } from '../server/virtualDsl.js';

test('compileDsl 幂等：同输入同 hash，产物结构完整', () => {
  const t = organelleDialogueTemplate();
  const a = compileDsl(t), b = compileDsl(t);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics));
  assert.equal(a.hash, b.hash);
  assert.equal(a.sceneGraph.nodes.length, 3); // env + 2 角色；背景图 prop 不是 3D 节点
  assert.deepEqual(a.sceneGraph.nodes.map(n => n.id), ['env-cell', 'ch-nucleus', 'ch-mito']);
  assert.equal(a.timeline.totalSec, 30);
  assert.equal(a.knowledgeState.facts.length, 2);
});

test('compileDsl 拒绝幻觉引用并返回 ok=false', () => {
  const t = organelleDialogueTemplate();
  t.shots[0].sceneId = 'scene-that-does-not-exist';
  const r = compileDsl(t);
  assert.equal(r.ok, false);
  assert.equal(r.sceneGraph.nodes.length, 0);
  assert.ok(r.diagnostics.some(d => d.code === 'REF'));
});

test('computeTimeline 计算三镜时间窗与对白区间', () => {
  const t = organelleDialogueTemplate();
  const tl = computeTimeline(t);
  assert.deepEqual(tl.shots.map(s => [s.startSec, s.endSec]), [[0, 8], [8, 18], [18, 30]]);
  assert.equal(tl.dialogue.find(d => d.id === 'd-2').shotId, 'sh-2');
  assert.equal(tl.dialogue.find(d => d.id === 'd-4').endSec, 29);
});

test('advanceKnowledge 只允许递进，拒绝回退与非法状态', () => {
  const s = { id: 'k1', state: 'introduced' };
  assert.equal(advanceKnowledge(s, { to: 'active' }).ok, true);
  assert.equal(advanceKnowledge(s, { to: 'resolved' }).state.state, 'resolved');
  assert.equal(advanceKnowledge({ state: 'resolved' }, { to: 'introduced' }).ok, false);
  assert.equal(advanceKnowledge(s, { to: 'bogus' }).ok, false);
});

test('validateSceneGraph 检查节点类型与角色资产', () => {
  assert.deepEqual(validateSceneGraph({ nodes: [{ id: 'e', kind: 'environment' }, { id: 'c', kind: 'character', assetId: 'a', assetUrl: '/x.glb' }] }), []);
  const d = validateSceneGraph({ nodes: [{ id: 'c', kind: 'character' }] });
  assert.ok(d.some(x => x.code === 'GRAPH'));
});
