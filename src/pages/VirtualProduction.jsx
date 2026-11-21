import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Boxes, Sparkles, Check, AlertTriangle, Loader2, Play, Pause,
  Wand2, Braces, Eye, Layers, BookOpen, GitBranch, Download,
  Plus, Trash2, Lock, Unlock, RotateCcw, ChevronRight, Info,
} from 'lucide-react';
import { api, resolveAssetUrl } from '../api.js';
import VirtualCanvas from '../components/virtual/VirtualCanvas.jsx';
import DslInput from '../components/virtual/DslInput.jsx';
import DirectorConsole from '../components/virtual/DirectorConsole.jsx';
import KnowledgePanel from '../components/virtual/KnowledgePanel.jsx';
import WorkflowPanel from '../components/virtual/WorkflowPanel.jsx';
import ExportDialog from '../components/virtual/ExportDialog.jsx';
import AssetPanel from '../components/virtual/AssetPanel.jsx';

const TABS = [
  { id: 'input', label: '创意与 DSL', icon: Braces },
  { id: 'console', label: '导演台', icon: Eye },
  { id: 'assets', label: '资产', icon: Layers },
  { id: 'knowledge', label: '知识状态', icon: BookOpen },
  { id: 'workflow', label: '工作流', icon: GitBranch },
  { id: 'export', label: '导出', icon: Download },
];

export default function VirtualProduction() {
  const { id } = useParams();
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [tab, setTab] = useState(id ? 'console' : 'input');
  const [dsl, setDsl] = useState(null);
  const [dslText, setDslText] = useState('');
  const [compiled, setCompiled] = useState(null);
  const [selectedShot, setSelectedShot] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [diagnostics, setDiagnostics] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [newName, setNewName] = useState('');
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [seed, setSeed] = useState('30 秒科普：细胞核和线粒体的对话，讲清楚细胞核控制与线粒体供能，我是不白吃风格');
  const playRef = useRef(null);

  const loadList = useCallback(() => {
    api.projects.list().then(all => setProjects(all.filter(p => p.type === 'virtual'))).catch(e => setError(e.message));
  }, []);

  const loadProject = useCallback(async () => {
    if (!id) { setProject(null); return; }
    try {
      const p = await api.projects.get(id);
      setProject(p);
      const d = p.virtual?.dsl || null;
      setDsl(d);
      setDslText(d ? JSON.stringify(d, null, 2) : '');
      setCompiled(p.virtual?.compiled?.scenePlan ? {
        sceneGraph: p.virtual.compiled.scenePlan,
        timeline: p.virtual.compiled.timeline,
        knowledgeState: p.virtual.knowledgeState,
        hash: p.virtual.compiled.hash,
        diagnostics: p.virtual.compiled.diagnostics || [],
        ok: !(p.virtual.compiled.diagnostics || []).some(d => d.severity === 'error'),
      } : null);
      setDiagnostics(p.virtual?.compiled?.diagnostics || []);
      setSelectedShot(null);
      setPlayhead(0);
    } catch (e) { setError(e.message); }
  }, [id]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadProject(); }, [loadProject]);
  useEffect(() => { api.virtual.catalog().then(setCatalog).catch(() => {}); }, []);

  // 播放头：按 timeline 总时长循环推进
  useEffect(() => {
    if (!playing || !compiled?.timeline) { if (playRef.current) cancelAnimationFrame(playRef.current); return; }
    const total = compiled.timeline.totalSec || 30;
    let last = performance.now();
    let raf;
    const step = now => {
      const dt = (now - last) / 1000; last = now;
      setPlayhead(t => {
        const n = t + dt;
        if (n >= total) return 0;
        const shot = compiled.timeline.shots.find(s => n >= s.startSec && n < s.endSec);
        if (shot) setSelectedShot(s => s?.id === shot.id ? s : shot);
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    playRef.current = raf;
    return () => cancelAnimationFrame(raf);
  }, [playing, compiled]);

  async function createProject(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy('create');
    try {
      const p = await api.projects.create('virtual', newName.trim());
      setNewName('');
      window.location.href = `/virtual/${p.id}`;
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  async function loadDemo() {
    setLoadingDemo(true); setError('');
    try {
      const p = await api.virtual.loadDemo(false);
      window.location.href = `/virtual/${p.id}`;
    } catch (err) { setError(err.message); } finally { setLoadingDemo(false); }
  }

  async function handleGenerate() {
    if (!id || !seed.trim()) return;
    setBusy('generate'); setError(''); setNotice('');
    try {
      const r = await api.virtual.genDsl(id, { seed });
      setDsl(r.dsl);
      setDslText(JSON.stringify(r.dsl, null, 2));
      setDiagnostics(r.diagnostics || []);
      setNotice(r.source === 'ai' ? 'AI 已生成 DSL 草稿，请复核后保存。' : '已用内置模板生成 DSL 草稿（可编辑）。');
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function handleSave() {
    if (!id || !dslText.trim()) return;
    setBusy('save'); setError('');
    try {
      let parsed;
      try { parsed = JSON.parse(dslText); } catch { throw new Error('DSL 文本不是合法 JSON'); }
      const r = await api.virtual.saveDsl(id, parsed, project?.revision);
      setDsl(r.dsl);
      setNotice('DSL 已保存并创建版本。');
      await loadProject();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  }

  async function handleValidate() {
    if (!id || !dslText.trim()) return;
    setBusy('validate'); setError('');
    try {
      let parsed;
      try { parsed = JSON.parse(dslText); } catch { throw new Error('DSL 文本不是合法 JSON'); }
      const r = await api.virtual.validate(id, parsed);
      setDiagnostics(r.diagnostics || []);
      setNotice(r.ok ? '校验通过：无错误。' : `校验发现 ${r.diagnostics.filter(d => d.severity === 'error').length} 个错误。`);
    } catch (e) { setError(e.message); setDiagnostics([{ severity: 'error', code: 'JSON', message: e.message }]); }
    finally { setBusy(''); }
  }

  async function handleCompile() {
    if (!id) return;
    setBusy('compile'); setError('');
    try {
      const r = await api.virtual.compile(id, { persist: true });
      setCompiled(r);
      setDiagnostics(r.diagnostics || []);
      setNotice(`编译成功：${r.sceneGraph.nodes.length} 个场景节点，${r.timeline.shots.length} 个镜头，总时长 ${r.timeline.totalSec}s。`);
      await loadProject();
    } catch (e) {
      setError(e.message);
      try { const j = JSON.parse(e.message); setDiagnostics(j.diagnostics || []); } catch {}
    } finally { setBusy(''); }
  }

  const applyPatch = useCallback(async (patches) => {
    if (!id || !patches?.length) return;
    try {
      const r = await api.virtual.patch(id, patches);
      setDsl(r.dsl);
      setDslText(JSON.stringify(r.dsl, null, 2));
      setNotice(`已局部更新 ${patches.length} 处字段。`);
      // 编译结果需刷新以保持预览同源
      const c = await api.virtual.compile(id, { persist: true });
      if (c.ok) setCompiled(c);
    } catch (e) {
      setError(e.message);
      if (/IP 锁/.test(e.message)) setNotice('该字段被 IP 锁定，无法修改。');
    }
  }, [id]);

  const refresh = useCallback(async () => { await loadProject(); }, [loadProject]);
  const errorCount = diagnostics.filter(d => d.severity === 'error').length;

  // ---- 无 id：项目列表 ----
  if (!id) {
    return (
      <div className="vp-page">
        <div className="vp-head">
          <div><h1><Boxes size={22} /> 虚拟制片导演台</h1>
            <p className="muted">代码化的科普叙事制片管线：创意 → DSL → 3D 预演 → 成片。MVP：30 秒「细胞器对话」。</p></div>
        </div>
        <div className="vp-grid">
          <form className="card vp-new" onSubmit={createProject}>
            <h3>新建虚拟制片项目</h3>
            <label className="vp-field"><span>项目名称</span>
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="例如：细胞器对话" /></label>
            <button className="btn btn-primary" type="submit" disabled={busy === 'create'}>
              {busy === 'create' ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} 创建项目
            </button>
            <button className="btn btn-ghost full" type="button" onClick={loadDemo} disabled={loadingDemo} style={{ marginTop: 8 }}>
              {loadingDemo ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} 加载内置演示（30 秒细胞器对话）
            </button>
            <p className="muted small">演示案例已预编译并绑定 3D 模型，可直接预演、调整机位并导出；也可从空白项目开始创作。</p>
          </form>
          <div className="card vp-list">
            <h3>我的虚拟制片项目</h3>
            {projects.length === 0 && <p className="muted">还没有虚拟制片项目。用左侧表单创建第一个。</p>}
            {projects.map(p => (
              <Link key={p.id} to={`/virtual/${p.id}`} className="vp-project-row">
                <Boxes size={16} /><span className="vp-project-name">{p.name}</span>
                <span className="muted small">{p.virtual?.dsl ? 'DSL 就绪' : '待创作'}</span>
                <ChevronRight size={15} />
              </Link>
            ))}
          </div>
        </div>
        {error && <div className="vp-error"><AlertTriangle size={15} /> {error}</div>}
      </div>
    );
  }

  // ---- 有 id：导演台 ----
  if (!project) return <div className="vp-page"><Loader2 className="spin" /> 加载项目中…{error && <div className="vp-error">{error}</div>}</div>;

  const currentShot = selectedShot || compiled?.timeline?.shots?.[0] || null;

  return (
    <div className="vp-page">
      <div className="vp-head">
        <div>
          <h1><Boxes size={22} /> {project.name} <span className="vp-badge">VIRTUAL</span></h1>
          <p className="muted">
            {dsl ? `${dsl.meta?.durationSec || 30}s · ${dsl.shots?.length || 0} 镜 · ${dsl.characters?.length || 0} 角色` : '尚未生成 DSL'}
            {compiled?.hash && <span> · 编译 #{compiled.hash.slice(0, 8)}</span>}
          </p>
        </div>
        <div className="vp-head-actions">
          <Link className="btn btn-ghost" to="/virtual">返回列表</Link>
          {errorCount > 0 && <span className="vp-chip danger"><AlertTriangle size={13} /> {errorCount} 错误</span>}
          <button className="btn btn-primary" onClick={() => setExportOpen(true)} disabled={!compiled?.ok}>
            <Download size={15} /> 导出成片
          </button>
        </div>
      </div>

      <nav className="vp-tabs">
        {TABS.map(t => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
          <t.icon size={15} /> {t.label}
        </button>)}
      </nav>

      {(notice || error) && (
        <div className={error ? 'vp-error' : 'vp-notice'}>
          {error ? <AlertTriangle size={15} /> : <Check size={15} />} {error || notice}
          <button className="vp-dismiss" onClick={() => { setError(''); setNotice(''); }}>×</button>
        </div>
      )}

      {tab === 'input' && (
        <DslInput
          seed={seed} setSeed={setSeed} dslText={dslText} setDslText={setDslText}
          diagnostics={diagnostics} busy={busy}
          onGenerate={handleGenerate} onValidate={handleValidate} onSave={handleSave} onCompile={handleCompile}
        />
      )}

      {tab === 'console' && (
        <div className="vp-console-layout">
          <div className="vp-stage">
            <VirtualCanvas compiled={compiled} playhead={playhead} selectedShot={currentShot} />
            <div className="vp-transport">
              <button className="icon-btn" onClick={() => setPlaying(p => !p)} title={playing ? '暂停' : '播放'}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <input type="range" min="0" max={compiled?.timeline?.totalSec || 30} step="0.1"
                value={playhead} onChange={e => setPlayhead(Number(e.target.value))} />
              <span className="vp-time">{playhead.toFixed(1)}s / {(compiled?.timeline?.totalSec || 30).toFixed(0)}s</span>
            </div>
            {!compiled && <div className="vp-stage-empty"><Info size={18} /> 请先在「创意与 DSL」生成、保存并编译 DSL，场景将在此实时预演。</div>}
          </div>
          <DirectorConsole
            dsl={dsl} compiled={compiled} currentShot={currentShot}
            onPatch={applyPatch} busy={busy}
            onSelectShot={shot => { setSelectedShot(shot); setPlayhead(shot.startSec); }}
          />
        </div>
      )}

      {tab === 'assets' && <AssetPanel project={project} dsl={dsl} catalog={catalog} onRefresh={refresh} setError={setError} setNotice={setNotice} />}
      {tab === 'knowledge' && <KnowledgePanel project={project} dsl={dsl} compiled={compiled} onRefresh={refresh} setError={setError} setNotice={setNotice} />}
      {tab === 'workflow' && <WorkflowPanel project={project} onRefresh={refresh} setError={setError} setNotice={setNotice} />}
      {tab === 'export' && (
        <div className="card vp-export-intro">
          <h3>导出成片</h3>
          <p className="muted">浏览器同源导出：把导演台的 3D 预演录制成 WebM，混入 AI 配音并把字幕烧录进画面。输出前请确认 DSL 已编译成功。</p>
          {compiled?.ok ? <button className="btn btn-primary" onClick={() => setExportOpen(true)}><Download size={15} /> 开始导出</button>
            : <p className="vp-stage-empty"><AlertTriangle size={15} /> DSL 尚未编译成功，无法导出。</p>}
        </div>
      )}

      {exportOpen && (
        <ExportDialog
          project={project} compiled={compiled} dsl={dsl}
          playhead={playhead} setPlayhead={setPlayhead}
          onClose={() => setExportOpen(false)} onNotice={setNotice} setError={setError}
        />
      )}
    </div>
  );
}
