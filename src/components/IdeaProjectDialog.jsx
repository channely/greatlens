import React, { useEffect, useMemo, useState } from 'react';
import { X, Check, Loader2, ArrowRight, ArrowLeft, Paperclip } from 'lucide-react';
import { api } from '../api.js';

const STAGE_LABEL = {
  brief: '创意 brief', title: '标题与 logline', outline: '大纲', beats: '节拍',
  characters: '核心角色', locations: '地点', opening: '开场场景', review: '最终复核',
};

const ORDER = Object.keys(STAGE_LABEL);
const newId = () => (globalThis.crypto?.randomUUID?.() || `idea_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

function payloadLines(stage, payload) {
  if (!payload) return [];
  if (stage === 'title') return [...(payload.options || []), String(payload.logline || '')];
  if (stage === 'outline') return payload.acts || [];
  if (stage === 'beats') return payload.beats || [];
  if (stage === 'characters') return (payload.characters || []).map(c => c.name);
  if (stage === 'locations') return (payload.locations || []).map(l => l.name);
  if (stage === 'opening') return (payload.nodes || []).map(n => n.text);
  return [];
}

export default function IdeaProjectDialog({ onClose, onCreated, seedText = '' }) {
  const [stage, setStage] = useState('brief');
  const [clientDraftId] = useState(newId);
  const seed = String(seedText || '').trim();
  const [draft, setDraft] = useState({
    brief: {
      protagonist: '', desire: '', opposition: '', length: '短片', tone: '',
      // 首页带入的描述作为「主题约束 / 要追问的问题」预填，参与后续标题/大纲/节拍/开场提案。
      theme: seed,
    },
    attachments: [],
  });
  const [payload, setPayload] = useState(null);
  const [lines, setLines] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [briefSource, setBriefSource] = useState('');

  const idx = ORDER.indexOf(stage);
  const progress = useMemo(() => `${idx + 1} / ${ORDER.length}`, [idx]);

  async function load(nextStage) {
    setBusy(true);
    setError('');
    try {
      const r = await api.ai.idea({ stage: nextStage, draft, clientDraftId });
      setPayload(r.payload);
      setLines(payloadLines(nextStage, r.payload).join('\n'));
    } catch (e) { setError(e.message || '生成提案失败'); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (stage !== 'brief') load(stage); /* eslint-disable-next-line */ }, [stage]);

  // 首页 seed 进入后，先由 AI 专业分析自动填充 brief 六字段；用户随时可改。
  // 失败不阻塞：后端会本地兜底，前端也不因分析失败而阻止继续。
  async function autoFillBrief() {
    if (!seed || analyzing) return;
    setAnalyzing(true);
    setError('');
    try {
      const r = await api.ai.analyzeBrief(seed, draft.brief);
      setDraft(d => {
        const next = { ...d.brief };
        for (const [k, v] of Object.entries(r.brief || {})) {
          // 不覆盖用户已手动填写的字段；theme 保留 seed 原文。
          if (!String(next[k] || '').trim()) next[k] = v;
        }
        return { ...d, brief: next };
      });
      setBriefSource(r.source === 'ai' ? 'ai' : 'local');
    } catch (e) {
      setBriefSource('failed');
    } finally { setAnalyzing(false); }
  }

  useEffect(() => {
    if (seed && stage === 'brief') autoFillBrief();
    /* eslint-disable-next-line */
  }, []);

  function setBrief(key, value) {
    setDraft(d => ({ ...d, brief: { ...d.brief, [key]: value } }));
  }

  function commitCurrent() {
    const arr = lines.split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (stage === 'brief') {
      const b = draft.brief;
      const missing = ['protagonist', 'desire', 'opposition', 'length', 'tone', 'theme'].filter(k => !String(b[k] || '').trim());
      if (missing.length) { setError('请把主角、欲望、反对力量、片长/形式、调性、主题约束填完整。'); return false; }
      setDraft(d => ({ ...d, title: d.title || arr[0] || `${b.protagonist}的选择` }));
      return true;
    }
    if (stage === 'title') {
      if (!arr.length) { setError('至少保留一个标题。'); return false; }
      setDraft(d => ({
        ...d,
        title: arr[0],
        logline: arr[arr.length - 1] || d.logline,
        titleOptions: arr.slice(0, -1),
      }));
      return true;
    }
    if (stage === 'outline') { setDraft(d => ({ ...d, outline: { acts: arr } })); return true; }
    if (stage === 'beats') { setDraft(d => ({ ...d, beats: { beats: arr } })); return true; }
    if (stage === 'characters') {
      setDraft(d => ({ ...d, characters: { characters: arr.map(name => ({ id: newId(), name, bio: '' })) } }));
      return true;
    }
    if (stage === 'locations') {
      setDraft(d => ({ ...d, locations: { locations: arr.map(name => ({ id: newId(), name, notes: '' })) } }));
      return true;
    }
    if (stage === 'opening') {
      setDraft(d => ({ ...d, opening: { nodes: arr.map(text => ({ type: /^(INT|EXT|INT\/EXT|内|外)[\.．\s]/i.test(text) ? 'scene' : 'action', text })) } }));
      return true;
    }
    return true;
  }

  async function next() {
    if (!commitCurrent()) return;
    const nextStage = ORDER[idx + 1];
    if (nextStage) setStage(nextStage);
    else await create();
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      const result = await api.projects.fromIdea({ clientDraftId, draft, type: 'script' });
      onCreated?.(result.project, result.created);
    } catch (e) { setError(e.message || '创建项目失败'); }
    finally { setBusy(false); }
  }

  async function attachFile(file) {
    if (!file) return;
    setError('');
    try {
      if (/^image\//.test(file.type)) {
        if (file.size > 4 * 1024 * 1024) throw new Error('图片参考请控制在 4MB 以内');
        const dataBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
          reader.onerror = () => reject(new Error('读取图片失败'));
          reader.readAsDataURL(file);
        });
        setDraft(d => ({ ...d, attachments: [...d.attachments, { name: file.name, kind: 'image', mime: file.type, dataBase64 }] }));
      } else {
        const dataBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
          reader.onerror = () => reject(new Error('读取文件失败'));
          reader.readAsDataURL(file);
        });
        const parsed = await api.import.attachment({ name: file.name, mime: file.type, dataBase64 });
        setDraft(d => ({ ...d, attachments: [...d.attachments, { name: file.name, kind: parsed.kind || '文稿', text: parsed.text || '' }] }));
      }
    } catch (e) { setError(e.message || '附件读取失败'); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal idea-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>从创意开始 · {STAGE_LABEL[stage]} <span className="muted small">{progress}</span></h3><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="idea-body">
          {error && <div className="alert error sm">{error}</div>}
          {stage === 'brief' && <>
            {seed && <div className="callout ok">
              已带入你在首页写下的描述。<strong>{analyzing ? 'AI 正在分析并填充…' : briefSource === 'ai' ? 'AI 已完成专业分析并填充了下方字段。' : briefSource === 'local' ? '已根据你的描述智能整理出初始字段。' : briefSource === 'failed' ? '已保留原始描述，请手动补充字段。' : ''}</strong>
              所有字段都可以直接修改，再继续下一步。
              <button className="chip-link" disabled={analyzing} onClick={autoFillBrief} style={{ marginLeft: 8 }}>
                {analyzing ? '分析中…' : '重新分析填充'}
              </button>
            </div>}
            <p className="muted small">先确认四要素与调性，后续标题、大纲、节拍与开场都会围绕它展开；每一步都可以改。</p>
            {[
              ['protagonist', '主角是谁'], ['desire', '主角想要什么'], ['opposition', '反对力量 / 阻力'],
              ['length', '片长与形式'], ['tone', '调性（可逗号分隔）'], ['theme', '主题约束 / 要追问的问题'],
            ].map(([key, label]) => (
              <label key={key}>{label}
                <input value={draft.brief[key] || ''} onChange={e => setBrief(key, e.target.value)} />
              </label>
            ))}
            <label className="idea-attach"><Paperclip size={14} /> 参考资料（DOCX / PDF / TXT / Markdown / 图片，可选）
              <input type="file" accept=".docx,.pdf,.txt,.md,.markdown,image/*" onChange={e => { attachFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <p className="muted small">资料只作为本次创意对话的上下文证据，不会逐字复制进剧本；正文在写作时可按需引用。</p>
            {draft.attachments.length > 0 && <div className="muted small">已附：{draft.attachments.map(a => a.name).join('、')}</div>}
          </>}
          {stage !== 'brief' && stage !== 'review' && <>
            <p className="muted small">{stage === 'title' ? '第一行作为标题，其余为备选；logline 会自动写入封面。' : '每行一项，可直接修改后再进入下一步。'}</p>
            <textarea className="idea-lines" rows={12} value={lines} onChange={e => setLines(e.target.value)} disabled={busy} />
          </>}
          {stage === 'review' && <>
            <p className="muted small">确认后一次性建项并保存「AI 创意初始版本」；随后可逐视图复核。</p>
            {(payload?.checklist || []).map(item => <div className="review-row" key={item.key}>
              <span className={item.done ? 'tag mini active-tag' : 'tag mini'}>{item.done ? '已生成' : '待补充'}</span>
              <span>{item.label}</span>
            </div>)}
          </>}
          {busy && <div className="loading"><Loader2 className="spin" size={15} /> 生成提案中…</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" disabled={idx === 0 || busy} onClick={() => setStage(ORDER[idx - 1])}><ArrowLeft size={14} /> 上一步</button>
          <button className="btn btn-primary" disabled={busy} onClick={next}>
            {stage === 'review' ? <><Check size={14} /> 创建项目</> : <><ArrowRight size={14} /> 下一步</>}
          </button>
        </div>
      </div>
    </div>
  );
}
