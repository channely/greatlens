import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 隔离数据目录 + stub provider，确保不真实调用百炼、不污染真实 data/。
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'greatlens-reliability-'));
process.env.GL_DATA_DIR = dataDir;
process.env.GL_STUB_MODELS = '1';
process.env.GL_MAX_TASK_RESUBMITS = '1';
process.env.GL_RETRY_BASE_MS = '50';

const { usage, db } = await import('../server/store.js');
const media = await import('../server/media.js');

test('任务失败时后端自动重提，前端 taskId 保持稳定', async () => {
  const generated = await media.generateVideo({
    prompt: '可靠性测试', duration: 5, resolution: '480P', projectId: 'p-rel',
  });
  const stableId = generated.taskId;
  // 注入一次 provider 失败：首轮询应触发自动重提，返回同一 taskId + resubmitted。
  media.stubInjectFailure(stableId);
  const first = await media.pollTask(stableId);
  assert.equal(first.resubmitted, true, '首次失败应触发后端重提');
  assert.equal(first.taskId, stableId, '前端 taskId 不应变化');
  assert.equal(first.status, 'pending');

  const task = media.listTasks(50).find(t => t.taskId === stableId);
  assert.equal(task.resubmits, 1);
  assert.ok(task.remoteTaskId, '应记录重提后的 provider id');
  assert.notEqual(task.remoteTaskId, stableId);

  // 重提后的任务再次轮询应成功，且只计费一次。
  const second = await media.pollTask(stableId);
  assert.equal(second.status, 'succeeded');
  const rows = usage.refunds();
  assert.equal(rows.filter(r => r.refundKey === `task:${stableId}`).length, 0, '成功的任务不应被冲销');
  const charges = db.all().usage.filter(r => r.taskId === stableId && r.kind !== 'refund');
  assert.equal(charges.length, 1, '只记一次费用');
});

test('冲正幂等且按净额抵扣，不增加调用次数', () => {
  usage.clear();
  usage.add({ type: 'image', model: 'qwen-image-3.0', taskId: 't-refund', costOverride: 0.18, promptTokens: 10 });
  usage.add({ type: 'image', model: 'qwen-image-3.0', taskId: 't-refund', costOverride: 0.18, promptTokens: 10 });
  const before = usage.report(30);
  const callsBefore = before.total.calls;

  const r1 = usage.refund({ refundKey: 'task:t-refund', taskId: 't-refund', amount: 0.36, reason: '测试冲销' });
  const r2 = usage.refund({ refundKey: 'task:t-refund', taskId: 't-refund', amount: 0.36 });
  assert.equal(r1.created, true);
  assert.equal(r2.created, false, '同一幂等键不应重复冲正');

  const after = usage.report(30);
  assert.equal(after.total.calls, callsBefore, '冲正不应计入调用次数');
  assert.equal(Math.round(after.total.cost * 100) / 100, 0, '净额应为 0');
  assert.equal(usage.refunds().filter(r => r.refundKey === 'task:t-refund').length, 1);
});

test.after(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });
