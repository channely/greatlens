import React, { useEffect, useState } from 'react';
import { History, RotateCcw, Trash2, X, Check, Pencil, Loader2 } from 'lucide-react';
import { api } from '../api.js';

const KIND_LABEL = { auto: '自动', manual: '命名', 'pre-restore': '恢复前' };

function when(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('zh-CN', { hour12: false });
}

export default function VersionHistory({ projectId, baseRevision, onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try { setVersions(await api.projects.versions.list(projectId)); }
    catch (e) { setError(e.message || '载入版本失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectId]);

  async function createManual() {
    setBusy(true);
    setError('');
    try {
      await api.projects.versions.create(projectId, { name: name.trim() || `命名版本 · ${new Date().toLocaleString('zh-CN', { hour12: false })}` });
      setName('');
      await load();
    } catch (e) { setError(e.message || '创建版本失败'); }
    finally { setBusy(false); }
  }

  async function rename(versionId) {
    setBusy(true);
    setError('');
    try {
      await api.projects.versions.update(projectId, versionId, { name: editName.trim() });
      setEditingId(null);
      await load();
    } catch (e) { setError(e.message || '重命名失败'); }
    finally { setBusy(false); }
  }

  async function remove(versionId) {
    if (!window.confirm('删除这个版本快照？此操作不可撤销。')) return;
    setBusy(true);
    setError('');
    try {
      await api.projects.versions.remove(projectId, versionId);
      await load();
    } catch (e) { setError(e.message || '删除失败'); }
    finally { setBusy(false); }
  }

  async function restore(version) {
    if (!window.confirm(`恢复到「${version.name}」？\n当前未保存的编辑会被覆盖，恢复前会自动再存一份备份。`)) return;
    setBusy(true);
    setError('');
    try {
      const project = await api.projects.versions.restore(projectId, version.id, baseRevision);
      onRestored?.(project);
    } catch (e) { setError(e.message || '恢复失败'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal version-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3><History size={16} /> 版本历史</h3>
          <button className="icon-btn" title="关闭" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="version-body">
          <p className="muted small">自动版本记录编辑前状态；命名版本不会自动清理；恢复前会额外备份当前状态。</p>
          <div className="version-create">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="给当前已保存状态起个名字（可选）" />
            <button className="btn btn-ghost sm" disabled={busy} onClick={createManual}><History size={13} /> 存为版本</button>
          </div>
          {error && <div className="alert error small">{error}</div>}
          {loading && <div className="loading"><Loader2 className="spin" size={16} /> 载入版本…</div>}
          {!loading && versions.length === 0 && <div className="empty small">还没有版本。开始编辑或手动存一版后会出现在这里。</div>}
          <div className="version-list">
            {versions.map(v => (
              <div className="version-row" key={v.id}>
                <div className="version-info">
                  <div className="version-line">
                    <span className="tag mini">{KIND_LABEL[v.kind] || v.kind}</span>
                    {editingId === v.id ? (
                      <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') rename(v.id); }} />
                    ) : <strong>{v.name}</strong>}
                  </div>
                  <div className="muted small">{when(v.createdAt)} · {v.hasSnapshot ? '快照可用' : '快照缺失'} · {v.hash?.slice(0, 8) || '—'}</div>
                </div>
                <div className="version-actions">
                  {editingId === v.id ? (
                    <button className="icon-btn" title="保存名称" disabled={busy} onClick={() => rename(v.id)}><Check size={14} /></button>
                  ) : (
                    <button className="icon-btn" title="重命名" disabled={busy} onClick={() => { setEditingId(v.id); setEditName(v.name); }}><Pencil size={14} /></button>
                  )}
                  <button className="icon-btn" title="恢复到这个版本" disabled={busy || !v.hasSnapshot} onClick={() => restore(v)}><RotateCcw size={14} /></button>
                  <button className="icon-btn danger" title="删除版本" disabled={busy} onClick={() => remove(v.id)}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
