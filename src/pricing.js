// 前端计费估算口径，镜像后端 server/models.js 的 PRICING_DEFAULTS。
// 实际单价以「设置」页持久化值为准；此文件只作缺省回退。
export const MAX_VIDEO_SECONDS = 30;

export const FALLBACK_PRICES = {
  imageGenPrice: 0.18,
  imageInputPrice: 0.02,
  videoPrice480P: 0.3,
  videoPrice720P: 0.6,
  videoPrice1080P: 1.2,
  videoDiscount: 0.7,
  audioPriceInput: 6,
  audioPriceOutput: 12,
};

export const AUDIO_LIMITS = {
  promptChars: 3000,
  roundtableSeconds: 240,
  otherSeconds: 120,
  references: 3,
};

export const RESOLUTIONS = ['480P', '720P', '1080P'];

export function price(cfg, key) {
  return Number.isFinite(Number(cfg?.[key])) ? Number(cfg[key]) : FALLBACK_PRICES[key];
}

// 折算后的每秒单价（含限时折扣）。
export function videoRate(cfg, resolution) {
  const r = RESOLUTIONS.includes(resolution) ? resolution : '480P';
  const suffix = r === '480P' ? '480P' : r === '720P' ? '720P' : '1080P';
  return price(cfg, `videoPrice${suffix}`) * (price(cfg, 'videoDiscount') || 1);
}

// 单条时长钳制：1–30 秒。
export function clampSeconds(value, fallback = 5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_VIDEO_SECONDS, Math.round(n)));
}
