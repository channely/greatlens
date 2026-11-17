import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Save, Download, Plus, Trash2, Sparkles, Send, ChevronDown,
  FileText, ListTree, Users, MapPin, Package, BookOpen, Clapperboard,
  Loader2, Check, Wand2, StickyNote, ArrowUp, ArrowDown, Copy
} from 'lucide-react';
import { api } from '../api.js';

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
  { id: 'characters', label: '角色', icon: Users },
  { id: 'world', label: '世界观', icon: BookOpen },
  { id: 'shots', label: '分镜', icon: Clapperboard },
];

const SCOPES = [
  { value: 'cursor', label: '光标处' },
  { value: 'scene', label: '当前场景' },
  { value: 'outline', label: '大纲' },
  { value: 'full', label: '全稿' },
];

const AI_MODES = [
  { value: 'chat', label: '对话' },
  { value: 'diagnose', label: '诊断' },
  { value: 'rewrite', label: '改写' },
  { value: 'continue', label: '续写' },
  { value: 'storyboard', label: '分镜' },
];

export default function Editor() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [epIdx, setEpIdx] = useState(0);
  const [tab, setTab] = useState('script');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [scope, setScope] = useState('scene');
  const [aiMode, setAiMode] = useState('chat');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const saveTimer = useRef(null);
  const chatEnd = useRef(null);
  const abortRef = useRef(null);
  const dirtyRef = useRef(false);
  const projectRef = useRef(null);
  const epIdxRef = useRef(epIdx);
  epIdxRef.current = epIdx;

  useEffect(() => {
    let alive = true;
    abortRef.current?.abort(); // 切换项目时终止上一段未完成的 AI 流
    setProject(null);
    api.projects.get(id).then(p => { if (alive) { projectRef.current = p; setProject(p); } })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id]);

  // 卸载时清理定时器与在途 AI 请求，避免卸载后 setState / 继续计费
  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    abortRef.current?.abort();
  }, []);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const ep = project?.episodes?.[epIdx];
  const nodes = ep?.nodes || [];

  function mutate(fn) {
    setProject(prev => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next.episodes[epIdxRef.current], next);
      next.updatedAt = new Date().toISOString();
      projectRef.current = next; // 同步引用，避免防抖保存到旧快照
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
  function removeNode(idx) { mutate(e => { e.nodes.splice(idx, 1); }); }
  function moveNode(idx, dir) {
    mutate(e => {
      const j = idx + dir;
      if (j < 0 || j >= e.nodes.length) return;
      [e.nodes[idx], e.nodes[j]] = [e.nodes[j], e.nodes[idx]];
    });
  }

  const derived = useMemo(() => {
    const scenes = [], characters = [];
    nodes.forEach(n => {
      if (n.type === 'scene' && n.text.trim()) scenes.push(n.text.trim());
      if (n.type === 'character' && n.text.trim() && !characters.includes(n.text.trim())) characters.push(n.text.trim());
    });
    return { scenes, characters };
  }, [nodes]);

  function contextForAI() {
    if (scope === 'full') return nodes.map(n => `${n.type}: ${n.text}`).join('\n');
    if (scope === 'outline') return (ep?.outline || []).map(o => o.text).join('\n');
    if (scope === 'scene') {
      const sceneText = nodes.map(n => `${n.type}: ${n.text}`).join('\n');
      return sceneText.slice(-6000);
    }
    return nodes.slice(-5).map(n => `${n.type}: ${n.text}`).join('\n');
  }

  async function send() {
    if (!prompt.trim() || streaming) return;
    abortRef.current?.abort(); // 取消任何残留的旧流
    const controller = new AbortController();
    abortRef.current = controller;
    const userText = prompt.trim();
    setPrompt('');
    setMessages(m => [...m, { role: 'user', text: userText }]);
    setStreaming(true);
    let acc = '';
    let reasoning = '';
    setMessages(m => [...m, { role: 'assistant', text: '', reasoning: '' }]);
    // 只更新最后一条助手消息，避免覆盖实时追加的思考片段。
    const patchLast = (patch) => setMessages(m => {
      if (!m.length) return m;
      const copy = [...m];
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
      return copy;
    });
    try {
      await api.ai.stream(
        { prompt: userText, scope, mode: aiMode, context: contextForAI() },
        {
          signal: controller.signal,
          onDelta: (delta) => { acc += delta; patchLast({ text: acc }); },
          onReasoning: (chunk) => { reasoning += chunk; patchLast({ reasoning }); },
        }
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(m => [...m, { role: 'error', text: err.message }]);
        setError(err.message);
      }
    } finally { if (abortRef.current === controller) setStreaming(false); }
  }

  function applyAIText(text) {
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return;
    mutate(e => {
      lines.forEach(line => {
        let type = 'action';
        const upper = line.toUpperCase();
        if (/^(INT\.|EXT\.|EST\.|INT\/EXT)/.test(upper)) type = 'scene';
        else if (/^(CUT TO|FADE IN|FADE OUT|SMASH CUT|DISSOLVE)/.test(upper)) type = 'transition';
        else if (line.length < 28 && /^[A-Z\u4e00-\u9fa5\s（）()·-]+$/.test(line) && !/[。！？，]/.test(line)) type = 'character';
        else if (/^（.*）$/.test(line) || /^\(.*\)$/.test(line)) type = 'parenthetical';
        e.nodes.push({ id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type, text: line.replace(/^[^:]+:\s*/, '') });
      });
    });
    setTab('script');
  }

  async function doExport(format) {
    try {
      const res = await fetch(`/api/export/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${project.name}.${format === 'markdown' ? 'md' : 'fountain'}`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
  }

  if (error && !project) return <main className="container page"><div className="alert error">{error}</div><Link to="/projects">返回项目</Link></main>;
  if (!project) return <main className="container page"><div className="loading"><Loader2 className="spin" size={20} /> 加载中…</div></main>;

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
          <button className="btn btn-ghost sm" onClick={() => doExport('markdown')}><Download size={14} /> Markdown</button>
          <button className={`btn btn-ghost sm ${aiOpen ? 'active' : ''}`} onClick={() => setAiOpen(v => !v)}><Sparkles size={14} /> AI</button>
        </div>
      </div>

      <div className="ws-body">
        <div className="ws-main">
          <div className="ws-tabs">
            {TABS.map(t => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon size={14} /> {t.label}</button>)}
            <div className="episode-select">
              {project.episodes.map((e, i) => <button key={e.id} className={i === epIdx ? 'active' : ''} onClick={() => setEpIdx(i)}>{e.title}</button>)}
              <button className="ep-add" title="新增剧集" onClick={() => {
                api.projects.addEpisode(id, `第 ${project.episodes.length + 1} 集`).then(() => api.projects.get(id)).then(p => { setProject(p); setEpIdx(p.episodes.length - 1); });
              }}><Plus size={14} /></button>
            </div>
          </div>

          <div className="ws-content">
            {tab === 'script' && (
              <div className="script-view">
                <div className="script-toolbar">
                  <span>语义节点 · {nodes.length} 段</span>
                  <div>
                    <button className="btn btn-ghost sm" onClick={() => addNode('scene')}><Plus size={13} /> 场景标题</button>
                    <button className="btn btn-ghost sm" onClick={() => addNode('action')}><Plus size={13} /> 动作</button>
                  </div>
                </div>
                <div className="script-paper editor-paper">
                  {nodes.length === 0 && (
                    <div className="paper-empty">
                      <p>剧本是唯一的事实来源。</p>
                      <button className="btn btn-primary" onClick={() => addNode('scene')}>写下第一个场景标题</button>
                    </div>
                  )}
                  {nodes.map((n, i) => (
                    <div className={`node-row ${n.type === 'comment' ? 'is-comment' : ''}`} key={n.id}>
                      <div className="node-gutter">
                        <button title="上移" onClick={() => moveNode(i, -1)}><ArrowUp size={11} /></button>
                        <button title="下移" onClick={() => moveNode(i, 1)}><ArrowDown size={11} /></button>
                        <button title="删除" onClick={() => removeNode(i)}><Trash2 size={11} /></button>
                      </div>
                      <select className="node-type" value={n.type} onChange={e => updateNode(i, { type: e.target.value })}>
                        {NODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <textarea
                        className={`node-input ${n.type}`}
                        value={n.text}
                        rows={Math.max(1, Math.ceil(n.text.length / (n.type === 'dialogue' ? 34 : 60)))}
                        placeholder={NODE_TYPES.find(t => t.value === n.type)?.hint}
                        onChange={e => updateNode(i, { text: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNode(n.type === 'scene' ? 'action' : n.type, i); }
                        }}
                      />
                    </div>
                  ))}
                  <button className="add-node-row" onClick={() => addNode('action')}><Plus size={14} /> 添加节点（⌘/Ctrl + Enter 快速插入）</button>
                </div>
              </div>
            )}

            {tab === 'outline' && <OutlineView ep={ep} mutate={mutate} onAsk={q => { setPrompt(q); setAiOpen(true); }} />}
            {tab === 'scenes' && <ScenesView scenes={derived.scenes} nodes={nodes} />}
            {tab === 'characters' && <CharactersView project={project} mutate={mutate} names={derived.characters} />}
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
            </div>
            <div className="chat-list">
              {messages.length === 0 && (
                <div className="chat-hint">
                  <Wand2 size={22} />
                  <p>先选读取范围，再提问。</p>
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
                  {m.role === 'assistant' && m.text && (
                    <button className="apply-btn" onClick={() => applyAIText(m.text)}><Copy size={12} /> 采纳到剧本末尾</button>
                  )}
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
      <div className="view-head"><div><h2>角色</h2><p className="muted">角色是项目级共享身份。剧本里的角色提示会自动在这里出现候选。</p></div>
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
      <div className="view-head"><div><h2>世界观</h2><p className="muted">只放 durable rules。资料放知识库，剧集后果放大纲。</p></div></div>
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
