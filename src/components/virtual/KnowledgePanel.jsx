import React from 'react';
import { BookOpen, Check, ArrowRight, ShieldCheck, AlertTriangle, Lock } from 'lucide-react';
import { api } from '../../api.js';

const STATE_LABEL = { introduced: '已引入', active: '讨论中', resolved: '已讲清' };
const STATE_CLASS = { introduced: 'intro', active: 'active', resolved: 'resolved' };
const NEXT = { introduced: 'active', active: 'resolved' };

export default function KnowledgePanel({ project, dsl, compiled, onRefresh, setError, setNotice }) {
  const facts = compiled?.knowledgeState?.facts || (dsl?.knowledge || []).map(k => ({ ...k }));

  async function transition(fact, to) {
    if (!project) return;
    try {
      await api.virtual.transition(project.id, fact.id, to);
      setNotice(`知识点「${fact.label}」→ ${STATE_LABEL[to]}`);
      await onRefresh();
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="card vp-panel-wide">
      <div className="vp-panel-head">
        <h3><BookOpen size={16} /> 科普知识状态追踪</h3>
        <p className="muted small">状态依次推进：已引入 → 讨论中 → 已讲清。依赖项须先于本条讲清，非法迁移会被拦截，保证科普逻辑连贯。</p>
      </div>
      {facts.length === 0 && <p className="muted">尚无知识点。生成 DSL 后，知识点会从 knowledge 字段投影至此。</p>}
      <div className="vp-knowledge-list">
        {facts.map(f => (
          <div key={f.id} className="vp-knowledge-row">
            <div className="vp-knowledge-main">
              <strong>{f.label || f.id}</strong>
              <span className="muted small">{f.statement}</span>
              <div className="vp-knowledge-meta">
                <span className={`vp-state ${STATE_CLASS[f.state]}`}>{STATE_LABEL[f.state] || f.state}</span>
                {(f.dependencies || []).length > 0 && <span className="muted small">依赖：{f.dependencies.join('、')}</span>}
                {f.introducedAtShotId && <span className="muted small">{f.introducedAtShotId} 引入</span>}
              </div>
            </div>
            <div className="vp-knowledge-action">
              {NEXT[f.state] && <button className="btn btn-ghost btn-sm" onClick={() => transition(f, NEXT[f.state])}>
                推进到 {STATE_LABEL[NEXT[f.state]]} <ArrowRight size={13} />
              </button>}
              {f.state === 'resolved' && <span className="vp-chip ok"><Check size={12} /> 完成</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="vp-ip-note"><ShieldCheck size={14} /> 主角形象、配音音色与材质受 IP 锁保护；局部修改命中锁定字段时会被拒绝。</div>
    </div>
  );
}
