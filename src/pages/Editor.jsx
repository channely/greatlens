import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Save, Download, Plus, Trash2, Sparkles, Send,
  FileText, ListTree, Users, MapPin, BookOpen, Clapperboard,
  Loader2, Check, Wand2, ArrowUp, ArrowDown, Copy, Network,
  ClipboardList, Package, X, SlidersHorizontal, CheckSquare, Ruler,
  Undo2, Redo2, Command, History, Stethoscope, Mic2, GitBranch,
} from 'lucide-react';
import { api } from '../api.js';
import { useTheme } from '../theme.js';
import { CastingView, RelationshipsView, LocationsPropsView, KnowledgeView } from './Entities.jsx';
import Timeline from './Timeline.jsx';
import Beats from './Beats.jsx';
import VersionHistory from '../components/VersionHistory.jsx';
import { EntityAssetField } from '../components/AssetPicker.jsx';
import ProjectSettingsDialog from '../components/ProjectSettingsDialog.jsx';
import CoverView from './CoverView.jsx';
import ScriptDoctorPanel from '../components/ScriptDoctorPanel.jsx';
import TastePanel from '../components/TastePanel.jsx';
import RevisionPanel from '../components/RevisionPanel.jsx';
import SceneBoardView from '../components/SceneBoardView.jsx';
import SpaceView from '../components/SpaceView.jsx';
import CanvasBoard from '../components/CanvasBoard.jsx';
import AudioStudio from '../components/AudioStudio.jsx';

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

// 三组：写（创作）/ 看（呈现）/ 管（资产与生产）。功能入口一个不少，仅按工作动线归拢。
const TAB_GROUPS = [
  { id: 'write', label: '写', hint: '创作与结构', tabs: [
    { id: 'script', label: '剧本', icon: FileText },
    { id: 'cover', label: '封面', icon: FileText },
    { id: 'outline', label: '大纲', icon: ListTree },
    { id: 'beats', label: '节拍', icon: SlidersHorizontal },
  ] },
  { id: 'view', label: '看', hint: '呈现与审阅', tabs: [
    { id: 'scenes', label: '场景', icon: MapPin },
    { id: 'shots', label: '分镜', icon: Clapperboard },
    { id: 'timeline', label: '时间轴', icon: Ruler },
    { id: 'space', label: 'Space', icon: Network },
    { id: 'audio', label: '声音', icon: Mic2 },
  ] },
  { id: 'manage', label: '管', hint: '资产与生产', tabs: [
    { id: 'characters', label: '角色档案', icon: Users },
    { id: 'production', label: '生产', icon: ClipboardList },
    { id: 'world', label: '世界观', icon: BookOpen },
  ] },
];

const PROD_TABS = [
  { id: 'casting', label: '选角表', icon: Users },
  { id: 'relations', label: '关系图谱', icon: Network },
  { id: 'locations', label: '地点 / 道具', icon: Package },
  { id: 'knowledge', label: '知识库', icon: BookOpen },
];

const SCOPES = [
  { value: 'cursor', label: '光标处' },
  { value: 'selection', label: '选中文字（字级）' },
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
  const nav = useNavigate();
  const initialTab = new URLSearchParams(window.location.search).get('tab');
  const [project, setProject] = useState(null);
  const [epIdx, setEpIdx] = useState(0);
  const [tab, setTab] = useState(() => ['outline', 'beats', 'characters', 'cover', 'audio'].includes(initialTab) ? initialTab : initialTab === 'locations' ? 'production' : 'script');
  const [prodTab, setProdTab] = useState(() => initialTab === 'locations' ? 'locations' : 'casting');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [scope, setScope] = useState('scene');
  const [aiMode, setAiMode] = useState('chat');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [sel, setSel] = useState({ start: -1, end: -1 });
  // 字级选区：记录某个节点 textarea 内被选中的字符范围 [start, end)
  const [charSel, setCharSel] = useState(null); // { nodeIdx, start, end, text }
  const [contextMenu, setContextMenu] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [advisors, setAdvisors] = useState([]);
  const [intention, setIntention] = useState('');
  const [constraints, setConstraints] = useState('');
  const [authLayers, setAuthLayers] = useState(['script']);
  const [attachedKnowledge, setAttachedKnowledge] = useState([]); // [{ id, role }]，本次请求按需加载正文
  const [showStructured, setShowStructured] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [tasteOpen, setTasteOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [feedbackTick, setFeedbackTick] = useState(0);
  const [saveConflict, setSaveConflict] = useState('');
  const { theme, toggleTheme } = useTheme();
  const [derived, setDerived] = useState(null);
  const saveTimer = useRef(null);
  const saveEpoch = useRef(0);
  const conflictRef = useRef(false);
  const chatEnd = useRef(null);
  const abortRef = useRef(null);
  const dirtyRef = useRef(false);
  const projectRef = useRef(null);
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const [history, setHistory] = useState({ undo: false, redo: false });
  const undoRef = useRef(() => {});
  const redoRef = useRef(() => {});
  const HISTORY_LIMIT = 60;
  const epIdxRef = useRef(epIdx);
  epIdxRef.current = epIdx;

  const syncHistory = () => setHistory({ undo: pastRef.current.length > 0, redo: futureRef.current.length > 0 });

  useEffect(() => {
    let alive = true;
    saveEpoch.current += 1;
    const epoch = saveEpoch.current;
    clearTimeout(saveTimer.current);
    conflictRef.current = false;
    dirtyRef.current = false;
    abortRef.current?.abort();
    setProject(null);
    setSaveConflict('');
    setSaved(false);
    api.projects.get(id).then(p => {
      if (alive && epoch === saveEpoch.current) {
        pastRef.current = []; futureRef.current = []; syncHistory();
        projectRef.current = p; setProject(p);
      }
    }).catch(e => { if (alive && epoch === saveEpoch.current) setError(e.message); });
    api.ai.advisors().then(a => { if (alive && epoch === saveEpoch.current) setAdvisors(a); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  useEffect(() => () => {
    saveEpoch.current += 1;
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

  // 撤销 / 重做：焦点在输入框时交给浏览器原生处理文本撤销，其余场景做项目级撤销。
  useEffect(() => {
    const onKey = e => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); setCmdOpen(v => !v); return; }
      if (k !== 'z' && k !== 'y') return;
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
      if (typing) return;
      const redo = k === 'y' || e.shiftKey;
      e.preventDefault();
      redo ? redoRef.current() : undoRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ep = project?.episodes?.[epIdx];
  const nodes = ep?.nodes || [];
  const selLo = Math.min(sel.start, sel.end);
  const selHi = Math.max(sel.start, sel.end);
  const hasSel = sel.start >= 0 && sel.start < nodes.length;

  function scheduleSave() {
    if (conflictRef.current) return;
    setSaved(false);
    dirtyRef.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const cur = projectRef.current;
      const epoch = saveEpoch.current;
      if (!cur || !dirtyRef.current || epoch !== saveEpoch.current) return;
      const payload = structuredClone(cur);
      dirtyRef.current = false;
      try {
        const saved = await api.projects.save(cur.id, payload, cur.revision);
        if (epoch !== saveEpoch.current || projectRef.current?.id !== cur.id) return;
        projectRef.current = { ...projectRef.current, revision: saved.revision, versionHash: saved.versionHash };
        setProject(prev => prev && prev.id === cur.id
          ? { ...prev, revision: saved.revision, versionHash: saved.versionHash }
          : prev);
        setSaved(!dirtyRef.current);
      } catch (e) {
        if (epoch !== saveEpoch.current) return;
        setError(e.message);
        if (/已被其他会话更新|409/.test(String(e.message || ''))) {
          conflictRef.current = true;
          setSaveConflict(e.message);
        }
      }
    }, 700);
  }

  function onSettingsSaved(saved) {
    projectRef.current = saved;
    setProject(saved);
    setSaved(true);
    setError('');
  }

  function onRestored(project) {
    saveEpoch.current += 1;
    clearTimeout(saveTimer.current);
    conflictRef.current = false;
    dirtyRef.current = false;
    pastRef.current = [];
    futureRef.current = [];
    syncHistory();
    setSel({ start: -1, end: -1 });
    setCharSel(null);
    projectRef.current = project;
    setProject(project);
    setSaved(true);
    setSaveConflict('');
    setError('');
    setVersionOpen(false);
  }

  // 把一次完整的项目快照提交到状态与历史栈。record=true 时记录为可撤销的一步。
  function commit(next, record) {
    if (!next) return;
    const prev = projectRef.current;
    if (record && prev) {
      pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), structuredClone(prev)];
      futureRef.current = [];
      syncHistory();
    }
    next.updatedAt = new Date().toISOString();
    projectRef.current = next;
    setProject(next);
    scheduleSave();
  }

  function mutate(fn) {
    const prev = projectRef.current;
    if (!prev) return;
    const next = structuredClone(prev);
    fn(next.episodes[epIdxRef.current], next);
    commit(next, true);
  }

  function undo() {
    if (!pastRef.current.length) return;
    const prev = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, structuredClone(projectRef.current)];
    syncHistory();
    commit(prev, false);
  }

  function redo() {
    if (!futureRef.current.length) return;
    const next = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, structuredClone(projectRef.current)];
    syncHistory();
    commit(next, false);
  }
  undoRef.current = undo;
  redoRef.current = redo;

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
    // 节点级选区变化时，清除上一处字级选区，避免两个选区歧义。
    setCharSel(null);
  }

  // 捕获 textarea 内真正的字符选区（鼠标拖选 / Shift+方向键），仅当有长度时记录。
  function captureCharSel(idx, el) {
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    if (selectionEnd > selectionStart) {
      const text = value.slice(selectionStart, selectionEnd);
      setCharSel(prev => (prev && prev.nodeIdx === idx && prev.start === selectionStart && prev.end === selectionEnd && prev.text === text)
        ? prev : { nodeIdx: idx, start: selectionStart, end: selectionEnd, text });
    } else if (charSel && charSel.nodeIdx === idx) {
      // 同一输入框内把选区收拢为一个光标时，清除字级选区。
      setCharSel(null);
    }
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

  const derivedScenes = useMemo(
    () => (derived?.scenes || []).filter(s => s.episode === epIdx),
    [derived, epIdx],
  );

  // 写作现场的连续性提示：与服务端 norm 规则一致，只比对当前剧集，登记表中已有条目时才提示。
  const normName = s => String(s || '').trim().toUpperCase().replace(/\s*（.*?）\s*/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ');
  const liveIssues = useMemo(() => {
    if (!project) return [];
    const out = [];
    const charNames = new Set((project.characters || []).map(c => normName(c.name)));
    if (charNames.size) for (const name of derivedSC.characters) {
      if (!charNames.has(normName(name))) out.push({ kind: 'character', text: `角色「${name}」还没有档案` });
    }
    if (derived?.locations?.length) {
      const locNames = new Set((project.locations || []).map(l => normName(l.name)));
      if (locNames.size) for (const l of derived.locations) {
        if (!locNames.has(normName(l.name))) out.push({ kind: 'location', text: `地点「${l.name}」未登记` });
      }
    }
    return out;
  }, [project, derived, derivedSC]);

  function contextForAI() {
    // 字级选区：只把被选中的那几个字作为上下文，配合定点替换实现真正的行内改写。
    if (scope === 'selection' && charSel) {
      const n = nodes[charSel.nodeIdx];
      return `【节点 ${charSel.nodeIdx + 1}（${n?.type || '?'}）中被选中的文字】\n${charSel.text}`;
    }
    if (scope === 'node' && hasSel) return nodeLine(nodes[selLo]);
    if (scope === 'cursor') {
      // 光标落在哪个节点，就以该节点为中心取前后各两个节点，而不是笼统的最近五条。
      const center = hasSel ? selLo : Math.max(0, nodes.length - 1);
      return nodes.slice(Math.max(0, center - 2), center + 3).map(nodeLine).join('\n');
    }
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
    if (scope === 'selection' && charSel) {
      const preview = charSel.text.length > 40 ? charSel.text.slice(0, 40) + '…' : charSel.text;
      return `第${epIdx + 1}集 / 节点 ${charSel.nodeIdx + 1} 内选中的文字（第 ${charSel.start + 1}–${charSel.end} 字）：${preview}`;
    }
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
        projectId: project?.id || '',
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
          // 本次点名加载的资料正文（有界，每份 ≤ 4000 字；仅作证据，不逐字复制）
          knowledgeExcerpts: attachedKnowledge.map(a => {
            const k = (project.knowledge || []).find(x => x.id === a.id);
            if (!k) return null;
            const body = String(k.body || '').slice(0, 4000);
            return body ? { name: k.name, role: a.role || '作为本次写作的证据参考', body } : null;
          }).filter(Boolean),
          characters: (project.characters || []).map(c => c.name).filter(Boolean),
          locations: (project.locations || []).map(l => l.name).filter(Boolean),
          props: (project.props || []).map(p => p.name).filter(Boolean),
          // 分镜参考图槽位：把每个镜头挂的参考图作为视觉约束交给 AI（图本身不塞给模型，只给描述/URL）
          shotRefs: (ep?.shots || []).filter(s => s.refImage).map((s, i) => ({
            shot: i + 1, scene: s.scene, note: s.refImage.note || '',
            image: s.refImage.name || s.refImage.url || '',
          })),
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

  // 作者口味反馈：把采纳 / 弃用的 AI 输出沉淀为长期偏好（本地确定性计算）。
  function giveFeedback(text, verdict) {
    if (!project?.id || !text) return;
    api.projects.taste.feedback(project.id, { verdict, text, mode: aiMode, scope })
      .then(() => setFeedbackTick(t => t + 1))
      .catch(() => {});
  }

  // 定点替换：改写模式下若选中了字级文字/节点/区间，原位替换该段；否则追加到末尾。
  function applyAIText(text, replace) {
    const parsed = parseAIText(text);
    if (!parsed.length) return;
    if (replace && scope === 'selection' && charSel) {
      // 字级替换：把选中文字换成 AI 输出（多行则合并为空格，保持单节点语义不破裂）。
      const replacement = parsed.map(p => p.text).join(' ').trim();
      mutate(e => {
        const node = e.nodes[charSel.nodeIdx];
        if (!node) return;
        node.text = node.text.slice(0, charSel.start) + replacement + node.text.slice(charSel.end);
      });
      setCharSel(null);
      setTab('script');
      return;
    }
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

  async function convertToCinema() {
    if (!confirm('把当前 Script 一次性转换为独立的 Cinema 项目？源剧本保持不变，两者之后各自演进，不会自动同步。')) return;
    try {
      const c = await api.projects.toCinema(project.id);
      nav(`/cinema/${c.id}`);
    } catch (e) { setError(e.message || '转换失败'); }
  }

  if (error && !project) return <main className="container page"><div className="alert error">{error}</div><Link to="/projects">返回项目</Link></main>;
  if (!project) return <main className="container page"><div className="loading"><Loader2 className="spin" size={20} /> 加载中…</div></main>;

  const canReplace = (scope === 'selection' && !!charSel) || (hasSel && (scope === 'node' || scope === 'range'));
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
          {saveConflict && <span className="muted small" title={saveConflict}>保存冲突，请刷新</span>}
          <button className="btn btn-ghost sm" title="项目设置" onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={14} /> 设置</button>
          <button className="btn btn-ghost sm" title="版本历史与恢复" onClick={() => setVersionOpen(true)}><History size={14} /> 版本</button>
          <button className="icon-btn" title="撤销（⌘/Ctrl+Z，输入框内用文本撤销）" disabled={!history.undo} onClick={undo}><Undo2 size={15} /></button>
          <button className="icon-btn" title="重做（⇧⌘/Ctrl+Z）" disabled={!history.redo} onClick={redo}><Redo2 size={15} /></button>
          <button className="btn btn-ghost sm" title="命令面板（⌘/Ctrl+K）" onClick={() => setCmdOpen(true)}><Command size={13} /> 命令</button>
          {project.type === 'script' && <button className="btn btn-ghost sm" title="一次性复制场景/角色/道具为独立 Cinema 项目（源不变，不自动同步）" onClick={convertToCinema}><Clapperboard size={14} /> 转为 Cinema</button>}
          <button className="btn btn-ghost sm" onClick={() => doExport('fountain')}><Download size={14} /> Fountain</button>
          <button className="btn btn-ghost sm" onClick={() => setExportOpen(true)}><Download size={14} /> 交付导出</button>
          <button className={`btn btn-ghost sm ${aiOpen ? 'active' : ''}`} onClick={() => setAiOpen(v => !v)}><Sparkles size={14} /> AI</button>
        </div>
      </div>

      <div className="ws-body">
        <div className="ws-main">
          <div className="ws-tabs">
            {TAB_GROUPS.map((g, gi) => (
              <React.Fragment key={g.id}>
                {gi > 0 && <span className="tab-divider" aria-hidden="true" />}
                <span className="tab-group-tag" title={g.hint}>{g.label}</span>
                {g.tabs.map(t => (
                  <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon size={14} /> {t.label}</button>
                ))}
              </React.Fragment>
            ))}
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
                  <span>语义节点 · {nodes.length} 段
                    {charSel && <em className="sel-hint"> · 选中文字「{charSel.text.length > 16 ? charSel.text.slice(0, 16) + '…' : charSel.text}」{scope !== 'selection' && <button className="chip-link" onClick={() => { setScope('selection'); setAiOpen(true); }}>用这段提问 →</button>}</em>}
                    {!charSel && hasSel && <em className="sel-hint"> · 已选节点 {selLo + 1}{selHi !== selLo ? `–${selHi + 1}` : ''}（可定点改写）</em>}
                  </span>
                  <div>
                    <button className="btn btn-ghost sm" onClick={() => addNode('scene')}><Plus size={13} /> 场景标题</button>
                    <button className="btn btn-ghost sm" onClick={() => addNode('action')}><Plus size={13} /> 动作</button>
                  </div>
                </div>
                {liveIssues.length > 0 && (
                  <div className="live-audit">
                    <span>写作中新增，尚未登记：</span>
                    {liveIssues.slice(0, 3).map((it, i) => <span className="live-audit-item" key={i}>{it.text}</span>)}
                    {liveIssues.length > 3 && <span className="live-audit-item">等 {liveIssues.length} 项</span>}
                    <button className="chip-link" onClick={() => { setTab('production'); setProdTab(it => liveIssues[0]?.kind === 'location' ? 'locations' : 'casting'); }}>去登记 →</button>
                  </div>
                )}
                <div className="script-paper editor-paper" onClick={() => setSel({ start: -1, end: -1 })}>
                  {nodes.length === 0 && (
                    <div className="paper-empty">
                      <p>写下第一场，场景与角色会自动出现在对应视图。</p>
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
                        onClick={e => { e.stopPropagation(); captureCharSel(i, e.target); }}
                        onMouseUp={e => captureCharSel(i, e.target)}
                        onKeyUp={e => captureCharSel(i, e.target)}
                        onSelect={e => captureCharSel(i, e.target)}
                        onChange={e => { updateNode(i, { text: e.target.value }); captureCharSel(i, e.target); }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNode(n.type === 'scene' ? 'action' : n.type, i); }
                        }}
                      />
                    </div>;
                  })}
                  <button className="add-node-row" onClick={() => addNode('action')}><Plus size={14} /> 添加节点　⌘/Ctrl+Enter 插入 · Shift 点选 · 右键更多 · 拖动排序</button>
                </div>
              </div>
            )}

            {tab === 'cover' && <CoverView project={project} mutate={mutate} />}
            {tab === 'outline' && <OutlineView ep={ep} mutate={mutate} onAsk={q => { setPrompt(q); setAiOpen(true); }} />}
            {tab === 'beats' && <Beats ep={ep} mutate={mutate} onAsk={q => { setPrompt(q); setAiOpen(true); }} />}
            {tab === 'scenes' && <SceneBoardView project={project} ep={ep} scenes={derivedScenes} mutate={mutate} />}
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
            {tab === 'shots' && <ShotsView ep={ep} project={project} projectId={project.id} mutate={mutate} />}
            {tab === 'space' && <SpaceView project={project} mutate={mutate} />}
            {tab === 'audio' && <AudioStudio project={project} episodeId={ep?.id} />}
            {tab === 'timeline' && <Timeline ep={ep} project={project} mutate={mutate} onAsk={q => { setPrompt(q); setAiOpen(true); }} />}
          </div>
        </div>

        {aiOpen && (
          <aside className="ai-panel">
            <div className="ai-head">
              <div><Sparkles size={16} /> <strong>创作助手</strong></div>
              <div className="ai-head-actions">
                <button className="btn btn-ghost sm" title="剧本医生：诊断 → 处方 → 采纳" onClick={() => setDoctorOpen(true)}><Stethoscope size={13} /> 医生</button>
                <button className="btn btn-ghost sm" title="作者口味记忆：管理长期偏好" onClick={() => setTasteOpen(true)}><Sparkles size={13} /> 口味</button>
                <button className="btn btn-ghost sm" title="修订说明与节拍备选方案" onClick={() => setRevisionOpen(true)}><GitBranch size={13} /> 修订</button>
                <button className="icon-btn" onClick={() => setAiOpen(false)}>×</button>
              </div>
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
                <p className="auth-hint">勾选层并在消息中点名键值，助手才会写入。</p>
                {(project.knowledge || []).length > 0 && <div className="knowledge-attach">
                  <span>本次引用资料（点名后才加载正文）</span>
                  {(project.knowledge || []).map(k => {
                    const on = attachedKnowledge.some(a => a.id === k.id);
                    return <div className="knowledge-attach-row" key={k.id}>
                      <label><input type="checkbox" checked={on} onChange={e => setAttachedKnowledge(prev => e.target.checked ? [...prev, { id: k.id, role: '' }] : prev.filter(a => a.id !== k.id))} /> {k.name}</label>
                      {on && <input className="knowledge-role" placeholder="它在这次写作里的作用，例：人物原型 / 时代背景" value={(attachedKnowledge.find(a => a.id === k.id) || {}).role || ''} onChange={e => setAttachedKnowledge(prev => prev.map(a => a.id === k.id ? { ...a, role: e.target.value } : a))} />}
                    </div>;
                  })}
                </div>}
              </div>}
            </div>
            <div className="chat-list">
              {messages.length === 0 && (
                <div className="chat-hint">
                  <Wand2 size={22} />
                  <p>拖选文字做字级改写 · Shift 点选节点做整段替换。</p>
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
                    <button className="apply-btn" title="记住这种写法，后续 AI 会保持" onClick={() => { applyAIText(m.text, false); giveFeedback(m.text, 'accepted'); }}>👍 喜欢</button>
                    <button className="apply-btn" title="避免同类写法，后续 AI 会规避" onClick={() => giveFeedback(m.text, 'rejected')}>👎 弃用</button>
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

      {exportOpen && <ExportDialog project={project} onClose={() => setExportOpen(false)} onExport={doExport} onSaved={onSettingsSaved} />}
      {settingsOpen && <ProjectSettingsDialog project={project} onClose={() => setSettingsOpen(false)} onSaved={onSettingsSaved} />}
      {doctorOpen && <ScriptDoctorPanel project={project} episodeId={ep?.id} onClose={() => setDoctorOpen(false)} onSaved={onSettingsSaved} />}
      {tasteOpen && <TastePanel projectId={project.id} refreshKey={feedbackTick} onClose={() => setTasteOpen(false)} />}
      {revisionOpen && <RevisionPanel project={project} episodeId={ep?.id} onClose={() => setRevisionOpen(false)} onSaved={onSettingsSaved} />}
      {versionOpen && <VersionHistory
        projectId={project.id}
        baseRevision={project.revision}
        onClose={() => setVersionOpen(false)}
        onRestored={onRestored}
      />}
      {cmdOpen && <CommandPalette
        commands={[
          ...TAB_GROUPS.flatMap(g => g.tabs.map(t => ({ label: `切到「${t.label}」`, group: '导航', icon: t.icon, run: () => setTab(t.id) }))),
          { label: '新增场景标题', group: '编辑', icon: Plus, run: () => { setTab('script'); addNode('scene'); } },
          { label: '新增动作节点', group: '编辑', icon: Plus, run: () => { setTab('script'); addNode('action'); } },
          { label: '撤销', group: '编辑', icon: Undo2, disabled: !history.undo, run: undo },
          { label: '重做', group: '编辑', icon: Redo2, disabled: !history.redo, run: redo },
          { label: '打开创作助手', group: '视图', icon: Sparkles, run: () => setAiOpen(true) },
          { label: '关闭创作助手', group: '视图', icon: X, run: () => setAiOpen(false) },
          { label: theme === 'dark' ? '切换到浅色主题' : '切换到深色主题', group: '视图', icon: Command, run: toggleTheme },
          { label: '版本历史…', group: '文件', icon: History, run: () => setVersionOpen(true) },
          { label: '交付导出…', group: '文件', icon: Download, run: () => setExportOpen(true) },
          { label: '导出 Fountain', group: '文件', icon: Download, run: () => doExport('fountain') },
        ]}
        onClose={() => setCmdOpen(false)}
      />}
    </div>
  );
}

function CommandPalette({ commands, onClose }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const list = useMemo(() => commands.filter(c => !c.disabled && (c.label + c.group).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30), [commands, q]);
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const exec = c => { if (c) { c.run(); onClose(); } };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef} className="cmd-input" placeholder="输入命令…（↑↓ 选择 · Enter 执行 · Esc 关闭）"
          value={q} onChange={e => { setQ(e.target.value); setActive(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, list.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); exec(list[active]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        <div className="cmd-list">
          {list.length === 0 && <div className="cmd-empty">没有匹配的命令</div>}
          {list.map((c, i) => <button key={c.label} className={`cmd-row ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => exec(c)}>
            <span className="cmd-group">{c.group}</span><c.icon size={14} /> {c.label}
          </button>)}
        </div>
      </div>
    </div>
  );
}

function ExportDialog({ project, onClose, onExport, onSaved }) {
  const [conventionError, setConventionError] = useState('');
  const [kind, setKind] = useState('script');
  const [format, setFormat] = useState('pdf');
  const [convention, setConvention] = useState(project.settings?.exportConvention || project.settings?.format || 'hollywood');
  const [episodes, setEpisodes] = useState(project.episodes.map((_, i) => i));
  const [readiness, setReadiness] = useState(null);
  const [showInfo, setShowInfo] = useState(false);
  const check = () => api.projects.readiness(project.id).then(setReadiness).catch(() => {});
  useEffect(() => { check(); }, [project.id]);
  async function changeConvention(value) {
    setConvention(value);
    setConventionError('');
    try {
      const saved = await api.projects.saveSettings(project.id, { settings: { exportConvention: value } }, project.revision);
      onSaved?.(saved);
    } catch (e) { setConventionError(e.message || '保存格式失败'); }
  }
  const formats = kind === 'script'
    ? [['fdx', 'FDX（Final Draft）'], ['pdf', 'PDF'], ['docx', 'DOCX'], ['txt', 'TXT']]
    : [['pdf', 'PDF'], ['docx', 'DOCX'], ['txt', 'TXT']];
  const toggleEp = i => setEpisodes(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i].sort());
  const warns = readiness?.summary?.warn || 0;
  const infos = readiness?.summary?.info || 0;
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
          <label>剧本惯例<select value={convention} onChange={e => changeConvention(e.target.value)}>
            <option value="hollywood">Hollywood</option><option value="asian">Asian</option>
          </select></label>
          {conventionError && <div className="alert error sm">{conventionError}</div>}
          <div className="export-episodes"><span>选择剧集（按顺序合并）</span>
            {project.episodes.map((e, i) => <label key={e.id}><input type="checkbox" checked={episodes.includes(i)} onChange={() => toggleEp(i)} /> {e.title}</label>)}
          </div>

          <div className="readiness">
            <div className="readiness-head">
              <span>交付前检查</span>
              <button className="chip-link" onClick={check}>重新检查</button>
            </div>
            {!readiness ? <p className="muted">检查中…</p> : readiness.summary.total === 0
              ? <div className="callout ok">未发现需要收口的矛盾，可以直接导出。</div>
              : <>
                <div className="readiness-summary">
                  <span className={warns ? 'rw-warn' : ''}>{warns} 项需核对</span>
                  <span>{infos} 项可优化</span>
                </div>
                {readiness.items.filter(i => i.level === 'warn').map((it, i) => (
                  <div className="readiness-row warn" key={`w${i}`}><span className="readiness-kind">{it.group}</span><span>{it.text}</span></div>
                ))}
                {infos > 0 && (
                  <>
                    <button className="chip-link" onClick={() => setShowInfo(v => !v)}>{showInfo ? '收起' : `展开 ${infos} 项可优化`}</button>
                    {showInfo && readiness.items.filter(i => i.level === 'info').map((it, i) => (
                      <div className="readiness-row" key={`i${i}`}><span className="readiness-kind">{it.group}</span><span>{it.text}</span></div>
                    ))}
                  </>
                )}
              </>}
            <p className="muted">检查只做提示，不改动项目；导出仍是当前数据的快照。</p>
          </div>
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
      <div className="view-head"><div><h2>大纲</h2><p className="muted">按剧集编排场次：先定冲突与反转，再写剧本。</p></div>
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
      <div className="view-head"><div><h2>角色档案</h2><p className="muted">剧本里的角色提示会在这里汇总；选角与制作信息到「生产 → 选角表」。</p></div>
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
      <div className="view-head"><div><h2>世界观</h2><p className="muted">只放确定的规则。资料进知识库，剧集后果进大纲；助手默认只读，写入需点名。</p></div></div>
      <div className="kv-form">
        <input value={key} onChange={e => setKey(e.target.value)} placeholder="键，如 communication_delay" />
        <input value={val} onChange={e => setVal(e.target.value)} placeholder="值，如 消息需要九年才能抵达" />
        <button className="btn btn-primary sm" onClick={() => { if (!key.trim()) return; mutate((_, p) => { p.worldview[key.trim()] = val; }); setKey(''); setVal(''); }}>添加</button>
      </div>
      <div className="kv-list">
        {entries.length === 0 && <div className="empty small">还没有规则。</div>}
        {entries.map(([k, v]) => (
          <div className="kv-row" key={k}>
            <code>{k}</code>
            <input className="kv-value" value={v} onChange={e => mutate((_, p) => { p.worldview[k] = e.target.value; })} placeholder="规则内容" />
            <button className="icon-btn danger" onClick={() => mutate((_, p) => { delete p.worldview[k]; })}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShotsView({ ep, project, projectId, mutate }) {
  const shots = ep?.shots || [];
  const [view, setView] = useState('table');

  function patchShot(i, patch) {
    mutate(e => { Object.assign(e.shots[i], patch); });
  }

  function refField(s, i, label = '参考', slot = 'refImage') {
    return <EntityAssetField
      label={label}
      project={project}
      generation={{
        purpose: 'storyboard', targetKind: 'shot', targetId: s.id, episodeId: ep.id, slot,
        ...(s.continuity && i > 0 ? { requirePrevFrame: true } : {}),
      }}
      binding={{ kind: 'shot', projectId, episodeId: ep.id, entityId: s.id, slot }}
      value={s[slot]}
      onChange={ref => patchShot(i, { [slot]: ref })}
    />;
  }

  function commitLayout(shotId, pos) {
    mutate((_, p) => {
      p.viewLayouts = p.viewLayouts || {};
      p.viewLayouts.storyboard = p.viewLayouts.storyboard || {};
      p.viewLayouts.storyboard[ep.id] = { ...(p.viewLayouts.storyboard[ep.id] || {}), [shotId]: pos };
    });
  }

  return (
    <div className="simple-view">
      <div className="view-head">
        <div><h2>分镜</h2><p className="muted">table / panel / canvas 三视图直接读写同一 ep.shots；画布只存坐标，不改变镜头顺序。</p></div>
        <div className="view-head-actions">
          <div className="loc-view-switch">
            <button className={view === 'panel' ? 'active' : ''} onClick={() => setView('panel')}>Panel</button>
            <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>Table</button>
            <button className={view === 'canvas' ? 'active' : ''} onClick={() => setView('canvas')}>Canvas</button>
          </div>
          <button className="btn btn-primary sm" onClick={() => mutate(e => e.shots.push({ id: `s_${Date.now()}`, scene: '', shotSize: '中景', camera: '固定', motion: '', duration: '3s', visual: '', audio: '', refImage: null, storyboardImage: null, continuity: false }))}><Plus size={14} /> 添加镜头</button>
        </div>
      </div>
      {shots.length === 0 ? <div className="empty small">还没有镜头。用 AI 的「分镜」模式从场景生成。</div> : view === 'table' ? (
        <div className="shot-table-wrap"><table className="shot-table">
          <thead><tr><th>#</th><th>参考图 / 前帧</th><th>续前帧</th><th>场景</th><th>景别</th><th>机位</th><th>运动</th><th>时长</th><th>画面</th><th>声音</th><th></th></tr></thead>
          <tbody>{shots.map((s, i) => <tr key={s.id}>
            <td>{i + 1}</td>
            <td>{refField(s, i)}{refField(s, i, '分镜图', 'storyboardImage')}</td>
            <td><input type="checkbox" checked={!!s.continuity} disabled={i === 0} title={i === 0 ? '第一镜没有前帧' : '开启后，生成分镜图前必须已有前一镜的分镜图，否则阻断且不扣费'} onChange={e => patchShot(i, { continuity: e.target.checked })} /></td>
            <td><input value={s.scene} onChange={e => patchShot(i, { scene: e.target.value })} /></td>
            <td><select value={s.shotSize} onChange={e => patchShot(i, { shotSize: e.target.value })}>{['大远景','远景','全景','中景','近景','特写','大特写'].map(x => <option key={x}>{x}</option>)}</select></td>
            <td><input value={s.camera} onChange={e => patchShot(i, { camera: e.target.value })} /></td>
            <td><input value={s.motion} onChange={e => patchShot(i, { motion: e.target.value })} /></td>
            <td><input value={s.duration} onChange={e => patchShot(i, { duration: e.target.value })} /></td>
            <td><textarea rows={2} value={s.visual} onChange={e => patchShot(i, { visual: e.target.value })} /></td>
            <td><textarea rows={2} value={s.audio} onChange={e => patchShot(i, { audio: e.target.value })} /></td>
            <td><button className="icon-btn danger" onClick={() => mutate(ep2 => ep2.shots.splice(i, 1))}><Trash2 size={13} /></button></td>
          </tr>)}</tbody>
        </table></div>
      ) : view === 'panel' ? (
        <div className="shot-panel-grid">
          {shots.map((s, i) => <div className="shot-panel-card" key={s.id}>
            <div className="shot-panel-head"><strong>SHOT {String(i + 1).padStart(2, '0')}</strong><span className="muted small">{s.duration || '—'}</span></div>
            {refField(s, i)}
            {refField(s, i, '分镜图', 'storyboardImage')}
            <label className="shot-continuity"><input type="checkbox" checked={!!s.continuity} disabled={i === 0} onChange={e => patchShot(i, { continuity: e.target.checked })} /> 续前帧（缺前帧则阻断，不扣费）</label>
            <label>场景<input value={s.scene || ''} onChange={e => patchShot(i, { scene: e.target.value })} /></label>
            <div className="form-two">
              <label>景别<select value={s.shotSize || '中景'} onChange={e => patchShot(i, { shotSize: e.target.value })}>{['大远景','远景','全景','中景','近景','特写','大特写'].map(x => <option key={x}>{x}</option>)}</select></label>
              <label>机位<input value={s.camera || ''} onChange={e => patchShot(i, { camera: e.target.value })} /></label>
            </div>
            <label>画面<textarea rows={3} value={s.visual || ''} onChange={e => patchShot(i, { visual: e.target.value })} /></label>
            <label>声音<textarea rows={2} value={s.audio || ''} onChange={e => patchShot(i, { audio: e.target.value })} /></label>
            <button className="icon-btn danger" onClick={() => mutate(ep2 => ep2.shots.splice(i, 1))}><Trash2 size={13} /></button>
          </div>)}
        </div>
      ) : (
        <CanvasBoard
          items={shots.map((s, i) => ({ id: s.id, title: `SHOT ${i + 1}`, text: s.visual || s.scene || '未填写' }))}
          layout={project.viewLayouts?.storyboard?.[ep.id] || {}}
          onCommit={commitLayout}
          empty="暂无镜头"
          renderItem={item => (
            <>
              <div className="loc-node-head"><span className="loc-node-title">{item.title}</span></div>
              <div className="loc-node-sub"><span>{item.text.slice(0, 44)}</span></div>
            </>
          )}
        />
      )}
    </div>
  );
}
