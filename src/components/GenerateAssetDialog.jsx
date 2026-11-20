import React, { useState } from 'react';
import { X, Wand2, Loader2 } from 'lucide-react';
import { api } from '../api.js';

export default function GenerateAssetDialog({ project, generation, onClose, onGenerated }) {
  const [extra, setExtra] = useState('');
  const [size, setSize] = useState('1024*1024');
  const [resolution, setResolution] = useState('480P');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function generate() {
    setBusy(true); setError('');
    try {
      const r = await api.projects.generate(project.id, {
        ...generation, extraPrompt: extra, size, resolution,
      });
      setResult(r);
      if (r.boundRef) onGenerated?.(r.boundRef);
    } catch (e) { setError(e.message || '生成失败'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal generate-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3><Wand2 size={16} /> 上下文生成</h3><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="generate-body">
          <p className="muted small">Prompt 从项目、对象档案与制作信息自动组装；你的输入只作为追加要求，不会替换既有设定。</p>
          {result?.prompt && <details className="prompt-preview"><summary>查看实际 prompt</summary><pre>{result.prompt}</pre></details>}
          <label>补充要求（可选）<textarea rows={3} value={extra} onChange={e => setExtra(e.target.value)} placeholder="例：冷蓝色调、低机位、保留雨夜反光" /></label>
          {generation?.purpose === 'trailer' ? (
            <label>分辨率<select value={resolution} onChange={e => setResolution(e.target.value)}>{['480P', '720P', '1080P'].map(x => <option key={x}>{x}</option>)}</select></label>
          ) : (
            <label>尺寸<select value={size} onChange={e => setSize(e.target.value)}>{['1024*1024', '1536*1024', '1024*1536'].map(x => <option key={x}>{x}</option>)}</select></label>
          )}
          {result && <div className="callout ok">{result.status === 'succeeded' ? (result.boundRef ? '已生成并回填到当前槽位。' : '已生成并进入素材库。') : '任务已提交，可在 Space 查看进度。'}</div>}
          {error && <div className="alert error sm">{error}</div>}
          {busy && <div className="loading"><Loader2 className="spin" size={14} /> 生成中…</div>}
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>关闭</button><button className="btn btn-primary" disabled={busy} onClick={generate}><Wand2 size={14} /> 生成</button></div>
      </div>
    </div>
  );
}
