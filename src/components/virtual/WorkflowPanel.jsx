import React, { useEffect, useState } from 'react';
import { GitBranch, Play, Loader2, Check, AlertTriangle, RotateCcw, Circle } from 'lucide-react';
import { api } from '../../api.js';

const STEP_LABELS = {
  parse: '解析 DSL', assets: '资产绑定', assemble: '场景组装', shots: '镜头校验',
  render: '渲染帧序列', voiceover: '配音与字幕', package: '封装成片',
};

export default function WorkflowPanel({ project, onRefresh, setError, setNotice }) {
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    (async () => {
      try {
        const list = project.virtual?.workflowRuns || [];
        if (list.length) setRun(list[list.length - 1]);
      } catch {}
    })();
  }, [project]);

  async function start() {
    if (!project) return;
    setBusy(true); setError('');
    try {
      const r = await api.virtual.workflowStart(project.id, {});
      setRun(r);
      setNotice('工作流已启动，按步骤记录状态。');
      await onRefresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function advance(stepId) {
    if (!project || !run) return;
    setBusy(true);
    try {
      const r = await api.virtual.workflowAdvance(project.id, run.id, stepId);
      setRun(r);
      await onRefresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function retry(stepId) {
    if (!project || !run) return;
    setBusy(true);
    try {
      const r = await api.virtual.workflowRetry(project.id, run.id, stepId);
      setRun(r);
      await onRefresh();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const steps = run?.steps || Object.keys(STEP_LABELS).map(id => ({ id, name: STEP_LABELS[id], status: 'pending' }));

  return (
    <div className="card vp-panel-wide">
      <div className="vp-panel-head">
        <h3><GitBranch size={16} /> 生产工作流</h3>
        <p className="muted small">把「DSL 解析 → 资产 → 组装 → 镜头 → 渲染 → 配音字幕 → 封装」固化为可复用管线；这不是通用节点图，而是确定性的七步流水线。</p>
        <button className="btn btn-primary btn-sm" onClick={start} disabled={busy || !project}>
          {busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />} 启动工作流
        </button>
      </div>
      <div className="vp-workflow-list">
        {steps.map((s, i) => (
          <div key={s.id} className={`vp-wf-step ${s.status}`}>
            <span className="vp-wf-index">{i + 1}</span>
            <span className="vp-wf-name">{s.name || STEP_LABELS[s.id]}</span>
            <span className={`vp-wf-status ${s.status}`}>
              {s.status === 'succeeded' ? <Check size={14} /> : s.status === 'failed' ? <AlertTriangle size={14} /> :
                s.status === 'running' ? <Loader2 size={14} className="spin" /> : <Circle size={14} />}
              {s.status}
            </span>
            {s.status === 'failed' && <button className="btn btn-ghost btn-sm" onClick={() => retry(s.id)}><RotateCcw size={13} /> 重试</button>}
            {s.status === 'pending' && <button className="btn btn-ghost btn-sm" onClick={() => advance(s.id)}>执行</button>}
          </div>
        ))}
      </div>
      {run && <p className="muted small">Run {run.id} · 状态 {run.status} · 创建于 {new Date(run.createdAt).toLocaleString()}</p>}
    </div>
  );
}
