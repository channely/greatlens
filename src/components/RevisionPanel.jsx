import React, { useEffect, useState } from 'react';
import { X, GitBranch, Sparkles, Check, Plus, Trash2, Loader2 } from 'lucide-react';
import { api } from '../api.js';

// 草稿级修订面板：节拍/节点粒度的 Option 备选 + 修订说明。
// 提案不直接写项目；作者选择某个 Option 或写明修订说明后才按 revision 安全写入。
export default function RevisionPanel({ project, episodeId, onClose, onSaved }) {
  const ep = (project.episodes || []).find(e => e.id === episodeId) || project.episodes?.[0];
  const targets = [
    ...(ep?.beats || []).map(b => ({ id: b.id, kind: 'beat', label: `节拍 · ${b.name || '未命名'}`, text: b.summary || '' })),
    ...(ep?.nodes || []).filter(n => n.text).map(n => ({ id: n.id, kind: 'node', label: `节点 · ${n.type}`, text: String(n.text).slice(0, 60) })),
  ];

  const [targetId, setTargetId] = useState(targets[0]?.id || '');
  const [kind, setKind] = useState(targets[0]?.kind || 'beat');
  const [proposal, setProposal] = useState(null);
  const [data, setData] = useState({ revisionNotes: [], optionGroups: [] });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function reload() {
    api.projects.revisions.list(project.id, ep?.id)
      .then(setData).catch(e => setError(e.message || '加载失败'));
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [project.id, episodeId]);

  function pickTarget(id) {
    const t = targets.find(x => x.id === id);
    setTargetId(id); setKind(t?.kind || 'beat'); setProposal(null); setError('');
  }

  async function propose() {
    setBusy(true); setError(''); setInfo('');
    try {
      const r = await api.projects.revisions.propose(project.id, { episodeId: ep.id, kind, targetId });
      setProposal(r);
    } catch (e) { setError(e.message || '生成备选失败'); }
    finally { setBusy(false); }
  }

  async function choose(alternativeId) {
    if (!proposal) return;
    setBusy(true); setError(''); setInfo('');
    try {
      await api.projects.revisions.apply(project.id, {
        episodeId: ep.id, group: proposal.group, token: proposal.token,
        alternativeId, baseRevision: project.revision,
      });
      setProposal(null); setInfo('已按当前 revision 采纳该 Option，自动保存了一个版本快照。');
      reload(); onSaved?.();
    } catch (e) { setError(e.message || '采纳失败'); }
    finally { setBusy(false); }
  }

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true); setError(''); setInfo('');
    try {
      await api.projects.revisions.addNote(project.id, {
        episodeId: ep.id, kind, targetId, note, baseRevision: project.revision,
      });
      setNote(''); setInfo('修订说明已记录，不改动原文。'); reload(); onSaved?.();
    } catch (e) { setError(e.message || '记录失败'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal doctor-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3><GitBranch size={16} /> 修订说明与备选方案</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="muted small">为某个节拍或语义节点生成 Option 1/2/3，选定后才写入；修订说明只做批注，不改原文。全部按稳定 ID 与当前 revision 校验，过期提案会被拒绝。</p>
          {error && <div className="alert error sm">{error}</div>}
          {info && <div className="alert sm">{info}</div>}

          <div className="rev-section">
            <h4>选择目标</h4>
            <div className="rev-target-row">
              <select value={targetId} onChange={e => pickTarget(e.target.value)}>
                {targets.length === 0 && <option value="">（暂无节拍或节点）</option>}
                {targets.map(t => <option key={t.id} value={t.id}>{t.label} — {t.text}</option>)}
              </select>
              <button className="btn btn-primary sm" disabled={busy || !targetId} onClick={propose}><Sparkles size={13} /> 生成备选</button>
            </div>
          </div>

          {proposal && (
            <div className="rev-section">
              <h4>备选方案（原文：{proposal.group.expectedText.slice(0, 40) || '空'}）</h4>
              <div className="rev-options">
                {proposal.group.alternatives.map(a => (
                  <div className="rev-option" key={a.id}>
                    <div className="rev-option-head"><strong>{a.label}</strong>
                      <button className="apply-btn primary" disabled={busy} onClick={() => choose(a.id)}><Check size={12} /> 采纳此项</button>
                    </div>
                    <p>{a.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rev-section">
            <h4>添加修订说明</h4>
            <div className="rev-note-form">
              <input value={note} placeholder="写明需要修改的点，但不直接改原文…" onChange={e => setNote(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addNote(); }} />
              <button className="btn btn-ghost sm" disabled={busy || !note.trim() || !targetId} onClick={addNote}><Plus size={13} /> 记录</button>
            </div>
          </div>

          <div className="rev-section">
            <h4>已有修订说明（{data.revisionNotes.length}）</h4>
            {data.revisionNotes.length === 0 ? <p className="muted small">暂无。</p> : (
              <ul className="taste-list">{data.revisionNotes.map(n => (
                <li key={n.id}><span className="tag mini">{n.targetKind === 'beat' ? '节拍' : '节点'}</span><span>{n.text}</span></li>
              ))}</ul>
            )}
          </div>

          <div className="rev-section">
            <h4>已采纳的备选（{data.optionGroups.length}）</h4>
            {data.optionGroups.length === 0 ? <p className="muted small">暂无。</p> : (
              <ul className="taste-list">{data.optionGroups.map(g => (
                <li key={g.id}><span className="tag mini">{g.chosenLabel || '已选'}</span><span>{g.expectedText.slice(0, 40)}</span></li>
              ))}</ul>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
