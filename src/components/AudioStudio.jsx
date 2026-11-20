import React, { useState } from 'react';
import { Mic2, Loader2, AlertTriangle, Check } from 'lucide-react';
import { api, resolveAssetUrl } from '../api.js';
import { AUDIO_LIMITS, price } from '../pricing.js';

export default function AudioStudio({ project, episodeId }) {
  const [scene, setScene] = useState('roundtable');
  const [plan, setPlan] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [cfg, setCfg] = useState(null);

  async function prepare(nextScene = scene) {
    setScene(nextScene);
    setBusy(true); setError(''); setResult('');
    try {
      const [p, settings] = await Promise.all([
        api.projects.planAudio(project.id, { scene: nextScene, episodeId }),
        api.settings.get(),
      ]);
      setCfg(settings);
      setPlan(p);
      setPrompt(p.script);
      setSeconds(p.seconds);
      if (p.needsRange) setError(p.note);
    } catch (e) { setError(e.message || '生成文案失败'); }
    finally { setBusy(false); }
  }

  async function synthesize() {
    if (!prompt.trim()) { setError('请先生成并确认音频文案。'); return; }
    if (prompt.length > AUDIO_LIMITS.promptChars) { setError(`音频文案最多 ${AUDIO_LIMITS.promptChars} 字符，请缩小场景或回合范围。`); return; }
    const limit = scene === 'roundtable' ? AUDIO_LIMITS.roundtableSeconds : AUDIO_LIMITS.otherSeconds;
    if (seconds > limit) { setError(`${scene === 'roundtable' ? '导演圆桌' : '剧本围读'}最长 ${limit} 秒。`); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const r = await api.media.audio({ scene, prompt, seconds, projectId: project.id, episodeId });
      setResult(r);
    } catch (e) {
      setError(/fetch|network|timeout/i.test(String(e.message || ''))
        ? '连接中断，结果未知。请人工确认百炼任务后再决定是否重试，避免重复扣费。'
        : (e.message || '合成失败'));
    } finally { setBusy(false); }
  }

  const estimated = cfg && prompt
    ? (prompt.length * Number(price(cfg, 'audioPriceInput') || 0) + seconds * 4 * Number(price(cfg, 'audioPriceOutput') || 0)) / 1e6
    : 0;

  return (
    <div className="simple-view audio-studio">
      <div className="view-head">
        <div><h2>声音</h2><p className="muted">导演圆桌与剧本围读：先确认文案，再同步合成。超长要求缩小范围，不静默截断。</p></div>
      </div>
      <div className="audio-modes">
        <button className={scene === 'roundtable' ? 'active' : ''} onClick={() => prepare('roundtable')}><Mic2 size={14} /> 导演圆桌</button>
        <button className={scene === 'readthrough' ? 'active' : ''} onClick={() => prepare('readthrough')}><Mic2 size={14} /> 剧本围读</button>
      </div>
      {plan && <>
        <label className="audio-label">音频文案（可编辑；确认后才合成）
          <textarea rows={10} value={prompt} onChange={e => setPrompt(e.target.value)} />
        </label>
        <div className="audio-controls">
          <label>时长（秒，最长 {scene === 'roundtable' ? AUDIO_LIMITS.roundtableSeconds : AUDIO_LIMITS.otherSeconds}）
            <input type="number" min="1" max={scene === 'roundtable' ? AUDIO_LIMITS.roundtableSeconds : AUDIO_LIMITS.otherSeconds} value={seconds} onChange={e => setSeconds(Number(e.target.value))} />
          </label>
          <div className="muted small">本地估算约 ¥{estimated.toFixed(4)}；只有接口返回可计费 Token 才精确记账。</div>
          <button className="btn btn-primary" disabled={busy || !prompt.trim()} onClick={synthesize}>
            {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} 确认并合成
          </button>
        </div>
        <p className="muted small">{plan.note}</p>
      </>}
      {error && <div className="alert error sm"><AlertTriangle size={14} /> {error}</div>}
      {result && <div className="audio-result">
        <audio controls src={resolveAssetUrl(result.url)} />
        <div className="muted small">任务 {result.taskId.slice(0, 16)} · {result.costKnown ? `¥${result.cost}` : '成本未知'} · {result.note}</div>
      </div>}
      {busy && <div className="loading"><Loader2 className="spin" size={14} /> 处理中…</div>}
    </div>
  );
}
