import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Trash2, Sparkles, Send, Loader2, Film, Check, Clapperboard, Wand2, Copy, RotateCcw, History, SlidersHorizontal } from 'lucide-react';
import { api, resolveAssetUrl } from '../api.js';
import { videoRate, clampSeconds, MAX_VIDEO_SECONDS, RESOLUTIONS } from '../pricing.js';
import VersionHistory from '../components/VersionHistory.jsx';
import ProjectSettingsDialog from '../components/ProjectSettingsDialog.jsx';

// 与 server/models.js 的 MAX_VIDEO_SECONDS 保持一致：单条最长 30 秒。
const MAX_REEL_SECONDS = 30;
const DEFAULT_REEL_SECONDS = 30;

const STAGES = [
  { id: 'scene', label: '场景', desc: '环境与参考' },
  { id: 'performance', label: '表演', desc: '可拍摄的动作' },
  { id: 'storyboard', label: '文字分镜', desc: '镜头记录' },
  { id: 'image', label: '分镜图', desc: '视觉锚点' },
  { id: 'clip', label: '成片', desc: '≤30 秒' },
];

const CLIP_MODEL = 'wan3.0-video';
const CLIP_POLL_INTERVAL = 2000;
const CLIP_MAX_POLLS = 90;
const CLIP_MAX_NET_RETRIES = 20;

// 由 Reel 的场景、表演、镜头与世界观的负面提示组装视频生成 prompt。
function buildClipPrompt(project, reel) {
  const w = project?.worldview || {};
  const lines = [];
  const style = [w['视觉风格'], w['画幅'], w['情绪基调'], w['主场景']].filter(Boolean).join('，');
  if (style) lines.push(style);
  if (reel?.scene) lines.push(reel.scene.split('\n').map(s => s.trim()).filter(Boolean).join(' '));
  if (reel?.performance) lines.push(reel.performance.split('\n').map(s => s.trim()).filter(Boolean).join(' '));
  (reel?.shots || []).forEach(s => {
    if (!s.visual) return;
    const head = [s.time, s.size, s.camera, s.motion].filter(Boolean).join('，');
    const audio = s.audio ? `声音：${s.audio}` : '';
    lines.push([head, s.visual, audio].filter(Boolean).join('；'));
  });
  return lines.join('\n').trim();
}

function clipNegativePrompt(project) {
  return String(project?.worldview?.['全局负面提示'] || '').trim();
}

function isNetworkError(e) {
  const msg = String(e?.message || '').toLowerCase();
  return e?.name === 'TypeError' || /failed to fetch|network|load failed|econn/i.test(msg);
}

export default function Cinema() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [reelIdx, setReelIdx] = useState(0);
  const [stage, setStage] = useState('scene');
  const [reelView, setReelView] = useState('board'); // board | timeline | list（对齐 laper 的 Reels 三视图）
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [clipRes, setClipRes] = useState('480P');
  const [clipTask, setClipTask] = useState(null); // { taskId, status, url, error, connError, reelId }
  const [copied, setCopied] = useState('');
  const [saved, setSaved] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveConflict, setSaveConflict] = useState('');
  const clipTimers = useRef({});
  const clipInflight = useRef(new Set());
  const projectRef = useRef(null);
  const saveTimer = useRef(null);
  const saveEpoch = useRef(0);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);

  useEffect(() => {
    let alive = true;
    saveEpoch.current += 1;
    const epoch = saveEpoch.current;
    clearTimeout(saveTimer.current);
    conflictRef.current = false;
    dirtyRef.current = false;
    setProject(null);
    setSaved(false);
    setSaveConflict('');
    api.projects.get(id).then(p => {
      if (alive && epoch === saveEpoch.current) { projectRef.current = p; setProject(p); }
    }).catch(e => { if (alive && epoch === saveEpoch.current) setError(e.message); });
    return () => { alive = false; };
  }, [id]);
  useEffect(() => { api.settings.get().then(setCfg).catch(() => {}); }, []);
  useEffect(() => () => {
    saveEpoch.current += 1;
    clearTimeout(saveTimer.current);
    Object.values(clipTimers.current).forEach(clearTimeout);
  }, []);
  const ep = project?.episodes?.[0];
  const reels = ep?.reels || [];
  const reel = reels[reelIdx];

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
        const savedProject = await api.projects.save(cur.id, payload, cur.revision);
        if (epoch !== saveEpoch.current || projectRef.current?.id !== cur.id) return;
        projectRef.current = { ...projectRef.current, revision: savedProject.revision, versionHash: savedProject.versionHash };
        setProject(prev => prev && prev.id === cur.id
          ? { ...prev, revision: savedProject.revision, versionHash: savedProject.versionHash }
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
    setReelIdx(0);
    setStage('scene');
    projectRef.current = project;
    setProject(project);
    setSaved(true);
    setSaveConflict('');
    setError('');
    setVersionOpen(false);
  }

  function mutate(fn) {
    const prev = projectRef.current;
    if (!prev) return;
    const next = structuredClone(prev);
    fn(next.episodes[0]);
    next.updatedAt = new Date().toISOString();
    projectRef.current = next;
    setProject(next);
    scheduleSave();
  }

  function addReel() {
    mutate(e => e.reels.push({
      id: `r_${Date.now()}`, title: `Reel ${e.reels.length + 1}`,
      scene: '', refs: [], performance: '', shots: [], storyboardImage: null, clip: '',
      duration: DEFAULT_REEL_SECONDS, continuity: 'natural', versions: [],
    }));
    setReelIdx(reels.length);
  }

  function removeReel(i) {
    if (!confirm('删除这个 Reel？其中的分镜与成片版本会一并移除。')) return;
    mutate(e => { e.reels.splice(i, 1); });
    setReelIdx(idx => Math.max(0, Math.min(idx, reels.length - 2)));
  }

  function updateReel(patch) { mutate(e => Object.assign(e.reels[reelIdx], patch)); }

  function patchClipTask(patch) { setClipTask(t => t ? { ...t, ...patch } : t); }

  function scheduleClipPoll(taskId, delay = CLIP_POLL_INTERVAL, tries = 0, netFails = 0) {
    if (clipTimers.current[taskId] || clipInflight.current.has(taskId)) return;
    clipTimers.current[taskId] = setTimeout(() => {
      delete clipTimers.current[taskId];
      clipInflight.current.add(taskId);
      pollClip(taskId, tries, netFails);
    }, Math.max(0, delay));
  }

  function pollClip(taskId, tries = 0, netFails = 0) {
    api.media.task(taskId)
      .then(t => {
        clipInflight.current.delete(taskId);
        if (t.status === 'pending') {
          patchClipTask({ status: 'pending', connError: '' });
          if (tries + 1 >= CLIP_MAX_POLLS) {
            patchClipTask({ status: 'failed', error: '生成超时，请点「重新查询」续查。' });
            return;
          }
          scheduleClipPoll(taskId, CLIP_POLL_INTERVAL, tries + 1, 0);
          return;
        }
        if (t.status === 'succeeded') {
          patchClipTask({ status: 'succeeded', url: t.url, connError: '', error: '' });
          // 生成版本并回填到当前 Reel（按 task 记录的 reelId 定位，避免切换 Reel 后写错）。
          setClipTask(cur => {
            const targetReelId = cur?.reelId;
            mutate(e => {
              const r = (e.reels || []).find(x => x.id === targetReelId);
              if (!r) return;
              const exists = (r.versions || []).some(v => v.taskId === taskId && v.url === t.url);
              if (!exists) {
                const version = {
                  id: `cv_${Date.now()}`,
                  url: t.url,
                  model: cur?.model || CLIP_MODEL,
                  resolution: cur?.resolution || clipRes,
                  seconds: cur?.seconds,
                  createdAt: new Date().toISOString(),
                  taskId,
                };
                r.versions = [version, ...(r.versions || [])];
              }
              r.clip = t.url; // 最新生成自动设为当前成片
            });
            return cur;
          });
          return;
        }
        patchClipTask({ status: 'failed', error: t.error || '生成失败', connError: '' });
      })
      .catch(e => {
        clipInflight.current.delete(taskId);
        if (isNetworkError(e) && netFails < CLIP_MAX_NET_RETRIES) {
          patchClipTask({ status: 'pending', connError: `连接中断，正在重试（${netFails + 1}/${CLIP_MAX_NET_RETRIES}）…` });
          scheduleClipPoll(taskId, Math.min(10000, CLIP_POLL_INTERVAL * (netFails + 1)), tries, netFails + 1);
        } else {
          patchClipTask({ status: 'failed', error: e.message || '查询失败', connError: '' });
        }
      });
  }

  async function generateClip() {
    if (!reel || clipTask?.status === 'pending') return;
    setError('');
    const prompt = buildClipPrompt(project, reel);
    if (!prompt) { setError('请先在场景 / 表演 / 文字分镜阶段填入内容，再生成成片。'); return; }
    const seconds = clampSeconds(reel.duration, 30);
    try {
      const r = await api.media.generateVideo({
        prompt,
        negativePrompt: clipNegativePrompt(project),
        duration: seconds,
        resolution: clipRes,
        model: CLIP_MODEL,
        projectId: project.id,
        reelId: reel.id, // 后端据此把任务标记为 reel 绑定，区别于自由生成
        binding: { kind: 'project', projectId: project.id, entityId: project.id, episodeId: project.episodes?.[0]?.id || '', slot: 'asset', side: `reel:${reel.id}` },
      });
      const task = {
        taskId: r.taskId, status: r.status || 'pending', reelId: reel.id,
        model: r.model || CLIP_MODEL, resolution: clipRes, seconds,
      };
      setClipTask(task);
      scheduleClipPoll(r.taskId, 0);
    } catch (e) { setError(e.message); }
  }

  function selectVersion(v) { updateReel({ clip: v.url }); }

  function removeVersion(id) {
    const remaining = (reel.versions || []).filter(v => v.id !== id);
    const removed = (reel.versions || []).find(v => v.id === id);
    const patch = { versions: remaining };
    if (reel.clip === removed?.url) patch.clip = remaining[0]?.url || '';
    updateReel(patch);
  }

  async function copyClipUrl(url) {
    try { await navigator.clipboard.writeText(url); } catch { /* 非 HTTPS 静默 */ }
    setCopied(url);
    setTimeout(() => setCopied(c => (c === url ? '' : c)), 1500);
  }

  async function ask() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setReply('');
    try {
      const text = await api.ai.complete({
        prompt: prompt.trim(),
        scope: 'cinema-reel',
        mode: stage === 'storyboard' ? 'storyboard' : 'chat',
        context: { stage, reel, film: project.film, characters: project.characters },
      });
      setReply(text.text || '');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (error && !project) return <main className="container page"><div className="alert error">{error}</div></main>;
  if (!project) return <main className="container page"><div className="loading"><Loader2 className="spin" /> 加载中…</div></main>;

  return (
    <div className="workspace">
      <div className="ws-top">
        <Link to="/projects" className="back-link">← 项目</Link>
        <div className="ws-title"><strong>{project.name}</strong><span className="badge cinema">CINEMA</span></div>
        <div className="ws-actions">
          <span className={`save-state ${saved ? 'ok' : ''}`}>{saved ? <><Check size={13} /> 已保存</> : '编辑中…'}</span>
          {saveConflict && <span className="muted small" title={saveConflict}>保存冲突，请刷新</span>}
          <button className="btn btn-ghost sm" title="项目设置" onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={14} /> 设置</button>
          <button className="btn btn-ghost sm" title="版本历史与恢复" onClick={() => setVersionOpen(true)}><History size={14} /> 版本</button>
          <span className="muted small">{project.film?.orientation === 'portrait' ? '竖屏' : '横屏'} · {reel?.duration || DEFAULT_REEL_SECONDS} 秒/Reel（≤{MAX_REEL_SECONDS}）</span>
        </div>
      </div>
      <div className="ws-body">
        <div className="ws-main">
          <div className="cinema-bar">
            <div className="reel-view-switch">
              {[['board', 'Board'], ['timeline', 'Timeline'], ['list', 'List']].map(([v, label]) => (
                <button key={v} className={reelView === v ? 'active' : ''} onClick={() => setReelView(v)}>{label}</button>
              ))}
            </div>
            <div className="reel-tabs">
              {reels.map((r, i) => <button key={r.id} className={i === reelIdx ? 'active' : ''} onClick={() => { setReelIdx(i); setReelView('board'); }}>{r.title}</button>)}
              <button className="ep-add" onClick={addReel}><Plus size={14} /></button>
            </div>
          </div>
          {reelView === 'list' ? (
            <div className="ws-content cinema-content">
              <div className="reel-list-view">
                {reels.length === 0 ? <div className="empty small">还没有 Reel，点上方 + 新建。</div> : <table className="reel-list-table">
                  <thead><tr><th>#</th><th>标题</th><th>场景</th><th>镜头</th><th>时长</th><th>连续</th><th>成片</th><th></th></tr></thead>
                  <tbody>{reels.map((r, i) => <tr key={r.id} className={i === reelIdx ? 'active' : ''} onClick={() => { setReelIdx(i); setReelView('board'); }}>
                    <td>{i + 1}</td>
                    <td>{r.title}</td>
                    <td className="reel-list-scene">{r.scene?.slice(0, 60) || <span className="muted">—</span>}</td>
                    <td>{r.shots?.length || 0}</td>
                    <td>{r.duration || DEFAULT_REEL_SECONDS}s</td>
                    <td>{r.continuity === 'last-frame' ? '末帧接续' : '自然'}</td>
                    <td>{r.clip ? <Check size={14} className="stage-done" /> : <span className="muted">—</span>}</td>
                    <td><button className="icon-btn danger" onClick={e => { e.stopPropagation(); removeReel(i); }}><Trash2 size={13} /></button></td>
                  </tr>)}</tbody>
                </table>}
              </div>
            </div>
          ) : reelView === 'timeline' ? (
            <div className="ws-content cinema-content">
              <div className="reel-timeline-view">
                <p className="muted small">按当前 Reel 顺序横向排列；点任一段进入编辑。总时长为各段之和（每段 ≤ {MAX_REEL_SECONDS} 秒）。</p>
                <div className="reel-timeline-track">
                  {reels.map((r, i) => <button key={r.id} className={`reel-timeline-seg ${i === reelIdx ? 'active' : ''}`} style={{ flexGrow: r.duration || DEFAULT_REEL_SECONDS }} onClick={() => { setReelIdx(i); setReelView('board'); }} title={r.title}>
                    <span className="seg-no">{i + 1}</span>
                    <span className="seg-title">{r.title}</span>
                    <span className="seg-dur">{r.duration || DEFAULT_REEL_SECONDS}s</span>
                  </button>)}
                </div>
                <div className="reel-timeline-total">合计 {reels.reduce((s, r) => s + (Number(r.duration) || DEFAULT_REEL_SECONDS), 0)} 秒 · {reels.length} 段</div>
              </div>
            </div>
          ) : (
          <>
          <div className="stage-nav">
            {STAGES.map((s, i) => (
              <button key={s.id} className={stage === s.id ? 'active' : ''} onClick={() => setStage(s.id)}>
                <span className="stage-num">{String(i + 1).padStart(2, '0')}</span>
                <span><strong>{s.label}</strong><small>{s.desc}</small></span>
                {reel && (s.id === 'scene' ? reel.scene : s.id === 'performance' ? reel.performance : s.id === 'storyboard' ? reel.shots?.length : s.id === 'image' ? reel.storyboardImage : reel.clip) ? <Check size={14} className="stage-done" /> : null}
              </button>
            ))}
          </div>
          <div className="ws-content cinema-content">
            {!reel ? <div className="empty"><Clapperboard size={30} /><h3>还没有 Reel</h3><p>一个 Reel 是一段最长 30 秒的视觉制作单元。点上面的 + 新建。</p></div> : (
              <>
                {stage === 'scene' && (
                  <div className="simple-view">
                    <div className="view-head"><div><h2>场景设计</h2><p className="muted">写环境。可拍摄的细节：时间、光线、天气、材质、声音。</p></div></div>
                    <input className="title-input" value={reel.title} onChange={e => updateReel({ title: e.target.value })} placeholder="Reel 标题" />
                    <div className="reel-duration-row">
                      <span>单条时长（秒，最长 {MAX_REEL_SECONDS}）</span>
                      <input type="number" min="1" max={MAX_REEL_SECONDS} value={reel.duration || DEFAULT_REEL_SECONDS}
                        onChange={e => updateReel({ duration: Math.max(1, Math.min(MAX_REEL_SECONDS, Number(e.target.value) || DEFAULT_REEL_SECONDS)) })} />
                    </div>
                    <textarea className="big-area" rows={8} value={reel.scene} onChange={e => updateReel({ scene: e.target.value })} placeholder="INT. 旧书店 - 雨夜&#10;&#10;窄过道。暖黄台灯照在摊开的书上。窗外雨声持续。" />
                    <div className="field-label">参考图 URL（每行一个）</div>
                    <textarea rows={3} value={(reel.refs || []).join('\n')} onChange={e => updateReel({ refs: e.target.value.split('\n').filter(Boolean) })} placeholder="https://..." />
                  </div>
                )}
                {stage === 'performance' && (
                  <div className="simple-view">
                    <div className="view-head"><div><h2>表演</h2><p className="muted">用 @ 引用角色，# 引用道具，引号写对白。只写这 {reel.duration || DEFAULT_REEL_SECONDS} 秒里发生的事。</p></div></div>
                    <textarea className="big-area" rows={10} value={reel.performance} onChange={e => updateReel({ performance: e.target.value })} placeholder={'@林夏 推开门，雨水从伞尖滴落。她看见 #未寄出的信 摊在桌上。\n\n“你总是来得比我准备道歉的时间更早。”'} />
                  </div>
                )}
                {stage === 'storyboard' && (
                  <div className="simple-view">
                    <div className="view-head"><div><h2>文字分镜</h2><p className="muted">把表演拆成时间上明确的镜头。每个镜头一个视觉任务。</p></div>
                      <button className="btn btn-primary sm" onClick={() => updateReel({ shots: [...(reel.shots || []), { id: `sh_${Date.now()}`, time: '0-3s', size: '中景', camera: '固定', motion: '推', visual: '', audio: '' }] })}><Plus size={14} /> 加镜头</button>
                    </div>
                    {(reel.shots || []).map((s, i) => (
                      <div className="cinema-shot" key={s.id}>
                        <div className="shot-idx">{String(i + 1).padStart(2, '0')}</div>
                        <div className="shot-fields">
                          <input value={s.time} onChange={e => { const arr = [...reel.shots]; arr[i].time = e.target.value; updateReel({ shots: arr }); }} placeholder="0-3s" />
                          <select value={s.size} onChange={e => { const arr = [...reel.shots]; arr[i].size = e.target.value; updateReel({ shots: arr }); }}>{['大远景','远景','全景','中景','近景','特写','大特写'].map(x => <option key={x}>{x}</option>)}</select>
                          <input value={s.camera} onChange={e => { const arr = [...reel.shots]; arr[i].camera = e.target.value; updateReel({ shots: arr }); }} placeholder="机位" />
                          <input value={s.motion} onChange={e => { const arr = [...reel.shots]; arr[i].motion = e.target.value; updateReel({ shots: arr }); }} placeholder="运动" />
                          <textarea rows={2} value={s.visual} onChange={e => { const arr = [...reel.shots]; arr[i].visual = e.target.value; updateReel({ shots: arr }); }} placeholder="画面描述" />
                          <input value={s.audio} onChange={e => { const arr = [...reel.shots]; arr[i].audio = e.target.value; updateReel({ shots: arr }); }} placeholder="对白 / 音效" />
                        </div>
                        <button className="icon-btn danger" onClick={() => updateReel({ shots: reel.shots.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {stage === 'image' && (
                  <div className="simple-view">
                    <div className="view-head"><div><h2>分镜图</h2><p className="muted">视觉锚点应来自镜头序列、场景与参考图，而不是凭空想象。</p></div></div>
                    <div className="task-placeholder">
                      <Film size={26} />
                      <h3>分镜图 URL（外部生成）</h3>
                      <p>把外部工具生成的分镜图 URL 填在这里，作为本 Reel 的视觉锚点。后续镜头接续会读取它作为前帧参考。</p>
                      <input value={reel.storyboardImage || ''} onChange={e => updateReel({ storyboardImage: e.target.value })} placeholder="图片 URL" />
                      {reel.storyboardImage && <img src={reel.storyboardImage} alt="分镜锚点" className="storyboard-preview" />}
                    </div>
                  </div>
                )}
                {stage === 'clip' && (
                  <div className="simple-view">
                    <div className="view-head"><div><h2>成片</h2><p className="muted">本 Reel {reel.duration || DEFAULT_REEL_SECONDS} 秒（最长 {MAX_REEL_SECONDS} 秒）。连续模式：{reel.continuity === 'last-frame' ? '末帧接续' : '自然过渡'}</p></div></div>
                    <select value={reel.continuity} onChange={e => updateReel({ continuity: e.target.value })}>
                      <option value="last-frame">末帧接续上一 Reel</option>
                      <option value="natural">自然过渡（独立生成）</option>
                    </select>

                    <div className="clip-gen">
                      <div className="clip-gen-title"><Wand2 size={16} /> 生成成片</div>
                      <p className="muted small">从本 Reel 的场景、表演与 {reel.shots?.length || 0} 个镜头自动组装 prompt，用 {CLIP_MODEL} 生成一条 {reel.duration || DEFAULT_REEL_SECONDS} 秒视频。每次生成一个新版本，可对比后选用。</p>
                      <details className="clip-prompt">
                        <summary>查看将发送的 Prompt（点击展开）</summary>
                        <pre>{buildClipPrompt(project, reel) || '（尚无内容，请先在前面阶段填写）'}</pre>
                        {clipNegativePrompt(project) && <div className="muted small">负面提示：{clipNegativePrompt(project)}</div>}
                      </details>
                      <div className="clip-gen-row">
                        <label>分辨率
                          <select value={clipRes} onChange={e => setClipRes(e.target.value)}>
                            {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </label>
                        <div className="cost-estimate muted small">
                          估算费用 ¥{((clampSeconds(reel.duration, 30)) * videoRate(cfg, clipRes)).toFixed(3)}
                          <span className="ml-8">{clipRes} · ¥{videoRate(cfg, clipRes).toFixed(3)}/秒（含限时折扣）</span>
                        </div>
                        <button className="btn btn-primary sm" onClick={generateClip} disabled={clipTask?.status === 'pending'}>
                          {clipTask?.status === 'pending' ? <><Loader2 className="spin" size={14} /> 生成中</> : <><Wand2 size={14} /> 生成成片</>}
                        </button>
                      </div>
                      {clipTask?.reelId === reel.id && (
                        <div className={`clip-task ${clipTask.status}`}>
                          <span className="tag mini">{clipTask.status === 'pending' ? '生成中' : clipTask.status === 'succeeded' ? '已完成' : '失败'}</span>
                          <span className="muted small">{clipTask.connError || clipTask.error || (clipTask.status === 'pending' ? '任务已提交，正在等待百炼返回…' : '')}</span>
                          {clipTask.status === 'failed' && (
                            <button className="btn btn-ghost sm" onClick={() => { patchClipTask({ status: 'pending', error: '', connError: '' }); scheduleClipPoll(clipTask.taskId, 0); }}><RotateCcw size={13} /> 重新查询</button>
                          )}
                        </div>
                      )}
                    </div>

                    {(reel.versions || []).length > 0 && (
                      <div className="clip-versions">
                        <div className="view-head"><div><h3>生成版本</h3><p className="muted small">点击「设为成片」选用；最新版本生成后默认自动选用。</p></div></div>
                        {reel.versions.map((v, i) => (
                          <div className={`clip-version ${reel.clip === v.url ? 'active' : ''}`} key={v.id}>
                            <video src={resolveAssetUrl(v.url)} controls playsInline />
                            <div className="clip-version-meta">
                              <span className="tag mini">V{reel.versions.length - i}</span>
                              {reel.clip === v.url && <span className="tag mini active-tag">当前成片</span>}
                              <span className="muted small">{v.resolution} · {v.seconds}s · {v.model}</span>
                              <span className="muted small">{v.createdAt ? new Date(v.createdAt).toLocaleString('zh-CN') : ''}</span>
                            </div>
                            <div className="clip-version-actions">
                              <button className="btn btn-ghost sm" onClick={() => selectVersion(v)} disabled={reel.clip === v.url}><Check size={13} /> 设为成片</button>
                              <button className="btn btn-ghost sm" onClick={() => copyClipUrl(v.url)}><Copy size={13} /> {copied === v.url ? '已复制' : '复制 URL'}</button>
                              <button className="icon-btn danger" title="删除版本" onClick={() => removeVersion(v.id)}><Trash2 size={14} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <details className="clip-manual">
                      <summary>或手动填入外部视频 URL / 路径</summary>
                      <input value={reel.clip || ''} onChange={e => updateReel({ clip: e.target.value })} placeholder="视频 URL / 路径" />
                      {reel.clip && <video src={resolveAssetUrl(reel.clip)} controls className="storyboard-preview" />}
                    </details>
                  </div>
                )}
              </>
            )}
          </div>
          </>
          )}
        </div>
        <aside className="ai-panel">
          <div className="ai-head"><div><Sparkles size={16} /> <strong>Reel 助手</strong></div></div>
          <div className="ai-config"><span className="muted small">当前阶段：{STAGES.find(s => s.id === stage)?.label}</span></div>
          <div className="chat-list">
            {reply ? <div className="chat-msg assistant"><div className="chat-label">助手</div><div className="chat-text">{reply}</div></div>
              : <div className="chat-hint"><Sparkles size={22} /><p>针对当前阶段提问。</p>
                <div className="suggestions">
                  {['把场景写得更可拍摄', '给这个表演设计 5 个镜头', '检查连续性风险'].map(s => <button key={s} onClick={() => setPrompt(s)}>{s}</button>)}
                </div></div>}
          </div>
          <div className="chat-input">
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="告诉助手这一阶段要做什么…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
            <button className="btn btn-primary full" onClick={ask} disabled={busy || !prompt.trim()}>{busy ? <><Loader2 className="spin" size={14} /> 生成中</> : <><Send size={14} /> 发送</>}</button>
          </div>
        </aside>
      </div>
      {settingsOpen && <ProjectSettingsDialog project={project} onClose={() => setSettingsOpen(false)} onSaved={onSettingsSaved} />}
      {versionOpen && <VersionHistory
        projectId={project.id}
        baseRevision={project.revision}
        onClose={() => setVersionOpen(false)}
        onRestored={onRestored}
      />}
    </div>
  );
}
