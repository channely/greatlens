import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Plus, FileText, Film, Trash2, CalendarDays, ArrowRight,
  Upload, X, Loader2, Check, BookOpen, FileUp, Sparkles,
} from 'lucide-react';
import { api } from '../api.js';
import IdeaProjectDialog from '../components/IdeaProjectDialog.jsx';

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('script');
  const [template, setTemplate] = useState('blank');
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ideaOpen, setIdeaOpen] = useState(false);
  const [ideaSeed, setIdeaSeed] = useState('');
  const [reviewProject, setReviewProject] = useState(null);
  const nav = useNavigate();
  const location = useLocation();

  // FDX 导入（对齐 laper：仅 FDX，不做 Fountain 导入）
  const fileRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [fileText, setFileText] = useState('');
  const [fileName, setFileName] = useState('');
  const [importMode, setImportMode] = useState('new');
  const [importName, setImportName] = useState('');
  const [mergeProjectId, setMergeProjectId] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');

  // 创意资料附件导入（DOCX / PDF / MD / TXT）
  const attachRef = useRef(null);
  const [attach, setAttach] = useState(null); // { name, text, kind, warning }
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachTarget, setAttachTarget] = useState('knowledge'); // knowledge | new
  const [attachProject, setAttachProject] = useState('');
  const [attachName, setAttachName] = useState('');
  const [attachError, setAttachError] = useState('');

  const load = () => api.projects.list().then(setProjects).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { api.projectTemplates().then(setTemplates).catch(() => {}); }, []);

  // 首页「开始创作」带入的描述：自动打开 idea 向导并消费一次性 seed。
  useEffect(() => {
    if (new URLSearchParams(location.search).get('fromIdea') !== '1') return;
    let seed = '';
    try { seed = sessionStorage.getItem('gl:ideaSeed') || ''; sessionStorage.removeItem('gl:ideaSeed'); } catch { /* 忽略 */ }
    setIdeaSeed(seed);
    setIdeaOpen(true);
    nav('/projects', { replace: true }); // 去掉 query，刷新不会重复弹出
    /* eslint-disable-next-line */
  }, [location.search]);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const p = await api.projects.create(type, name.trim(), template);
      setName(''); setCreating(false);
      nav(type === 'cinema' ? `/cinema/${p.id}` : `/edit/${p.id}`);
    } catch (err) { setError(err.message); }
  }

  function ideaCreated(project) {
    setIdeaOpen(false);
    setReviewProject(project);
    setNotice(`已创建「${project.name}」并保存 AI 创意初始版本。请逐项复核后开始写作。`);
    load();
  }

  function openReviewTab(tab) {
    const p = reviewProject;
    setReviewProject(null);
    if (!p) return;
    nav(`/edit/${p.id}?tab=${encodeURIComponent(tab)}`);
  }

  async function remove(id) {
    if (!confirm('删除这个项目？本地数据不可恢复。')) return;
    await api.projects.remove(id);
    load();
  }

  async function pickFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许再次选择同一个文件
    if (!file) return;
    setError(''); setNotice(''); setImportError('');
    try {
      const text = await file.text();
      setFileText(text);
      setFileName(file.name);
      setImportName(file.name.replace(/\.fdx$/i, ''));
      setImportMode(projects.length ? 'merge' : 'new');
      setMergeProjectId(projects[0]?.id || '');
      setImporting(true);
    } catch (err) { setError(`读取文件失败：${err.message}`); }
  }

  async function doImport() {
    if (!fileText) return;
    if (importMode === 'merge' && !mergeProjectId) { setImportError('请选择要合并到的项目。'); return; }
    if (importMode === 'new' && !importName.trim()) { setImportError('请填写新项目名称。'); return; }
    setImportBusy(true); setImportError('');
    try {
      const payload = { xml: fileText, mode: importMode };
      if (importMode === 'merge') payload.projectId = mergeProjectId;
      else payload.projectName = importName.trim();
      const r = await api.import.fdx(payload);
      setImporting(false); setFileText('');
      const s = r.stats || {};
      setNotice(`导入成功：${s.scenes ?? '—'} 个场景、${s.paragraphs ?? '—'} 个段落、${s.characters ?? '—'} 个角色。`);
      load();
      if (importMode === 'new' && r.project?.id) {
        nav(r.project.type === 'cinema' ? `/cinema/${r.project.id}` : `/edit/${r.project.id}`);
      }
    } catch (err) { setImportError(err.message); }
    finally { setImportBusy(false); }
  }

  async function pickAttachment(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setNotice(''); setAttachError(''); setAttachBusy(true);
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      const r = await api.import.attachment({ name: file.name, mime: file.type, dataBase64 });
      setAttach({ ...r, name: r.name || file.name });
      setAttachName(file.name.replace(/\.[^.]+$/, ''));
      setAttachProject(projects[0]?.id || '');
      setAttachTarget(projects.length ? 'knowledge' : 'new');
    } catch (err) { setAttachError(err.message); }
    finally { setAttachBusy(false); }
  }

  async function confirmAttachment() {
    setAttachBusy(true); setAttachError('');
    try {
      if (attachTarget === 'knowledge') {
        if (!attachProject) { setAttachError('请选择要加入知识库的项目。'); return; }
        const p = await api.projects.get(attachProject);
        p.knowledge = p.knowledge || [];
        p.knowledge.push({
          id: `k_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: attachName.trim() || attach.name,
          type: 'reference',
          summary: (attach.text || '').slice(0, 120).replace(/\s+/g, ' ').trim(),
          tags: [attach.kind || '附件'],
          body: attach.text || '',
        });
        await api.projects.save(p.id, p);
        setNotice(`已将「${attach.name}」加入项目知识库。`);
        setAttach(null);
      } else {
        const p = await api.projects.create('script', attachName.trim() || attach.name);
        p.knowledge = [{ id: `k_${Date.now()}`, name: attach.name, type: 'reference', summary: (attach.text || '').slice(0, 120).replace(/\s+/g, ' ').trim(), tags: ['附件'], body: attach.text || '' }];
        await api.projects.save(p.id, p);
        setAttach(null);
        load();
        nav(`/edit/${p.id}`);
      }
    } catch (err) { setAttachError(err.message); }
    finally { setAttachBusy(false); }
  }

  return (
    <main className="container page">
      <div className="page-head">
        <div>
          <h1>项目</h1>
          <p className="muted">数据保存在本机。新建项目，或从 FDX 导入。 <code>data/db.json</code>。</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={() => attachRef.current?.click()}><BookOpen size={16} /> 导入资料</button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={16} /> 导入 FDX</button>
          <button className="btn btn-ghost" onClick={() => setIdeaOpen(true)}><Sparkles size={16} /> 从创意开始</button>
          <button className="btn btn-primary" onClick={() => setCreating(v => !v)}><Plus size={16} /> 新建项目</button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".fdx" style={{ display: 'none' }} onChange={pickFile} />
      <input ref={attachRef} type="file" accept=".docx,.pdf,.md,.markdown,.txt" style={{ display: 'none' }} onChange={pickAttachment} />
      {attachBusy && !attach && <div className="alert success sm"><Loader2 className="spin" size={13} /> 正在解析资料…</div>}

      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      {creating && (
        <form className="card create-form" onSubmit={create}>
          <h3>新项目</h3>
          <div className="type-picker">
            <button type="button" className={`type-option ${type === 'script' ? 'selected' : ''}`} onClick={() => setType('script')}>
              <FileText size={22} /><strong>Script</strong><span>剧本 / 短剧 / 分集大纲</span>
            </button>
            <button type="button" className={`type-option ${type === 'cinema' ? 'selected' : ''}`} onClick={() => setType('cinema')}>
              <Film size={22} /><strong>Cinema</strong><span>短片 / 分镜 / 最长 30 秒成片</span>
            </button>
          </div>
          {type === 'script' && (
            <div className="template-picker">
              <span className="muted small">起始模板</span>
              <div className="template-options">
                {(templates.length ? templates : [
                  { id: 'blank', name: '空白剧本', desc: '从第一场开始写。' },
                  { id: 'three-act', name: '三幕结构', desc: '建置 / 对抗 / 结局。' },
                  { id: 'character-first', name: '角色优先', desc: '先建角色，再写节拍。' },
                ]).map(t => (
                  <button type="button" key={t.id} className={`template-option ${template === t.id ? 'selected' : ''}`} onClick={() => setTemplate(t.id)}>
                    <strong>{t.name}</strong><span>{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="form-row">
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="给它起个名字，比如「雨夜来客」" />
            <button className="btn btn-primary" type="submit">创建 <ArrowRight size={15} /></button>
          </div>
        </form>
      )}

      {projects.length === 0 && !creating ? (
        <div className="empty">
          <div className="empty-icon"><FileText size={28} /></div>
          <h3>还没有项目</h3>
          <p>点右上角「新建项目」，选 Script 写剧本，或选 Cinema 做短片。也可以直接导入 FDX 剧本。</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map(p => (
            <div className="project-card" key={p.id}>
              <div className="project-card-top">
                <span className={`badge ${p.type}`}>{p.type === 'script' ? 'SCRIPT' : 'CINEMA'}</span>
                <button className="icon-btn danger" title="删除" onClick={() => remove(p.id)}><Trash2 size={15} /></button>
              </div>
              <h3>{p.name}</h3>
              <div className="project-meta"><CalendarDays size={13} /> {new Date(p.updatedAt).toLocaleDateString('zh-CN')} · {p.episodeCount} 集</div>
              <button className="btn btn-ghost full" onClick={() => nav(p.type === 'cinema' ? `/cinema/${p.id}` : `/edit/${p.id}`)}>
                打开工作台 <ArrowRight size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {importing && (
        <div className="dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setImporting(false); }}>
          <div className="dialog">
            <div className="dialog-head">
              <div><h3>导入剧本</h3><p className="muted small">文件：{fileName}</p></div>
              <button className="icon-btn" onClick={() => setImporting(false)}><X size={18} /></button>
            </div>
            <div className="dialog-body form-stack">
              <label className="radio-row">
                <input type="radio" name="import-mode" checked={importMode === 'new'} onChange={() => setImportMode('new')} />
                <span>新建项目</span>
              </label>
              {importMode === 'new' && (
                <input value={importName} onChange={e => setImportName(e.target.value)} placeholder="新项目名称" />
              )}
              <label className="radio-row">
                <input type="radio" name="import-mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} disabled={projects.length === 0} />
                <span>合并到已有项目{projects.length === 0 ? '（暂无项目）' : ''}</span>
              </label>
              {importMode === 'merge' && (
                <select value={mergeProjectId} onChange={e => setMergeProjectId(e.target.value)}>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {importError && <div className="alert error sm">{importError}</div>}
            </div>
            <div className="dialog-foot">
              <button className="btn btn-ghost" onClick={() => setImporting(false)}>取消</button>
              <button className="btn btn-primary" onClick={doImport} disabled={importBusy}>
                {importBusy ? <><Loader2 className="spin" size={15} /> 导入中…</> : <><Check size={15} /> 开始导入</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {attach && (
        <div className="dialog-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setAttach(null); }}>
          <div className="dialog attach-dialog">
            <div className="dialog-head">
              <div><h3>资料已解析</h3><p className="muted small">文件：{attach.name} · {attach.kind?.toUpperCase()} · {attach.text?.length || 0} 字</p></div>
              <button className="icon-btn" onClick={() => setAttach(null)}><X size={18} /></button>
            </div>
            <div className="dialog-body form-stack">
              {attach.warning && <div className="alert warning sm">{attach.warning}</div>}
              <label>资料名称<input value={attachName} onChange={e => setAttachName(e.target.value)} placeholder="给这份资料起个名字" /></label>
              <label className="radio-row">
                <input type="radio" name="attach-mode" checked={attachTarget === 'knowledge'} onChange={() => setAttachTarget('knowledge')} disabled={projects.length === 0} />
                <span>加入项目知识库（AI 可按需检索）{projects.length === 0 ? '（暂无项目）' : ''}</span>
              </label>
              {attachTarget === 'knowledge' && (
                <select value={attachProject} onChange={e => setAttachProject(e.target.value)}>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <label className="radio-row">
                <input type="radio" name="attach-mode" checked={attachTarget === 'new'} onChange={() => setAttachTarget('new')} />
                <span>据此新建项目（资料存入新知识库）</span>
              </label>
              <details className="attach-preview"><summary>查看解析出的文本</summary><pre>{(attach.text || '').slice(0, 3000) || '（未提取到文本）'}</pre></details>
              {attachError && <div className="alert error sm">{attachError}</div>}
            </div>
            <div className="dialog-foot">
              <button className="btn btn-ghost" onClick={() => setAttach(null)}>取消</button>
              <button className="btn btn-primary" onClick={confirmAttachment} disabled={attachBusy}><FileUp size={15} /> 确认导入</button>
            </div>
          </div>
        </div>
      )}

      {ideaOpen && <IdeaProjectDialog seedText={ideaSeed} onClose={() => { setIdeaOpen(false); setIdeaSeed(''); }} onCreated={ideaCreated} />}
      {reviewProject && (
        <div className="dialog-overlay">
          <div className="dialog">
            <div className="dialog-head"><div><h3>创建后复核</h3><p className="muted small">「{reviewProject.name}」已建立。按顺序检查生成结果，可随时回到项目修改。</p></div><button className="icon-btn" onClick={() => setReviewProject(null)}><X size={18} /></button></div>
            <div className="dialog-body form-stack">
              {[['outline', '大纲'], ['beats', '节拍'], ['script', '开场剧本'], ['characters', '角色档案'], ['locations', '地点']].map(([key, label]) => (
                <button className="btn btn-ghost full" key={key} onClick={() => openReviewTab(key)}>{label} <ArrowRight size={14} /></button>
              ))}
            </div>
            <div className="dialog-foot"><button className="btn btn-primary" onClick={() => setReviewProject(null)}>稍后复核</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
