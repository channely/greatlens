import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-revisions-'));
process.env.GL_DATA_DIR = dataDir;
process.env.GL_STUB_MODELS = '1';

const { db, makeProject } = await import('../server/store.js');
const revisions = await import('../server/revisions.js');

function seed() {
  const p = makeProject('script', '修订测试');
  p.episodes[0].beats = [{ id: 'b1', name: '催化剂', summary: '他决定离开这座城市。' }];
  p.episodes[0].nodes = [{ id: 'n1', type: 'action', text: '林夏推开门。' }];
  db.update(d => { d.projects.push(p); });
  return p;
}

test('备选提案默认不写项目；采纳按 revision 与原文校验', () => {
  const p = seed();
  const epId = p.episodes[0].id;
  const proposal = revisions.proposeOptions({ projectId: p.id, episodeId: epId, kind: 'beat', targetId: 'b1' });
  assert.equal(proposal.group.alternatives.length, 3);
  assert.match(proposal.group.alternatives[0].label, /Option 1/);
  assert.ok(proposal.token);

  // 提案阶段不写项目
  assert.equal(db.all().projects.find(x => x.id === p.id).episodes[0].beats[0].summary, '他决定离开这座城市。');

  const current = db.all().projects.find(x => x.id === p.id);
  const chosen = proposal.group.alternatives[1];
  revisions.applyOption({
    projectId: p.id, episodeId: epId, group: proposal.group,
    token: proposal.token, alternativeId: chosen.id, baseRevision: current.revision,
  });
  const after = db.all().projects.find(x => x.id === p.id);
  assert.equal(after.episodes[0].beats[0].summary, chosen.text);
  assert.equal(after.episodes[0].optionGroups[0].chosenId, chosen.id);
  assert.equal(after.revision, current.revision + 1);

  // 过期 token / 错误 revision 被拒绝
  assert.throws(() => revisions.applyOption({
    projectId: p.id, episodeId: epId, group: proposal.group, token: proposal.token,
    alternativeId: chosen.id, baseRevision: current.revision,
  }), /已被其他会话更新|令牌|内容已变化|不存在/);
});

test('修订说明记录为批注，不改原文；空说明被拒绝', () => {
  const p = seed();
  const epId = p.episodes[0].id;
  const before = db.all().projects.find(x => x.id === p.id);
  assert.throws(() => revisions.addRevisionNote({ projectId: p.id, episodeId: epId, note: '  ' }), /不能为空/);
  revisions.addRevisionNote({ projectId: p.id, episodeId: epId, kind: 'node', targetId: 'n1', note: '这里应展示而非说明', baseRevision: before.revision });
  const after = db.all().projects.find(x => x.id === p.id);
  assert.equal(after.episodes[0].nodes[0].text, '林夏推开门。');
  assert.equal(after.episodes[0].revisionNotes[0].text, '这里应展示而非说明');
});

test.after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });
