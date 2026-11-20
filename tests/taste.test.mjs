import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-taste-'));
process.env.GL_DATA_DIR = dataDir;
process.env.GL_STUB_MODELS = '1';

const { getTaste, recordFeedback, addRule, removeRule, setTasteEnabled, tastePrompt } = await import('../server/taste.js');

test('反馈被记录为偏好并生成可解释提示', () => {
  recordFeedback('p-taste', { verdict: 'accepted', text: '对白短促，潜台词为主', mode: 'dialogue' });
  recordFeedback('p-taste', { verdict: 'rejected', text: '大段解释性独白', mode: 'rewrite' });
  const t = getTaste('p-taste');
  assert.equal(t.stats.accepted, 1);
  assert.equal(t.stats.rejected, 1);
  assert.ok(t.accepted.some(s => String(s).includes('对白短促')));
  assert.ok(t.rejected.some(s => String(s).includes('解释性独白')));

  addRule('p-taste', { text: '保持冷色调', kind: 'keep' });
  addRule('p-taste', { text: '不要用感叹号', kind: 'avoid' });
  const prompt = tastePrompt(getTaste('p-taste'));
  assert.match(prompt, /作者长期偏好/);
  assert.match(prompt, /保持冷色调/);
  assert.match(prompt, /不要用感叹号/);
  assert.match(prompt, /作者采纳过的写法/);
  assert.match(prompt, /作者弃用过的写法/);
});

test('关闭后不再注入；非法 verdict 被拒绝', () => {
  setTasteEnabled('p-taste', false);
  assert.equal(tastePrompt(getTaste('p-taste')), '');
  assert.throws(() => recordFeedback('p-taste', { verdict: 'maybe', text: 'x' }), /verdict/);
});

test('规则可删除，口味按项目隔离', () => {
  const t = getTaste('p-taste');
  const rule = t.rules.find(r => r.text === '保持冷色调');
  removeRule('p-taste', rule.id);
  assert.ok(!getTaste('p-taste').rules.some(r => r.id === rule.id));
  assert.equal(getTaste('other-project').rules.length, 0);
  assert.equal(getTaste('other-project').stats.accepted, 0);
});

test.after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });
