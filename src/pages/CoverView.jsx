import React, { useState } from 'react';
import { FileText, Image as ImageIcon, Loader2, Wand2 } from 'lucide-react';
import { api, resolveAssetUrl } from '../api.js';

export default function CoverView({ project, mutate }) {
  const cover = project.cover || {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  function set(key, value) {
    mutate((_, p) => { p.cover = { ...(p.cover || {}), [key]: value }; });
  }
  function setProject(key, value) {
    mutate((_, p) => { p[key] = value; });
  }

  // 电影海报：独立生成目的，grounded prompt 由片名/故事线/调性/人物场景组装，回填 project.posterImage。
  async function generatePoster() {
    setBusy(true); setError('');
    try {
      const r = await api.projects.generate(project.id, { purpose: 'poster', size: '1024*1536' });
      if (r.status === 'succeeded' && r.boundRef?.url) {
        setPreview(r.boundRef.url);
        set('posterUrl', r.boundRef.url);
      } else if (r.assets?.[0]?.url) {
        setPreview(r.assets[0].url);
      }
    } catch (e) { setError(e.message || '海报生成失败'); }
    finally { setBusy(false); }
  }

  const posterSrc = preview || cover.posterUrl || project.posterImage?.url || '';

  return (
    <div className="simple-view cover-view">
      <div className="view-head">
        <div><h2>封面 / Title Page</h2><p className="muted">封面信息只写 project.cover，不进入剧本语义节点，也不会被导出成台词。海报回填到 project.posterImage。</p></div>
      </div>
      <div className="cover-sheet">
        <label>标题<input value={cover.title || ''} onChange={e => set('title', e.target.value)} placeholder={project.name} /></label>
        <label>副标题<input value={cover.subtitle || ''} onChange={e => set('subtitle', e.target.value)} /></label>
        <label>作者<input value={cover.author || ''} onChange={e => set('author', e.target.value)} /></label>
        <label>Logline<textarea rows={2} value={project.logline || cover.logline || ''} onChange={e => { set('logline', e.target.value); setProject('logline', e.target.value); }} /></label>
        <label>版权 / 联系信息<textarea rows={2} value={cover.contact || ''} onChange={e => set('contact', e.target.value)} /></label>
        <label>项目简介<textarea rows={5} value={project.synopsis || ''} onChange={e => setProject('synopsis', e.target.value)} /></label>
        <div className="cover-meta"><FileText size={14} /> {project.episodes?.length || 0} 集 · {project.type === 'cinema' ? 'Cinema' : 'Script'} · r{project.revision || 1}</div>
      </div>
      <div className="cover-poster">
        <h3><ImageIcon size={15} /> 电影海报</h3>
        <p className="muted small">根据上面的标题、Logline、世界观与角色 / 地点自动组装海报 Prompt；生成后回填到项目海报槽。</p>
        {posterSrc
          ? <div className="cover-poster-preview"><img src={resolveAssetUrl(posterSrc)} alt="电影海报" /></div>
          : <div className="empty small"><ImageIcon size={22} /><p>还没有海报。</p></div>}
        {error && <div className="alert error sm">{error}</div>}
        <button className="btn btn-primary sm" disabled={busy} onClick={generatePoster}>
          {busy ? <><Loader2 className="spin" size={13} /> 生成中…</> : <><Wand2 size={13} /> 生成电影海报</>}
        </button>
      </div>
    </div>
  );
}
