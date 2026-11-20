import React, { useEffect, useState } from 'react';
import { X, Sparkles, Plus, Trash2, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { api } from '../api.js';

// 作者口味记忆面板：显式规则 + 采纳/弃用样本 + 开关。所有数据来自本地后端。
export default function TastePanel({ projectId, refreshKey, onClose }) {
  const [taste, setTaste] = useState(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('keep');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.projects.taste.get(projectId)
      .then(t => { if (alive) setTaste(t); })
      .catch(e => { if (alive) setError(e.message || '加载失败'); });
    return () => { alive = false; };
  }, [projectId, refreshKey]);

  async function mutate(fn, label) {
    setBusy(true); setError('');
    try { setTaste(await fn()); }
    catch (e) { setError(e.message || `${label}失败`); }
    finally { setBusy(false); }
  }

  function addRule() {
    if (!text.trim()) return;
    mutate(() => api.projects.taste.addRule(projectId, { text, kind }).then(t => { setText(''); return t; }), '添加规则');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal doctor-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3><Sparkles size={16} /> 作者口味记忆</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="muted small">助手会记住你采纳 / 弃用的写法，作为后续创作的长期偏好；优先级低于本次的具体要求。所有记录只存本机。</p>
          {error && <div className="alert error sm">{error}</div>}
          {!taste ? <div className="loading"><Loader2 className="spin" size={16} /> 加载中…</div> : (
            <>
              <div className="taste-toggle">
                <label>
                  <input type="checkbox" checked={taste.enabled !== false}
                    onChange={e => mutate(() => api.projects.taste.setEnabled(projectId, e.target.checked), '切换')} />
                  启用口味记忆
                </label>
                <span className="muted small">采纳 {taste.stats?.accepted || 0} · 弃用 {taste.stats?.rejected || 0}</span>
              </div>

              <div className="taste-section">
                <h4>显式规则</h4>
                <div className="taste-rule-form">
                  <select value={kind} onChange={e => setKind(e.target.value)}>
                    <option value="keep">保持</option>
                    <option value="avoid">避免</option>
                  </select>
                  <input value={text} placeholder="例如：对白短句为主，少用解释性台词" onChange={e => setText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addRule(); }} />
                  <button className="btn btn-primary sm" disabled={busy || !text.trim()} onClick={addRule}><Plus size={13} /> 添加</button>
                </div>
                {(taste.rules || []).length === 0
                  ? <p className="muted small">还没有显式规则。也可以直接对助手回复点「👍 喜欢 / 👎 弃用」。</p>
                  : <ul className="taste-list">
                    {(taste.rules || []).map(r => <li key={r.id}>
                      <span className={`tag mini ${r.kind === 'avoid' ? 'warn' : ''}`}>{r.kind === 'avoid' ? '避免' : '保持'}</span>
                      <span>{r.text}</span>
                      <button className="icon-btn danger" title="删除规则" disabled={busy} onClick={() => mutate(() => api.projects.taste.removeRule(projectId, r.id), '删除')}><Trash2 size={13} /></button>
                    </li>)}
                  </ul>}
              </div>

              <div className="taste-section">
                <h4><ThumbsUp size={13} /> 采纳过的写法</h4>
                {(taste.accepted || []).length === 0 ? <p className="muted small">暂无。</p> :
                  <ul className="taste-list">{taste.accepted.map((s, i) => <li key={i}><span>{typeof s === 'string' ? s : s.text}</span></li>)}</ul>}
              </div>

              <div className="taste-section">
                <h4><ThumbsDown size={13} /> 弃用过的写法</h4>
                {(taste.rejected || []).length === 0 ? <p className="muted small">暂无。</p> :
                  <ul className="taste-list">{taste.rejected.map((s, i) => <li key={i}><span>{typeof s === 'string' ? s : s.text}</span></li>)}</ul>}
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
