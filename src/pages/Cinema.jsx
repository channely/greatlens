import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Plus, Trash2, Sparkles, Send, Loader2, Film, Check, Clapperboard } from 'lucide-react';
import { api } from '../api.js';

const STAGES = [
  { id: 'scene', label: '场景', desc: '环境与参考' },
  { id: 'performance', label: '表演', desc: '可拍摄的动作' },
  { id: 'storyboard', label: '文字分镜', desc: '镜头记录' },
  { id: 'image', label: '分镜图', desc: '视觉锚点' },
  { id: 'clip', label: '成片', desc: '15 秒' },
];

export default function Cinema() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [reelIdx, setReelIdx] = useState(0);
  const [stage, setStage] = useState('scene');
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.projects.get(id).then(setProject).catch(e => setError(e.message)); }, [id]);
  const ep = project?.episodes?.[0];
  const reels = ep?.reels || [];
  const reel = reels[reelIdx];

  function mutate(fn) {
    setProject(prev => {
      const next = structuredClone(prev);
      fn(next.episodes[0]);
      next.updatedAt = new Date().toISOString();
      return next;
    });
    clearTimeout(window.__glSave);
    window.__glSave = setTimeout(() => setProject(cur => { if (cur) api.projects.save(cur.id, cur); return cur; }), 700);
  }

  function addReel() {
    mutate(e => e.reels.push({
      id: `r_${Date.now()}`, title: `Reel ${e.reels.length + 1}`,
      scene: '', refs: [], performance: '', shots: [], storyboardImage: '', clip: '',
      duration: 15, continuity: 'last-frame',
    }));
    setReelIdx(reels.length);
  }

  function updateReel(patch) { mutate(e => Object.assign(e.reels[reelIdx], patch)); }

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
          <span className="muted small">{project.film?.orientation === 'portrait' ? '竖屏' : '横屏'} · 15 秒/Reel</span>
        </div>
      </div>
      <div className="ws-body">
        <div className="ws-main">
          <div className="cinema-bar">
            <div className="reel-tabs">
              {reels.map((r, i) => <button key={r.id} className={i === reelIdx ? 'active' : ''} onClick={() => setReelIdx(i)}>{r.title}</button>)}
              <button className="ep-add" onClick={addReel}><Plus size={14} /></button>
            </div>
          </div>
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
            {!reel ? <div className="empty"><Clapperboard size={30} /><h3>还没有 Reel</h3><p>一个 Reel 是一段 15 秒的视觉制作单元。点上面的 + 新建。</p></div> : (
              <>
                {stage === 'scene' && (
                  <div className="simple-view">
                    <div className="view-head"><div><h2>场景设计</h2><p className="muted">写环境。可拍摄的细节：时间、光线、天气、材质、声音。</p></div></div>
                    <input className="title-input" value={reel.title} onChange={e => updateReel({ title: e.target.value })} placeholder="Reel 标题" />
                    <textarea className="big-area" rows={8} value={reel.scene} onChange={e => updateReel({ scene: e.target.value })} placeholder="INT. 旧书店 - 雨夜&#10;&#10;窄过道。暖黄台灯照在摊开的书上。窗外雨声持续。" />
                    <div className="field-label">参考图 URL（每行一个）</div>
                    <textarea rows={3} value={(reel.refs || []).join('\n')} onChange={e => updateReel({ refs: e.target.value.split('\n').filter(Boolean) })} placeholder="https://..." />
                  </div>
                )}
                {stage === 'performance' && (
                  <div className="simple-view">
                    <div className="view-head"><div><h2>表演</h2><p className="muted">用 @ 引用角色，# 引用道具，引号写对白。只写这 15 秒里发生的事。</p></div></div>
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
                      <h3>生成任务接入点</h3>
                      <p>本地版不调用商业图像 API。你可以把外部工具生成的图片 URL 填在这里，保持资产与 Reel 绑定。</p>
                      <input value={reel.storyboardImage || ''} onChange={e => updateReel({ storyboardImage: e.target.value })} placeholder="图片 URL" />
                      {reel.storyboardImage && <img src={reel.storyboardImage} alt="分镜锚点" className="storyboard-preview" />}
                    </div>
                  </div>
                )}
                {stage === 'clip' && (
                  <div className="simple-view">
                    <div className="view-head"><div><h2>成片</h2><p className="muted">固定 15 秒。连续模式：{reel.continuity === 'last-frame' ? '末帧接续' : '自然过渡'}</p></div></div>
                    <select value={reel.continuity} onChange={e => updateReel({ continuity: e.target.value })}>
                      <option value="last-frame">末帧接续上一 Reel</option>
                      <option value="natural">自然过渡（独立生成）</option>
                    </select>
                    <div className="task-placeholder">
                      <Clapperboard size={26} />
                      <h3>视频生成任务接入点</h3>
                      <p>填入外部生成的视频 URL 或本地路径，作为这个 Reel 的最终版本。</p>
                      <input value={reel.clip || ''} onChange={e => updateReel({ clip: e.target.value })} placeholder="视频 URL / 路径" />
                      {reel.clip && <video src={reel.clip} controls className="storyboard-preview" />}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
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
    </div>
  );
}
