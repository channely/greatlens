import React, { useState } from 'react';
import { X, Stethoscope, ClipboardList, Check, Loader2 } from 'lucide-react';
import { api } from '../api.js';

const OP_LABEL = {
  replace_node_text: '替换节点文本',
  insert_after: '在节点后插入',
  delete_node: '删除节点',
  replace_char_range: '替换字符范围',
};

export default function ScriptDoctorPanel({ project, episodeId, onClose, onSaved }) {
  const [stage, setStage] = useState('idle');
  const [diagnosis, setDiagnosis] = useState(null);
  const [token, setToken] = useState('');
  const [actions, setActions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function diagnose() {
    setBusy(true); setError('');
    try {
      const r = await api.ai.act({ projectId: project.id, episodeId, mode: 'doctor-diagnose' });
      setDiagnosis(r.envelope.diagnosis);
      setToken(r.envelope.diagnosisToken);
      setActions([]);
      setStage('diagnosed');
    } catch (e) { setError(e.message || '诊断失败'); }
    finally { setBusy(false); }
  }

  async function prescribe() {
    if (!token) { setError('请先完成诊断。'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.ai.act({ projectId: project.id, episodeId, mode: 'doctor-prescribe', diagnosis, diagnosisToken: token });
      setActions(r.envelope.actions || []);
      setSelected((r.envelope.actions || []).map((_, i) => i));
      setStage('prescribed');
    } catch (e) { setError(e.message || '生成处方失败'); }
    finally { setBusy(false); }
  }

  async function adopt() {
    const chosen = selected.map(i => actions[i]).filter(Boolean);
    if (!chosen.length) { setError('请至少选择一条处方。'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.ai.act({
        projectId: project.id, episodeId, actions: chosen,
        baseRevision: project.revision, apply: true,
      });
      onSaved?.(r.project);
      onClose?.();
    } catch (e) { setError(e.message || '采纳失败'); }
    finally { setBusy(false); }
  }

  function toggle(i) {
    setSelected(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal doctor-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3><Stethoscope size={16} /> 剧本医生</h3><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="doctor-body">
          <div className="doctor-steps">
            <span className={stage !== 'idle' ? 'active' : ''}>1 诊断</span>
            <span className={stage === 'prescribed' ? 'active' : ''}>2 处方</span>
            <span className={stage === 'prescribed' ? 'active' : ''}>3 采纳</span>
          </div>
          {error && <div className="alert error sm">{error}</div>}
          {stage === 'idle' && <p className="muted small">先定位根因与病灶；诊断完成前不能生成处方，也不会改动剧本。</p>}
          {diagnosis && <div className="doctor-diagnosis">
            <h4>诊断</h4>
            <p>{diagnosis.rootCause}</p>
            <div className="muted small">位置：{diagnosis.location || '未定位'} · lens：{diagnosis.lens}</div>
            {diagnosis.evidence?.map((ev, i) => <div className="doctor-evidence" key={i}>
              <span className="tag mini">{ev.type}</span> {ev.chars} 字 · {ev.text}
            </div>)}
          </div>}
          {actions.length > 0 && <div className="doctor-actions">
            <h4><ClipboardList size={14} /> 可执行处方</h4>
            {actions.map((a, i) => (
              <label className={`doctor-action ${selected.includes(i) ? 'on' : ''}`} key={i}>
                <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} />
                <span className="doctor-action-body">
                  <span className="doctor-action-head">
                    <span className="tag mini">{a.priority === 'high' ? '优先' : '可选'}</span>
                    <strong>{OP_LABEL[a.op] || a.op}</strong>
                    <code>{a.targetNodeId?.slice(0, 8)}</code>
                  </span>
                  <span>{JSON.stringify(a.payload)}</span>
                  <span className="muted small">保护作者意图：{a.protectIntent || '未说明'}</span>
                </span>
              </label>
            ))}
          </div>}
          {busy && <div className="loading"><Loader2 className="spin" size={14} /> 处理中…</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          {stage === 'idle' && <button className="btn btn-primary" disabled={busy} onClick={diagnose}>开始诊断</button>}
          {stage === 'diagnosed' && <button className="btn btn-primary" disabled={busy} onClick={prescribe}>生成处方</button>}
          {stage === 'prescribed' && <button className="btn btn-primary" disabled={busy} onClick={adopt}><Check size={14} /> 采纳所选</button>}
        </div>
      </div>
    </div>
  );
}
