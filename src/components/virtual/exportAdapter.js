// 浏览器同源导出：把 WebGL canvas 逐帧绘到离屏 2D canvas，叠字幕 → captureStream → MediaRecorder.WebM，
// Web Audio 混入配音轨。未来 headless 方案只需替换此适配器，不改 DSL/解释器/场景图。

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm',
];

export function recorderSupported() {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.captureStream;
}

function pickMime() {
  return MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported?.(m)) || '';
}

// 把音频 URL 解码为 AudioBuffer（用于混入 MediaStreamDestination）。
async function fetchAudioBuffer(url, audioCtx) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    return await audioCtx.decodeAudioData(arr);
  } catch { return null; }
}

function drawSubtitle(ctx, text, w, h) {
  if (!text) return;
  const fontSize = Math.max(20, Math.round(h * 0.052));
  ctx.font = `600 ${fontSize}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const lines = String(text).split(/\n/).slice(0, 2);
  const padX = fontSize * 0.6, padY = fontSize * 0.35;
  const maxW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
  const boxW = Math.min(w - 24, maxW + padX * 2);
  const boxH = lines.length * fontSize * 1.25 + padY * 2;
  const bx = (w - boxW) / 2, by = h - boxH - fontSize * 0.6;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.fillStyle = '#ffffff';
  lines.forEach((line, i) => ctx.fillText(line, w / 2, by + padY + fontSize * (i + 1) * 1.15));
}

/**
 * 录制导演台画布。
 * @returns {Promise<{blob: Blob, durationSec: number, mimeType: string}>}
 */
export async function createBrowserRender({
  webglCanvas, dialogue = [], audioUrl = null, width = 1280, height = 720,
  fps = 30, burnSubtitles = true, durationSec = 30, onProgress,
}) {
  if (!recorderSupported()) throw new Error('当前浏览器不支持 MediaRecorder/captureStream 导出，请换用 Chrome 或 Edge。');
  if (!webglCanvas) throw new Error('导演台画布尚未就绪，无法导出。');

  const offscreen = document.createElement('canvas');
  offscreen.width = width; offscreen.height = height;
  const ctx = offscreen.getContext('2d');
  const stream = offscreen.captureStream(fps);

  // Web Audio：混入配音轨（若有）。
  let audioCtx = null, dest = null;
  if (audioUrl) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      dest = audioCtx.createMediaStreamDestination();
      const buf = await fetchAudioBuffer(audioUrl, audioCtx);
      if (buf) {
        const src = audioCtx.createBufferSource();
        src.buffer = buf; src.connect(dest); src.start(0);
      }
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    } catch { /* 配音失败不阻断画面导出 */ }
  }

  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 4_000_000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
    recorder.onerror = e => reject(e.error || new Error('录制失败'));
  });

  recorder.start(200);
  const startAt = performance.now();
  let raf;
  const frame = () => {
    const t = (performance.now() - startAt) / 1000;
    ctx.drawImage(webglCanvas, 0, 0, width, height);
    if (burnSubtitles) {
      const line = dialogue.find(d => t >= d.startSec && t <= d.endSec);
      if (line) drawSubtitle(ctx, line.text, width, height);
    }
    onProgress?.(Math.min(1, t / durationSec));
    if (t < durationSec) raf = requestAnimationFrame(frame);
    else recorder.stop();
  };
  raf = requestAnimationFrame(frame);
  const blob = await done;
  cancelAnimationFrame(raf);
  if (audioCtx) { try { await audioCtx.close(); } catch {} }
  stream.getTracks().forEach(t => t.stop && t.stop());
  return { blob, durationSec, mimeType: mimeType || 'video/webm' };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
