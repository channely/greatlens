// 模型目录与计费规则的单一事实来源。
// 价格单位：图像按张（生成 / 输入分列），视频按秒（按输出分辨率分档）。
// 所有价格都是本地估算值，实际以阿里云百炼账单为准。

export const DEFAULT_IMAGE_MODEL = 'qwen-image-3.0';
export const DEFAULT_VIDEO_MODEL = 'wan3.0-video';
export const VIDEO_RESOLUTIONS = ['480P', '720P', '1080P'];
export const DEFAULT_VIDEO_RESOLUTION = '480P';
export const MAX_VIDEO_SECONDS = 30;
export const DEFAULT_VIDEO_SECONDS = 5;
export const DEFAULT_IMAGE_SIZE = '1024*1024';
export const DEFAULT_AUDIO_MODEL = 'qwen-audio-3.1-tts-next';
export const MAX_AUDIO_PROMPT_CHARS = 3000;
export const MAX_ROUNDTABLE_SECONDS = 240;
export const MAX_OTHER_AUDIO_SECONDS = 120;
export const MAX_AUDIO_REFERENCES = 3;
export const MAX_AUDIO_REFERENCE_SECONDS = 30;
export const MAX_AUDIO_REFERENCE_BYTES = 10 * 1024 * 1024;

// 限时折扣：控制台在 480P / 720P / 1080P 三档均标注「限时7折」。
// 标价存于 videoPrice*，此处 0.7 表示按折后价估算；改成 1 即按标价估算。
export const PRICING_DEFAULTS = {
  imageGenPrice: 0.18,     // 元 / 张（1K 与 2K 同价）
  imageInputPrice: 0.02,   // 元 / 张输入图（图生图时计）
  videoPrice480P: 0.3,     // 元 / 秒（标价）
  videoPrice720P: 0.6,     // 元 / 秒（标价）
  videoPrice1080P: 1.2,    // 元 / 秒（标价）
  videoDiscount: 0.7,      // 限时7折 → 0.7；无折扣填 1
  audioPriceInput: 6,      // 元 / 百万输入 token（北京）
  audioPriceOutput: 12,    // 元 / 百万输出 token（北京）
};

export const IMAGE_MODELS = [
  {
    id: DEFAULT_IMAGE_MODEL,
    label: 'Qwen-Image-3.0',
    recommended: true,
    modality: '文本、图片 → 图片',
    rpm: 20,
    highlight: '默认生图模型。指令理解清晰，最大 4.5k token 输入；10px 小字、12 国语言、20+ 字体渲染稳定，海报 / 网页 / 界面可批量产出。',
    doc: 'https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference',
  },
  {
    id: 'qwen-image-3.0-pro',
    label: 'Qwen-Image-3.0 Pro',
    modality: '文本、图片 → 图片',
    rpm: 20,
    highlight: '3.0 系列增强档，适合更高画质要求。',
    doc: 'https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference',
  },
  {
    id: 'qwen-image-2.1-turbo',
    label: 'Qwen-Image-2.1 Turbo',
    modality: '文本 → 图片',
    highlight: '旧版快速出图，保留给历史项目。',
    doc: 'https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference',
  },
  {
    id: 'wanx2.1-t2i-plus',
    label: 'Wanx 2.1 T2I Plus',
    modality: '文本 → 图片',
    highlight: '旧版万相文生图，保留给历史项目。',
    doc: 'https://help.aliyun.com/zh/model-studio/text-to-image',
  },
];

export const VIDEO_MODELS = [
  {
    id: DEFAULT_VIDEO_MODEL,
    label: '万相3.0-视频生成',
    recommended: true,
    modality: '文本、图片、视频、音频 → 视频',
    rpm: 300,
    maxSeconds: MAX_VIDEO_SECONDS,
    resolutions: VIDEO_RESOLUTIONS,
    highlight: 'all-in-one 视频生成，统一支持参考 / 编辑 / 复刻 / 驱动；四模态全能参考，最长 30 秒，生产级角色一致性。',
    doc: 'https://docs.bailian.console.aliyun.com/zh/model-studio/wan3-video-generation-api-reference',
  },
  {
    id: 'wan2.7-t2v',
    label: 'Wan 2.7 T2V',
    modality: '文本 → 视频',
    highlight: '旧版文生视频，保留给历史项目。',
    doc: 'https://help.aliyun.com/zh/model-studio/video-generation',
  },
  {
    id: 'wan2.7-i2v',
    label: 'Wan 2.7 I2V',
    modality: '图片 → 视频',
    highlight: '旧版图生视频，保留给历史项目。',
    doc: 'https://help.aliyun.com/zh/model-studio/image-to-video',
  },
];

export function normalizeResolution(value, fallback = DEFAULT_VIDEO_RESOLUTION) {
  const s = String(value || '').toUpperCase().replace(/P$/, 'P');
  return VIDEO_RESOLUTIONS.includes(s) ? s : fallback;
}

// 百炼图像尺寸格式为 '<宽>*<高>'（星号），不接受 '1024x1024' / '1024×1024'。
// 这里统一归一化，兼容前端历史值与用户手输，避免 InvalidParameter。
export function normalizeImageSize(value, fallback = DEFAULT_IMAGE_SIZE) {
  const s = String(value || '').trim().toLowerCase().replace(/[x×]/g, '*');
  const m = s.match(/^(\d{2,5})\*(\d{2,5})$/);
  if (!m) return fallback;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w < 512 || w > 4096 || h < 512 || h > 4096) return fallback;
  return `${w}*${h}`;
}

// 单条视频时长：1–30 秒，越界钳制；非法值给默认 5 秒。
export function clampVideoSeconds(value, fallback = DEFAULT_VIDEO_SECONDS) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_VIDEO_SECONDS, Math.round(n)));
}

const priceOf = (cfg, key) => {
  const n = Number(cfg?.[key]);
  return Number.isFinite(n) ? n : PRICING_DEFAULTS[key];
};

// 折算后的每秒单价（含限时折扣）。
export function videoRate(cfg, resolution) {
  const r = normalizeResolution(resolution);
  const key = r === '1080P' ? 'videoPrice1080P' : r === '720P' ? 'videoPrice720P' : 'videoPrice480P';
  const discount = priceOf(cfg, 'videoDiscount');
  return priceOf(cfg, key) * (Number.isFinite(discount) && discount > 0 ? discount : 1);
}

export function videoListRate(cfg, resolution) {
  const r = normalizeResolution(resolution);
  const key = r === '1080P' ? 'videoPrice1080P' : r === '720P' ? 'videoPrice720P' : 'videoPrice480P';
  return priceOf(cfg, key);
}

// 视频：输出时长 + 输入视频时长，均按输出分辨率的每秒单价计费。
export function estimateVideoCost(cfg, { seconds = 0, inputSeconds = 0, resolution } = {}) {
  const billable = Math.max(0, Number(seconds) || 0) + Math.max(0, Number(inputSeconds) || 0);
  const rate = videoRate(cfg, resolution);
  return Math.round(billable * rate * 1e4) / 1e4;
}

// 图像：生成张数 × 生成单价 + 输入图张数 × 输入单价。
export function estimateImageCost(cfg, { genCount = 0, inputCount = 0 } = {}) {
  const g = Math.max(0, Number(genCount) || 0) * priceOf(cfg, 'imageGenPrice');
  const i = Math.max(0, Number(inputCount) || 0) * priceOf(cfg, 'imageInputPrice');
  return Math.round((g + i) * 1e4) / 1e4;
}

export function modelCatalog() {
  return {
    image: IMAGE_MODELS,
    video: VIDEO_MODELS,
    audio: [{ id: DEFAULT_AUDIO_MODEL, label: 'Qwen Audio 3.1 TTS Next', modality: '文本 → 音频', recommended: true }],
    resolutions: VIDEO_RESOLUTIONS,
    audioLimits: {
      promptChars: MAX_AUDIO_PROMPT_CHARS,
      roundtableSeconds: MAX_ROUNDTABLE_SECONDS,
      otherSeconds: MAX_OTHER_AUDIO_SECONDS,
      references: MAX_AUDIO_REFERENCES,
      referenceSeconds: MAX_AUDIO_REFERENCE_SECONDS,
      referenceBytes: MAX_AUDIO_REFERENCE_BYTES,
    },
    defaults: {
      imageModel: DEFAULT_IMAGE_MODEL,
      videoModel: DEFAULT_VIDEO_MODEL,
      videoResolution: DEFAULT_VIDEO_RESOLUTION,
      videoSeconds: DEFAULT_VIDEO_SECONDS,
      maxVideoSeconds: MAX_VIDEO_SECONDS,
      imageSize: DEFAULT_IMAGE_SIZE,
      audioModel: DEFAULT_AUDIO_MODEL,
    },
    pricing: PRICING_DEFAULTS,
    note: '图像按张、视频按秒（按输出分辨率分档）；限时折扣在「设置」中可调。所有费用为本地估算，实际以阿里云账单为准。',
  };
}
