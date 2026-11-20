import React, { useEffect, useState } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { api } from '../api.js';

const TABS = [
  { id: 'project', label: 'Project' },
  { id: 'format', label: 'Format' },
  { id: 'ai', label: 'AI' },
];

export default function ProjectSettingsDialog({ project, onClose, onSaved }) {
  const [tab, setTab] = useState('project');
  const [draft, setDraft] = useState(() => ({
    name: project.name || '',
    logline: project.logline || project.cover?.logline || '',
    synopsis: project.synopsis || '',
    advisorId: project.advisorId || '',
    cover: { ...(project.cover || {}) },
    settings: {
      format: project.settings?.format || 'hollywood',
      language: project.settings?.language || 'zh',
      exportConvention: project.settings?.exportConvention || 'hollywood',
      aiScope: project.settings?.aiScope || 'scene',
      aiAuthority: project.settings?.aiAuthority || 'script',
    },
  }));
  const [advisors, setAdvisors] = useState([]);
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.ai.advisors().then(setAdvisors).catch(() => {});
    api.usage.get(30).then(setUsage).catch(() => {});
  }, []);

  function patchSettings(patch) {
    setDraft(d => ({ ...d, settings: { ...d.settings, ...patch } }));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const saved = await api.projects.saveSettings(project.id, draft, project.revision);
      onSaved?.(saved);
      onClose?.();
    } catch (e) { setError(e.message || '保存失败'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal project-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>项目设置</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="settings-tabs">
          {TABS.map(t => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
        <div className="settings-body">
          {error && <div className="alert error sm">{error}</div>}
          {tab === 'project' && <>
            <label>项目名称<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Logline<input value={draft.logline} onChange={e => setDraft({ ...draft, logline: e.target.value })} placeholder="一句话说明主角、欲望与阻力" /></label>
            <label>项目简介<textarea rows={4} value={draft.synopsis} onChange={e => setDraft({ ...draft, synopsis: e.target.value })} /></label>
            <div className="form-two">
              <label>封面标题<input value={draft.cover.title || ''} onChange={e => setDraft({ ...draft, cover: { ...draft.cover, title: e.target.value } })} /></label>
              <label>作者<input value={draft.cover.author || ''} onChange={e => setDraft({ ...draft, cover: { ...draft.cover, author: e.target.value } })} /></label>
            </div>
            <p className="muted small">项目类型：{project.type === 'cinema' ? 'Cinema' : 'Script'}。封面信息只写入 project.cover，不污染剧本节点。</p>
          </>}
          {tab === 'format' && <>
            <label>剧本惯例<select value={draft.settings.format} onChange={e => { patchSettings({ format: e.target.value, exportConvention: e.target.value }); }}>
              <option value="hollywood">Hollywood</option><option value="asian">Asian</option>
            </select></label>
            <label>语言<select value={draft.settings.language} onChange={e => patchSettings({ language: e.target.value })}>
              <option value="zh">中文</option><option value="en">English</option>
            </select></label>
            <label>导出约定<select value={draft.settings.exportConvention} onChange={e => patchSettings({ exportConvention: e.target.value })}>
              <option value="hollywood">Hollywood</option><option value="asian">Asian</option>
            </select></label>
            <p className="muted small">导出弹窗里的「剧本惯例」直接读写这里，不会有第二份格式状态。</p>
          </>}
          {tab === 'ai' && <>
            <label>默认顾问<select value={draft.advisorId} onChange={e => setDraft(d => ({ ...d, advisorId: e.target.value }))}>
              <option value="">未指定</option>
              {advisors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>
            <p className="muted small">顾问也可在工作台的「顾问视角」里随时切换。此处设置随项目保存。</p>
            <label>默认读取范围<select value={draft.settings.aiScope} onChange={e => patchSettings({ aiScope: e.target.value })}>
              {['cursor', 'selection', 'node', 'range', 'scene', 'outline', 'full'].map(s => <option key={s} value={s}>{s}</option>)}
            </select></label>
            <label>默认权限层<select value={draft.settings.aiAuthority} onChange={e => patchSettings({ aiAuthority: e.target.value })}>
              {['script', 'outline', 'entities', 'worldview'].map(s => <option key={s} value={s}>{s}</option>)}
            </select></label>
            <div className="callout">Script Doctor 在工作台 AI 面板中按「诊断 → 处方 → 采纳」执行；模型与单价仍在全局设置里维护。</div>
            <div className="muted small">{usage ? `近 30 天全部项目：${usage.total.calls} 次调用，¥${Number(usage.total.cost).toFixed(4)}（项目级明细随 usage.projectId 逐步补齐）。` : '用量加载中…'}</div>
          </>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} 保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
