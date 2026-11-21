// 浏览器同源导出：把 WebGL canvas 逐帧绘到离屏 2D canvas，叠字幕 → captureStream → MediaRecorder.WebM，
// Web Audio 混入配音轨。未来 headless 方案只需替换此适配器，不改 DSL/解释器/场景图。

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm',
];
// WebM/Matroska 容器头 1A 45 DF A3。导出的有效 WebM 一定以此开头。
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
// 低于此体积基本可以断定没有真实帧（一个 30s/720p WebM 至少几十 KB）。
const MIN_VALID_BYTES = 1024;

// 同步可做的粗检（体积）；容器魔数由 isWebMBytes 异步复核。
export function looksLikeWebM(blob) {
  return !!blob && blob.size >= MIN_VALID_BYTES;
}

export function isWebMBytes(buf) {
  if (!buf || buf.byteLength < 4) return false;
  const b = new Uint8Array(buf);
  return EBML_MAGIC.every((m, i) => b[i] === m);
}

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
    if (!res.ok) return null;
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
  fps = 30, burnSubtitles = true, durationSec = 30, onProgress, onFrame,
}) {
  if (!recorderSupported()) throw new Error('当前浏览器不支持 MediaRecorder/captureStream 导出，请换用 Chrome 或 Edge。');
  if (!webglCanvas) throw new Error('导演台画布尚未就绪，无法导出。');
  // 画布必须已挂载且有实际尺寸；否则 drawImage 只能读到空白，产出损坏文件。
  if (!webglCanvas.isConnected || !webglCanvas.width || !webglCanvas.height) {
    throw new Error('导演台画布当前不可见，请先切换到「导演台」页签再导出。');
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = width; offscreen.height = height;
  const ctx = offscreen.getContext('2d', { alpha: false });
  ctx.fillStyle = '#0d1a14';
  ctx.fillRect(0, 0, width, height);
  // 帧率 0：完全由我们主动 requestFrame 驱动，避免 rAF 被后台节流导致漏帧/空文件。
  const stream = offscreen.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0];

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

  recorder.start(250);
  const startAt = performance.now();
  let lastFrameErr = null;
  // 用定时器而非 rAF：导出期间页面可见且进度条在更新，setInterval 能稳定产出帧。
  const drawOneFrame = () => {
    const t = (performance.now() - startAt) / 1000;
    try {
      ctx.drawImage(webglCanvas, 0, 0, width, height);
      if (burnSubtitles) {
        const line = dialogue.find(d => t >= d.startSec && t <= d.endSec);
        if (line) drawSubtitle(ctx, line.text, width, height);
      }
    } catch (e) { lastFrameErr = e; }
    // 主动推一帧到录制流；requestFrame 缺失时回退（captureStream(0) 下无帧会导致空文件）。
    try { videoTrack?.requestFrame?.(); } catch {}
    onFrame?.(t);
    onProgress?.(Math.min(1, t / durationSec));
    return t >= durationSec;
  };

  const timer = setInterval(() => {
    if (drawOneFrame()) {
      clearInterval(timer);
      if (recorder.state !== 'inactive') recorder.stop();
    }
  }, Math.max(16, Math.round(1000 / fps)));

  let blob;
  try {
    blob = await done;
  } finally {
    clearInterval(timer);
    if (audioCtx) { try { await audioCtx.close(); } catch {} }
    stream.getTracks().forEach(t => t.stop && t.stop());
  }
  if (lastFrameErr) throw new Error(`录制画面时出错：${lastFrameErr.message}`);
  // 关键防线：绝不允许把空白/残片当作成功成片上传（与后端 validateVideoBuffer 口径一致）。
  if (!looksLikeWebM(blob)) {
    throw new Error(`录制结果异常（仅 ${blob.size} 字节，未产生有效画面）。请确认场景已编译、画布可见后重试，或降低分辨率再试。`);
  }
  if (!isWebMBytes(await blob.slice(0, 4).arrayBuffer())) {
    throw new Error('录制结果不是有效的 WebM 容器，请重试导出。');
  }
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
