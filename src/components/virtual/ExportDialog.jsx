import React, { useState, useEffect } from 'react';
import { Download, X, Loader2, Check, Volume2, Subtitles, AlertTriangle, Play } from 'lucide-react';
import { api } from '../../api.js';
import { createBrowserRender, blobToBase64, recorderSupported } from './exportAdapter.js';

export default function ExportDialog({ project, compiled, dsl, playhead, setPlayhead, onClose, onNotice, setError }) {
  const [mode, setMode] = useState('720p');
  const [burn, setBurn] = useState(true);
  const [withVoice, setWithVoice] = useState(true);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [voiceUrl, setVoiceUrl] = useState(null);

  const total = compiled?.timeline?.totalSec || 30;
  const dialogue = compiled?.timeline?.dialogue || [];

  useEffect(() => {
    // 预生成配音（用户手势已发生在打开对话框时）：逐角色 TTS 并拼成一条音轨。
    if (!withVoice || !project || !dialogue.length) { setVoiceUrl(null); return; }
    (async () => {
      try {
        const r = await api.virtual.voiceover(project.id, { lines: dialogue });
        setVoiceUrl(r.url || null);
      } catch { setVoiceUrl(null); }
    })();
  }, [withVoice, project?.id]);

  const dims = mode === '1080p' ? [1920, 1080] : mode === '480p' ? [854, 480] : [1280, 720];

  async function start() {
    setBusy(true); setError(''); setProgress(0);
    try {
      if (!recorderSupported()) throw new Error('当前浏览器不支持导出（需 Chrome/Edge 的 MediaRecorder）。');
      const job = await api.virtual.render(project.id, { mode: 'browser', ...{ width: dims[0], height: dims[1], fps: 30, burnSubtitles: burn, durationSec: total } });
      setPlayhead(0);
      await new Promise(r => setTimeout(r, 350)); // 让相机架回到起点
      const canvas = window.__glVirtualCanvas;
      const { blob } = await createBrowserRender({
        webglCanvas: canvas, dialogue, audioUrl: voiceUrl, width: dims[0], height: dims[1],
        fps: 30, burnSubtitles: burn, durationSec: total, onProgress: setProgress,
      });
      const base64 = await blobToBase64(blob);
      const done = await api.virtual.completeRender(project.id, job.jobId, {
        dataBase64: base64, mimeType: blob.type, durationSec: total,
        subtitles: dialogue.map(d => ({ text: d.text, startSec: d.startSec, endSec: d.endSec })),
      });
      setResult(done);
      onNotice?.(`成片已生成：${done.url || '已保存到素材库'}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="vp-modal-mask" onClick={() => !busy && onClose()}>
      <div className="vp-modal" onClick={e => e.stopPropagation()}>
        <div className="vp-modal-head"><h3><Download size={17} /> 导出成片</h3>
          <button className="icon-btn" onClick={onClose} disabled={busy}><X size={16} /></button></div>
        <div className="vp-modal-body">
          <div className="vp-export-opts">
            <label className="vp-field"><span>分辨率</span>
              <select value={mode} onChange={e => setMode(e.target.value)} disabled={busy}>
                <option value="480p">480P（快、体积小）</option>
                <option value="720p">720P（推荐）</option>
                <option value="1080p">1080P（清晰、体积大）</option>
              </select></label>
            <label className="vp-check"><input type="checkbox" checked={burn} onChange={e => setBurn(e.target.checked)} disabled={busy} /><Subtitles size={14} /> 烧录字幕</label>
            <label className="vp-check"><input type="checkbox" checked={withVoice} onChange={e => setWithVoice(e.target.checked)} disabled={busy} /><Volume2 size={14} /> AI 配音{voiceUrl ? '（已就绪）' : ''}</label>
          </div>
          <p className="muted small">浏览器同源导出：录制导演台当前场景 {dims[0]}×{dims[1]} / 30fps，时长 {total}s，输出 WebM。未来可无缝切换到服务端 headless 高分辨率渲染。</p>

          {busy && <div className="vp-progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>}
          {result && <div className="vp-result"><Check size={16} /> 成片已保存到素材库并创建版本。
            {result.url && <a href={result.url} target="_blank" rel="noreferrer"><Play size={13} /> 播放成片</a>}
          </div>}
          {!recorderSupported() && <div className="vp-error"><AlertTriangle size={14} /> 当前浏览器不支持导出，请使用 Chrome / Edge。</div>}
        </div>
        <div className="vp-modal-foot">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>关闭</button>
          <button className="btn btn-primary" onClick={start} disabled={busy || !compiled?.ok}>
            {busy ? <><Loader2 size={15} className="spin" /> 导出中 {Math.round(progress * 100)}%</> : <><Download size={15} /> 开始导出</>}
          </button>
        </div>
      </div>
    </div>
  );
}
