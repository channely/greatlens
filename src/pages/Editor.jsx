import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Save, Download, Plus, Trash2, Sparkles, Send,
  FileText, ListTree, Users, MapPin, BookOpen, Clapperboard,
  Loader2, Check, Wand2, ArrowUp, ArrowDown, Copy, Network,
  ClipboardList, Package, X, SlidersHorizontal, CheckSquare,
} from 'lucide-react';
import { api } from '../api.js';
import { CastingView, RelationshipsView, LocationsPropsView, KnowledgeView } from './Entities.jsx';

const FULL_DRAFT_NODE_LIMIT = 800;

const NODE_TYPES = [
  { value: 'scene', label: '场景标题', hint: 'INT. 地点 - 时间', cls: 'nt-scene' },
  { value: 'action', label: '动作', hint: '可拍摄的可见行为', cls: 'nt-action' },
  { value: 'character', label: '角色', hint: '说话的人', cls: 'nt-character' },
  { value: 'dialogue', label: '对白', hint: '角色说的话', cls: 'nt-dialogue' },
  { value: 'parenthetical', label: '括号提示', hint: '表演提示', cls: 'nt-paren' },
  { value: 'transition', label: '转场', hint: 'CUT TO:', cls: 'nt-transition' },
  { value: 'subtitle', label: '字幕', hint: '画面文字', cls: 'nt-subtitle' },
  { value: 'comment', label: '批注', hint: '不进导出', cls: 'nt-comment' },
];

const TABS = [
  { id: 'script', label: '剧本', icon: FileText },
  { id: 'outline', label: '大纲', icon: ListTree },
  { id: 'scenes', label: '场景', icon: MapPin },
  { id: 'characters', label: '角色档案', icon: Users },
  { id: 'production', label: '生产', icon: ClipboardList },
  { id: 'world', label: '世界观', icon: BookOpen },
  { id: 'shots', label: '分镜', icon: Clapperboard },
];

const PROD_TABS = [
  { id: 'casting', label: '选角表', icon: Users },
  { id: 'relations', label: '关系图谱', icon: Network },
  { id: 'locations', label: '地点 / 道具', icon: Package },
  { id: 'knowledge', label: '知识库', icon: BookOpen },
];

const SCOPES = [
  { value: 'cursor', label: '光标处' },
  { value: 'node', label: '选中节点' },
  { value: 'range', label: '选中区间' },
  { value: 'scene', label: '当前场景' },
  { value: 'outline', label: '大纲' },
  { value: 'full', label: `全稿（≤${FULL_DRAFT_NODE_LIMIT} 节点）` },
];

const AI_MODES = [
  { value: 'chat', label: '对话' },
  { value: 'diagnose', label: '诊断' },
  { value: 'rewrite', label: '改写' },
  { value: 'continue', label: '续写' },
  { value: 'storyboard', label: '分镜' },
];

const AUTH_LAYERS = [
  { id: 'script', label: '剧本' },
  { id: 'outline', label: '大纲' },
  { id: 'entities', label: '实体' },
  { id: 'worldview', label: '世界观' },
];

const nodeLine = n => `${n.type}: ${n.text}`;

function parseAIText(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  return lines.map(line => {
    let type = 'action';
    const upper = line.toUpperCase();
    if (/^(INT\.|EXT\.|EST\.|INT\/EXT|场次)/.test(upper) || /^INT[／\/]?EXT/i.test(line)) type = 'scene';
    else if (/^(CUT TO|FADE IN|FADE OUT|SMASH CUT|DISSOLVE)/.test(upper)) type = 'transition';
    else if (line.length < 28 && /^[A-Z\u4e00-\u9fa5\s（）()·-]+$/.test(line) && !/[。！？，]/.test(line)) type = 'character';
    else if (/^（.*）$/.test(line) || /^\(.*\)$/.test(line)) type = 'parenthetical';
    return { id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type, text: line.replace(/^[^:]+:\s*/, '') };
  });
}

export default function Editor() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [epIdx, setEpIdx] = useState(0);
  const [tab, setTab] = useState('script');
  const [prodTab, setProdTab] = useState('casting');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [scope, setScope] = useState('scene');
  const [aiMode, setAiMode] = useState('chat');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [sel, setSel] = useState({ start: -1, end: -1 });
  const [contextMenu, setContextMenu] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [advisors, setAdvisors] = useState([]);
  const [intention, setIntention] = useState('');
  const [constraints, setConstraints] = useState('');
  const [authLayers, setAuthLayers] = useState(['script']);
  const [showStructured, setShowStructured] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [derived, setDerived] = useState(null);
  const saveTimer = useRef(null);
  const chatEnd = useRef(null);
  const abortRef = useRef(null);
  const dirtyRef = useRef(false);
  const projectRef = useRef(null);
  const epIdxRef = useRef(epIdx);
  epIdxRef.current = epIdx;

  useEffect(() => {
    let alive = true;
    abortRef.current?.abort();
    setProject(null);
    api.projects.get(id).then(p => { if (alive) { projectRef.current = p; setProject(p); } })
      .catch(e => { if (alive) setError(e.message); });
    api.ai.advisors().then(a => { if (alive) setAdvisors(a); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    abortRef.current?.abort();
  }, []);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (!project) return;
    api.projects.entities(project.id).then(setDerived).catch(() => {});
  }, [project?.id, project?.updatedAt]);

  // 关闭右键菜单：点击任意处
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [contextMenu]);

  const ep = project?.episodes?.[epIdx];
  const nodes = ep?.nodes || [];
  const selLo = Math.min(sel.start, sel.end);
  const selHi = Math.max(sel.start, sel.end);
  const hasSel = sel.start >= 0 && sel.start < nodes.length;

  function mutate(fn) {
    setProject(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next.episodes[epIdxRef.current], next);
      next.updatedAt = new Date().toISOString();
      projectRef.current = next;
      return next;
    });
    setSaved(false);
    dirtyRef.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const cur = projectRef.current;
      if (!cur || !dirtyRef.current) return;
      dirtyRef.current = false;
      api.projects.save(cur.id, cur).then(() => setSaved(true)).catch(e => setError(e.message));
    }, 700);
  }

  function addNode(type = 'action', afterIndex = null) {
    mutate(e => {
      const node = { id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type, text: '' };
      if (afterIndex === null) e.nodes.push(node);
      else e.nodes.splice(afterIndex + 1, 0, node);
    });
  }
  function updateNode(idx, patch) { mutate(e => { Object.assign(e.nodes[idx], patch); }); }
  function removeNode(idx) {
    mutate(e => { e.nodes.splice(idx, 1); });
    setSel({ start: -1, end: -1 });
  }
  function moveNode(idx, dir) {
    mutate(e => {
      const j = idx + dir;
      if (j < 0 || j >= e.nodes.length) return;
      [e.nodes[idx], e.nodes[j]] = [e.nodes[j], e.nodes[idx]];
    });
  }
  function dropNode(targetIdx) {
    if (dragIdx === null || dragIdx === targetIdx) return;
    mutate(e => { const [m] = e.nodes.splice(dragIdx, 1); e.nodes.splice(targetIdx, 0, m); });
    setDragIdx(null);
  }
  function selectNode(idx, shift) {
    setSel(prev => shift && prev.start >= 0 ? { start: prev.start, end: idx } : { start: idx, end: idx });
  }
  function hireAdvisor(advisorId) {
    const next = advisorId || '';
    api.projects.setAdvisor(id, next)
      .then(() => { mutate((_, p) => { p.advisorId = next; }); })
      .catch(e => setError(e.message));
  }

  const derivedSC = useMemo(() => {
    const scenes = [], characters = [];
    nodes.forEach(n => {
      if (n.type === 'scene' && n.text.trim()) scenes.push(n.text.trim());
      if (n.type === 'character' && n.text.trim() && !characters.includes(n.text.trim())) characters.push(n.text.trim());
    });
    return { scenes, characters };
  }, [nodes]);

  function contextForAI() {
    if (scope === 'node' && hasSel) return nodeLine(nodes[selLo]);
    if (scope === 'range' && hasSel) return nodes.slice(selLo, selHi + 1).map(nodeLine).join('\n');
    if (scope === 'full') return nodes.slice(0, FULL_DRAFT_NODE_LIMIT).map(nodeLine).join('\n');
    if (scope === 'outline') return (ep?.outline || []).map(o => o.text).join('\n');
    if (scope === 'scene') {
      // 以选中节点为中心，取所在场景片段（前后到最近场景标题）
      let s = hasSel ? selLo : nodes.length - 1, a = s, b = s;
      while (a > 0 && nodes[a - 1]?.type !== 'scene') a--;
      while (b < nodes.length - 1 && nodes[b + 1]?.type !== 'scene') b++;
      return nodes.slice(a, b + 1).map(nodeLine).join('\n').slice(-6000);
    }
    return nodes.slice(-5).map(nodeLine).join('\n');
  }

  function targetLabel() {
    if (scope === 'node' && hasSel) return `第${epIdx + 1}集 / 节点 ${selLo + 1}：${nodes[selLo]?.text?.slice(0, 40) || '(空)'}`;
    if (scope === 'range' && hasSel) return `第${epIdx + 1}集 / 节点 ${selLo + 1}–${selHi + 1}`;
    if (scope === 'scene') return `第${epIdx + 1}集 / 当前场景`;
    if (scope === 'outline') return `第${epIdx + 1}集 / 大纲`;
    if (scope === 'cursor') return `第${epIdx + 1}集 / 光标附近`;
    return `全稿（≤${FULL_DRAFT_NODE_LIMIT} 节点）`;
  }

  async function send() {
    if (!prompt.trim() || streaming) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const userText = prompt.trim();
    setPrompt('');
    setMessages(m => [...m, { role: 'user', text: userText }]);
    setStreaming(true);
    let acc = '', reasoning = '';
    setMessages(m => [...m, { role: 'assistant', text: '', reasoning: '' }]);
    const patchLast = (patch) => setMessages(m => {
      if (!m.length) return m;
      const copy = [...m];
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
      return copy;
    });
    try {
      await api.ai.stream({
        prompt: userText, scope, mode: aiMode, context: contextForAI(),
        target: targetLabel(),
        intention: intention.trim(),
        constraints: constraints.trim(),
        authority: authLayers.join('、') || '仅诊断',
        advisorId: project?.advisorId || '',
        // 项目级上下文：知识库只给索引（正文按需），世界观规则、剧集清单、实体清单。
        // 与 laper.ai「index → search → read」一致，不把整库塞进每次对话。
        project: {
          episodes: (project.episodes || []).map((e, i) => ({ index: i + 1, title: e.title })),
          worldview: project.worldview || {},
          knowledgeIndex: (project.knowledge || []).map(k => ({ id: k.id, name: k.name, type: k.type, summary: k.summary })),
          characters: (project.characters || []).map(c => c.name).filter(Boolean),
          locations: (project.locations || []).map(l => l.name).filter(Boolean),
          props: (project.props || []).map(p => p.name).filter(Boolean),
        },
      }, {
        signal: controller.signal,
        onDelta: (delta) => { acc += delta; patchLast({ text: acc }); },
        onReasoning: (chunk) => { reasoning += chunk; patchLast({ reasoning }); },
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(m => [...m, { role: 'error', text: err.message }]);
        setError(err.message);
      }
    } finally { if (abortRef.current === controller) setStreaming(false); }
  }

  // 定点替换：改写模式下若选中了节点/区间，替换该段；否则追加到末尾。
  function applyAIText(text, replace) {
    const parsed = parseAIText(text);
    if (!parsed.length) return;
    if (replace && hasSel && (scope === 'node' || scope === 'range')) {
      mutate(e => { e.nodes.splice(selLo, selHi - selLo + 1, ...parsed); });
      setSel({ start: selLo, end: selLo + parsed.length - 1 });
    } else {
      mutate(e => { parsed.forEach(n => e.nodes.push(n)); });
    }
    setTab('script');
  }

  async function doExport(format, opts = {}) {
    try {
      const res = await fetch(`/api/export/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, ...opts }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `导出失败 ${res.status}`); }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      let name = `${project.name}.${format}`;
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      if (m) { try { name = decodeURIComponent(m[1]); } catch { /* keep default */ } }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (e) { setError(e.message); }
  }

  if (error && !project) return <main className="container page"><div className="alert error">{error}</div><Link to="/projects">返回项目</Link></main>;
  if (!project) return <main className="container page"><div className="loading"><Loader2 className="spin" size={20} /> 加载中…</div></main>;

  const canReplace = hasSel && (scope === 'node' || scope === 'range');
  const currentAdvisor = advisors.find(a => a.id === project.advisorId);

  return (
    <div className="workspace">
      <div className="ws-top">
        <Link to="/projects" className="back-link">← 项目</Link>
        <div className="ws-title">
          <input value={project.name} onChange={e => mutate(p => { p.name = e.target.value; })} />
          <span className={`badge ${project.type}`}>{project.type.toUpperCase()}</span>
        </div>
        <div className="ws-actions">
          <span className={`save-state ${saved ? 'ok' : ''}`}>{saved ? <><Check size={13} /> 已保存</> : '编辑中…'}</span>
          <button className="btn btn-ghost sm" onClick={() => doExport('fountain')}><Download size={14} /> Fountain</button>
          <button className="btn btn-ghost sm" onClick={() => setExportOpen(true)}><Download size={14} /> 交付导出</button>
          <button className={`btn btn-ghost sm ${aiOpen ? 'active' : ''}`} onClick={() => setAiOpen(v => !v)}><Sparkles size={14} /> AI</button>
        </div>
      </div>

      <div className="ws-body">
        <div className="ws-main">
          <div className="ws-tabs">
            {TABS.map(t => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon size={14} /> {t.label}</button>)}
            <div className="episode-select">
              {project.episodes.map((e, i) => <button key={e.id} className={i === epIdx ? 'active' : ''} onClick={() => { setEpIdx(i); setSel({ start: -1, end: -1 }); }}>{e.title}</button>)}
              <button className="ep-add" title="新增剧集" onClick={() => {
                api.projects.addEpisode(id, `第 ${project.episodes.length + 1} 集`).then(() => api.projects.get(id)).then(p => { setProject(p); setEpIdx(p.episodes.length - 1); });
              }}><Plus size={14} /></button>
            </div>
          </div>

          <div className="ws-content">
            {tab === 'script' && (
              <div className="script-view">
                <div className="script-toolbar">
                  <span>语义节点 · {nodes.length} 段{hasSel && <em className="sel-hint"> · 已选 {selLo + 1}{selHi !== selLo ? `–${selHi + 1}` : ''}（可定点改写）</em>}</span>
                  <div>
                    <button className="btn btn-ghost sm" onClick={() => addNode('scene')}><Plus size={13} /> 场景标题</button>
                    <button className="btn btn-ghost sm" onClick={() => addNode('action')}><Plus size={13} /> 动作</button>
                  </div>
                </div>
                <div className="script-paper editor-paper" onClick={() => setSel({ start: -1, end: -1 })}>
                  {nodes.length === 0 && (
                    <div className="paper-empty">
                      <p>剧本是唯一的事实来源。</p>
                      <button className="btn btn-primary" onClick={() => addNode('scene')}>写下第一个场景标题</button>
                    </div>
                  )}
                  {nodes.map((n, i) => {
                    const selected = i >= selLo && i <= selHi && hasSel;
                    return <div
                      className={`node-row ${n.type === 'comment' ? 'is-comment' : ''} ${selected ? 'is-selected' : ''} ${dragIdx === i ? 'is-dragging' : ''}`}
                      key={n.id}
                      draggable
                      onDragStart={e => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={e => { e.preventDefault(); }}
                      onDrop={e => { e.preventDefault(); e.stopPropagation(); dropNode(i); }}
                      onDragEnd={() => setDragIdx(null)}
                      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); selectNode(i, e.shiftKey); setContextMenu({ x: e.clientX, y: e.clientY, idx: i }); }}
                      onClick={e => { e.stopPropagation(); selectNode(i, e.shiftKey); }}
                    >
                      <div className="node-gutter">
                        <button title="上移" onClick={(e) => { e.stopPropagation(); moveNode(i, -1); }}><ArrowUp size={11} /></button>
                        <button title="下移" onClick={(e) => { e.stopPropagation(); moveNode(i, 1); }}><ArrowDown size={11} /></button>
                        <button title="删除" onClick={(e) => { e.stopPropagation(); removeNode(i); }}><Trash2 size={11} /></button>
                      </div>
                      <select className="node-type" value={n.type} onClick={e => e.stopPropagation()} onChange={e => updateNode(i, { type: e.target.value })}>
                        {NODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <textarea
                        className={`node-input ${n.type}`}
                        value={n.text}
                        rows={Math.max(1, Math.ceil(n.text.length / (n.type === 'dialogue' ? 34 : 60)))}
                        placeholder={NODE_TYPES.find(t => t.value === n.type)?.hint}
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateNode(i, { text: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNode(n.type === 'scene' ? 'action' : n.type, i); }
                        }}
                      />
                    </div>;
                  })}
                  <button className="add-node-row" onClick={() => addNode('action')}><Plus size={14} /> 添加节点（⌘/Ctrl + Enter 快速插入 · Shift 点击选区 · 右键更多 · 拖动排序）</button>
                </div>
              </div>
            )}

            {tab === 'outline' && <OutlineView ep={ep} mutate={mutate} onAsk={q => { setPrompt(q); setAiOpen(true); }} />}
            {tab === 'scenes' && <ScenesView scenes={derivedSC.scenes} nodes={nodes} />}
            {tab === 'characters' && <CharactersView project={project} mutate={mutate} names={derivedSC.characters} />}
            {tab === 'production' && (
              <div className="production-view">
                <div className="prod-tabs">
                  {PROD_TABS.map(t => <button key={t.id} className={prodTab === t.id ? 'active' : ''} onClick={() => setProdTab(t.id)}><t.icon size={14} /> {t.label}</button>)}
                </div>
                {prodTab === 'casting' && <CastingView project={project} mutate={mutate} derived={derived} />}
                {prodTab === 'relations' && <RelationshipsView project={project} mutate={mutate} />}
                {prodTab === 'locations' && <LocationsPropsView project={project} mutate={mutate} derived={derived} />}
                {prodTab === 'knowledge' && <KnowledgeView project={project} mutate={mutate} />}
              </div>
            )}
            {tab === 'world' && <WorldView project={project} mutate={mutate} />}
            {tab === 'shots' && <ShotsView ep={ep} mutate={mutate} />}
          </div>
        </div>

        {aiOpen && (
          <aside className="ai-panel">
            <div className="ai-head">
              <div><Sparkles size={16} /> <strong>创作助手</strong></div>
              <button className="icon-btn" onClick={() => setAiOpen(false)}>×</button>
            </div>
            <div className="ai-config">
              <label>读取范围
                <select value={scope} onChange={e => setScope(e.target.value)}>
                  {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label>模式
                <select value={aiMode} onChange={e => setAiMode(e.target.value)}>
                  {AI_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
              <label>顾问视角
                <select value={project.advisorId || ''} onChange={e => hireAdvisor(e.target.value)}>
                  <option value="">不启用</option>
                  {advisors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              {currentAdvisor && <div className="advisor-note">{currentAdvisor.method}</div>}
              <button className="structured-toggle" onClick={() => setShowStructured(v => !v)}>
                <SlidersHorizontal size={13} /> 落点 / 约束 / 权限 {showStructured ? '▴' : '▾'}
              </button>
              {showStructured && <div className="structured-fields">
                <div className="field-target"><span>目标</span><code>{targetLabel()}</code></div>
                <label>意图<input value={intention} placeholder="例：让 Nia 赢得争论但不暴露钥匙" onChange={e => setIntention(e.target.value)} /></label>
                <label>约束<textarea rows={2} value={constraints} placeholder="例：保留最后一句、不新增角色、场次标题不动" onChange={e => setConstraints(e.target.value)} /></label>
                <div className="auth-field"><span>允许写入</span><div className="auth-chips">
                  {AUTH_LAYERS.map(l => <button key={l.id} className={authLayers.includes(l.id) ? 'on' : ''} onClick={() => setAuthLayers(prev => prev.includes(l.id) ? prev.filter(x => x !== l.id) : [...prev, l.id])}>
                    {authLayers.includes(l.id) ? <CheckSquare size={12} /> : null}{l.label}
                  </button>)}
                </div></div>
                <p className="auth-hint">世界观只有在此处显式勾选、且你在消息里点名具体键值时，助手才会写入。</p>
              </div>}
            </div>
            <div className="chat-list">
              {messages.length === 0 && (
                <div className="chat-hint">
                  <Wand2 size={22} />
                  <p>先选读取范围，再提问。要定点改写就 Shift 点选节点/区间。</p>
                  <div className="suggestions">
                    {['诊断这场戏的节奏压力', '把这段改成可拍摄的动作', '给我三个反转选项'].map(s => (
                      <button key={s} onClick={() => setPrompt(s)}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div className={`chat-msg ${m.role}`} key={i}>
                  <div className="chat-label">{m.role === 'user' ? '你' : m.role === 'error' ? '错误' : '助手'}</div>
                  {m.role === 'assistant' && m.reasoning && (
                    <details className="reasoning-box">
                      <summary>思考过程（会额外计入 Token）</summary>
                      <div className="reasoning-text">{m.reasoning}</div>
                    </details>
                  )}
                  <div className="chat-text">{m.text || (streaming ? <span className="typing">▍</span> : '')}</div>
                  {m.role === 'assistant' && m.text && <div className="apply-row">
                    {canReplace && <button className="apply-btn primary" onClick={() => applyAIText(m.text, true)}><Check size={12} /> 替换选中节点</button>}
                    <button className="apply-btn" onClick={() => applyAIText(m.text, false)}><Copy size={12} /> 采纳到剧本末尾</button>
                  </div>}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <div className="chat-input">
              {error && <div className="alert error sm">{error}</div>}
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                placeholder="描述你要助手做的事…"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="btn btn-primary full" onClick={send} disabled={streaming || !prompt.trim()}>
                {streaming ? <><Loader2 className="spin" size={14} /> 生成中</> : <><Send size={14} /> 发送</>}
              </button>
            </div>
          </aside>
        )}
      </div>

      {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
        <button onClick={() => { addNode('action', contextMenu.idx); setContextMenu(null); }}><Plus size={13} /> 下方插入节点</button>
        <button onClick={() => { addNode('scene', contextMenu.idx); setContextMenu(null); }}><Plus size={13} /> 下方插入场景</button>
        <div className="cm-sep" />
        <button onClick={() => { selectNode(contextMenu.idx, false); setScope('node'); setContextMenu(null); }}><SlidersHorizontal size={13} /> 设为 AI 定点目标</button>
        <button onClick={() => { setScope('range'); setContextMenu(null); }}><CheckSquare size={13} /> 用当前区间改写</button>
        <div className="cm-sep" />
        <button onClick={() => { moveNode(contextMenu.idx, -1); setContextMenu(null); }}><ArrowUp size={13} /> 上移</button>
        <button onClick={() => { moveNode(contextMenu.idx, 1); setContextMenu(null); }}><ArrowDown size={13} /> 下移</button>
        <button className="danger" onClick={() => { removeNode(contextMenu.idx); setContextMenu(null); }}><Trash2 size={13} /> 删除节点</button>
      </div>}

      {exportOpen && <ExportDialog project={project} onClose={() => setExportOpen(false)} onExport={doExport} />}
    </div>
  );
}

function ExportDialog({ project, onClose, onExport }) {
  const [kind, setKind] = useState('script');
  const [format, setFormat] = useState('pdf');
  const [convention, setConvention] = useState(project.settings?.exportConvention || project.settings?.format || 'hollywood');
  const [episodes, setEpisodes] = useState(project.episodes.map((_, i) => i));
  const formats = kind === 'script'
    ? [['fdx', 'FDX（Final Draft）'], ['pdf', 'PDF'], ['docx', 'DOCX'], ['txt', 'TXT']]
    : [['pdf', 'PDF'], ['docx', 'DOCX'], ['txt', 'TXT']];
  const toggleEp = i => setEpisodes(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].sort());
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal export-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>交付导出</h3><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="export-body">
          <label>内容<select value={kind} onChange={e => { setKind(e.target.value); if (e.target.value === 'outline' && format === 'fdx') setFormat('pdf'); }}>
            <option value="script">剧本 Script</option><option value="outline">大纲 Outline</option>
          </select></label>
          <label>格式<select value={format} onChange={e => setFormat(e.target.value)}>
            {formats.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
          <label>剧本惯例<select value={convention} onChange={e => setConvention(e.target.value)}>
            <option value="hollywood">Hollywood</option><option value="asian">Asian</option>
          </select></label>
          <div className="export-episodes"><span>选择剧集（按顺序合并）</span>
            {project.episodes.map((e, i) => <label key={e.id}><input type="checkbox" checked={episodes.includes(i)} onChange={() => toggleEp(i)} /> {e.title}</label>)}
          </div>
          <p className="muted">FDX 仅用于 Hollywood 剧本导出；导出是快照，不会同步回项目。</p>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!episodes.length} onClick={() => onExport(format, { kind, convention, episodeIndexes: episodes })}>
            <Download size={14} /> 导出 .{format}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutlineView({ ep, mutate, onAsk }) {
  const outline = ep?.outline || [];
  return (
    <div className="simple-view">
      <div className="view-head"><div><h2>大纲</h2><p className="muted">按剧集编排场次。大纲是你对结构的承诺，剧本是对它的兑现。</p></div>
        <button className="btn btn-primary sm" onClick={() => mutate(e => e.outline.push({ id: `o_${Date.now()}`, text: '' }))}><Plus size={14} /> 添加条目</button>
      </div>
      <div className="outline-list">
        {outline.length === 0 && <div className="empty small">还没有大纲条目。点「添加条目」，或用 AI 从一句话 brief 生成。</div>}
        {outline.map((o, i) => (
          <div className="outline-item" key={o.id}>
            <span className="outline-num">{String(i + 1).padStart(2, '0')}</span>
            <textarea value={o.text} rows={2} placeholder="这一场发生了什么变化？" onChange={e => mutate(ep2 => { ep2.outline[i].text = e.target.value; })} />
            <button className="icon-btn danger" onClick={() => mutate(ep2 => ep2.outline.splice(i, 1))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <button className="btn btn-ghost" onClick={() => onAsk('基于当前剧本，给我一份结构化的分集大纲，标注每一集的核心冲突和反转')}><Sparkles size={14} /> 让 AI 生成大纲建议</button>
    </div>
  );
}

function ScenesView({ scenes }) {
  return (
    <div className="simple-view">
      <div className="view-head"><div><h2>场景</h2><p className="muted">从剧本场景标题派生。改剧本，这里跟着变。</p></div></div>
      {scenes.length === 0 ? <div className="empty small">剧本里还没有场景标题。用 <code>INT. 地点 - 时间</code> 开头写一行。</div> : (
        <div className="scene-grid">
          {scenes.map((s, i) => <div className="scene-card" key={i}><span>{String(i + 1).padStart(2, '0')}</span><strong>{s}</strong></div>)}
        </div>
      )}
    </div>
  );
}

function CharactersView({ project, mutate, names }) {
  const chars = project.characters || [];
  return (
    <div className="simple-view">
      <div className="view-head"><div><h2>角色档案</h2><p className="muted">角色是项目级共享身份。剧本里的角色提示会自动在这里出现候选，制作信息到「生产 → 选角表」。</p></div>
        <button className="btn btn-primary sm" onClick={() => mutate((_, p) => p.characters.push({ id: `c_${Date.now()}`, name: '', bio: '', voice: '' }))}><Plus size={14} /> 新增角色</button>
      </div>
      {names.length > 0 && <div className="derived-hint"><span>剧本中检测到：</span>{names.map(n => <span className="tag" key={n}>{n}</span>)}</div>}
      <div className="char-grid">
        {chars.length === 0 && <div className="empty small">还没有角色档案。</div>}
        {chars.map((c, i) => (
          <div className="char-card" key={c.id}>
            <input value={c.name} placeholder="角色名" onChange={e => mutate((_, p) => { p.characters[i].name = e.target.value; })} />
            <label>身份与背景<textarea rows={3} value={c.bio} onChange={e => mutate((_, p) => { p.characters[i].bio = e.target.value; })} placeholder="只写会影响选择、说话方式、服装或冲突的部分" /></label>
            <label>声音特征<textarea rows={2} value={c.voice} onChange={e => mutate((_, p) => { p.characters[i].voice = e.target.value; })} placeholder="用词、节奏、口头禅" /></label>
            <button className="icon-btn danger" onClick={() => mutate((_, p) => p.characters.splice(i, 1))}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorldView({ project, mutate }) {
  const entries = Object.entries(project.worldview || {});
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  return (
    <div className="simple-view">
      <div className="view-head"><div><h2>世界观</h2><p className="muted">只放 durable rules。资料放知识库，剧集后果放大纲。助手默认只读，写入需你显式点名。</p></div></div>
      <div className="kv-form">
        <input value={key} onChange={e => setKey(e.target.value)} placeholder="键，如 communication_delay" />
        <input value={val} onChange={e => setVal(e.target.value)} placeholder="值，如 消息需要九年才能抵达" />
        <button className="btn btn-primary sm" onClick={() => { if (!key.trim()) return; mutate((_, p) => { p.worldview[key.trim()] = val; }); setKey(''); setVal(''); }}>添加</button>
      </div>
      <div className="kv-list">
        {entries.length === 0 && <div className="empty small">还没有规则。</div>}
        {entries.map(([k, v]) => (
          <div className="kv-row" key={k}>
            <code>{k}</code><span>{v}</span>
            <button className="icon-btn danger" onClick={() => mutate((_, p) => { delete p.worldview[k]; })}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShotsView({ ep, mutate }) {
  const shots = ep?.shots || [];
  return (
    <div className="simple-view">
      <div className="view-head"><div><h2>分镜</h2><p className="muted">每个镜头都要有工作：它改变什么？观众看到什么？</p></div>
        <button className="btn btn-primary sm" onClick={() => mutate(e => e.shots.push({ id: `s_${Date.now()}`, scene: '', shotSize: '中景', camera: '固定', motion: '', duration: '3s', visual: '', audio: '' }))}><Plus size={14} /> 添加镜头</button>
      </div>
      {shots.length === 0 ? <div className="empty small">还没有镜头。用 AI 的「分镜」模式从场景生成。</div> : (
        <div className="shot-table-wrap"><table className="shot-table">
          <thead><tr><th>#</th><th>场景</th><th>景别</th><th>机位</th><th>运动</th><th>时长</th><th>画面</th><th>声音</th><th></th></tr></thead>
          <tbody>{shots.map((s, i) => <tr key={s.id}>
            <td>{i + 1}</td>
            <td><input value={s.scene} onChange={e => mutate(ep2 => { ep2.shots[i].scene = e.target.value; })} /></td>
            <td><select value={s.shotSize} onChange={e => mutate(ep2 => { ep2.shots[i].shotSize = e.target.value; })}>{['大远景','远景','全景','中景','近景','特写','大特写'].map(x => <option key={x}>{x}</option>)}</select></td>
            <td><input value={s.camera} onChange={e => mutate(ep2 => { ep2.shots[i].camera = e.target.value; })} /></td>
            <td><input value={s.motion} onChange={e => mutate(ep2 => { ep2.shots[i].motion = e.target.value; })} /></td>
            <td><input value={s.duration} onChange={e => mutate(ep2 => { ep2.shots[i].duration = e.target.value; })} /></td>
            <td><textarea rows={2} value={s.visual} onChange={e => mutate(ep2 => { ep2.shots[i].visual = e.target.value; })} /></td>
            <td><textarea rows={2} value={s.audio} onChange={e => mutate(ep2 => { ep2.shots[i].audio = e.target.value; })} /></td>
            <td><button className="icon-btn danger" onClick={() => mutate(ep2 => ep2.shots.splice(i, 1))}><Trash2 size={13} /></button></td>
          </tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
