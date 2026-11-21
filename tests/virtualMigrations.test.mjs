import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject } from '../server/store.js';
import { migrateDb } from '../server/migrations.js';

test('makeProject 三路分支：script / cinema / virtual 互不污染', () => {
  const s = makeProject('script', 'S');
  const c = makeProject('cinema', 'C');
  const v = makeProject('virtual', 'V');
  assert.ok(Array.isArray(s.episodes[0].nodes));
  assert.ok(Array.isArray(c.episodes[0].reels));
  assert.equal(c.film.orientation, 'landscape');
  assert.ok(Array.isArray(v.episodes[0].reels));
  assert.equal(v.virtual.dsl, null);
  assert.deepEqual(v.virtual.ipLocks, []);
  assert.deepEqual(v.virtual.workflowRuns, []);
  assert.deepEqual(v.virtual.renderJobs, []);
  assert.equal(v.film, undefined, 'virtual 不应带 cinema 的 film 字段');
});

test('migrateDb 对 virtual 项目幂等补齐全部子字段', () => {
  const raw = { projects: [{ id: 'v1', type: 'virtual', name: '旧库虚拟项目', episodes: [] }] };
  const once = migrateDb(structuredClone(raw));
  const twice = migrateDb(structuredClone(once));
  const p1 = once.projects[0], p2 = twice.projects[0];
  assert.deepEqual(p2.virtual, p1.virtual, '二次迁移不应改变已补字段');
  assert.equal(p1.virtual.assets.registryId, 'default');
  assert.equal(p1.virtual.compiled.dslHash, '');
  assert.ok(Array.isArray(p1.virtual.knowledgeState.facts));
});

test('migrateDb 不破坏 script / cinema 的既有字段', () => {
  const s = makeProject('script', 'S');
  const c = makeProject('cinema', 'C');
  const d = migrateDb({ projects: [s, c] });
  assert.ok(Array.isArray(d.projects[0].episodes[0].nodes));
  assert.ok(Array.isArray(d.projects[1].episodes[0].reels));
  assert.equal(d.projects[1].film.orientation, 'landscape');
  assert.equal(d.projects[0].virtual, undefined);
});
