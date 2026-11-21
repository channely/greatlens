// 固定七步生产管线（非通用节点图）。状态写入 project.virtual.workflowRuns[]。
import { db, uid } from './store.js';

export const PIPELINE_STEPS = [
  { id: 'parse', name: '解析 DSL' },
  { id: 'assets', name: '资产绑定' },
  { id: 'assemble', name: '场景组装' },
  { id: 'shots', name: '镜头校验' },
  { id: 'render', name: '渲染帧序列' },
  { id: 'voiceover', name: '配音与字幕' },
  { id: 'package', name: '封装成片' },
];

const BAD = (m, s = 422) => Object.assign(new Error(m), { status: s });

function findVirtual(d, id) {
  const p = d.projects.find(x => x.id === id);
  if (!p || p.type !== 'virtual') throw BAD('虚拟项目不存在', 404);
  return p;
}

export function startWorkflow(projectId) {
  return db.update(d => {
    const p = findVirtual(d, projectId);
    const run = {
      id: `wf_${uid()}`, projectId, createdAt: new Date().toISOString(), status: 'running',
      steps: PIPELINE_STEPS.map(s => ({ id: s.id, name: s.name, status: 'pending', attempts: 0 })),
    };
    p.virtual.workflowRuns.push(run);
    return run;
  });
}

function updateStep(projectId, runId, stepId, mutator) {
  return db.update(d => {
    const p = findVirtual(d, projectId);
    const run = (p.virtual.workflowRuns || []).find(r => r.id === runId);
    if (!run) throw BAD('工作流不存在', 404);
    const step = run.steps.find(s => s.id === stepId);
    if (!step) throw BAD(`步骤 ${stepId} 不存在`);
    mutator(step);
    if (run.steps.every(s => s.status === 'succeeded' || s.status === 'skipped')) run.status = 'succeeded';
    if (run.steps.some(s => s.status === 'failed')) run.status = 'failed';
    return run;
  });
}

export function advanceWorkflow(projectId, runId, stepId, result = {}) {
  return updateStep(projectId, runId, stepId, s => {
    s.status = 'succeeded'; s.attempts += 1;
    s.finishedAt = new Date().toISOString();
    if (result.outputRef) s.outputRef = result.outputRef;
    delete s.error;
  });
}

export function retryStep(projectId, runId, stepId) {
  return updateStep(projectId, runId, stepId, s => {
    s.status = 'pending'; delete s.error;
  });
}

export function workflowStatus(projectId, runId) {
  const p = db.all().projects.find(x => x.id === projectId);
  if (!p || p.type !== 'virtual') throw BAD('虚拟项目不存在', 404);
  const runs = p.virtual.workflowRuns || [];
  if (runId) { const r = runs.find(x => x.id === runId); if (!r) throw BAD('工作流不存在', 404); return r; }
  return runs[runs.length - 1] || null;
}
