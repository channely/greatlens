import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_VIDEO_RESOLUTION,
  DEFAULT_AUDIO_MODEL, PRICING_DEFAULTS,
} from './models.js';
import { migrateDb, stableHash, CURRENT_SCHEMA_VERSION } from './migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');
// GL_DATA_DIR 用于测试隔离与自托管迁移；默认仍是工程内 data/。
export const DATA_DIR = process.env.GL_DATA_DIR
  ? path.resolve(process.env.GL_DATA_DIR)
  : path.join(ROOT, 'data');
export const ASSETS_DIR = path.join(DATA_DIR, 'assets');
export const DB_PATH = path.join(DATA_DIR, 'db.json');
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

// 百炼华北2（北京）：qwen4-max 输入 ¥10/百万 token，输出 ¥30/百万 token（思维链计入输出）
// 图像 / 视频单价与模型默认值统一来自 models.js（单一事实来源）。
const DEFAULT_SETTINGS = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen4-max',
  temperature: 1,
  enableThinking: true,
  priceInput: 10,
  priceOutput: 30,
  imageGenPrice: PRICING_DEFAULTS.imageGenPrice,
  imageInputPrice: PRICING_DEFAULTS.imageInputPrice,
  videoPrice480P: PRICING_DEFAULTS.videoPrice480P,
  videoPrice720P: PRICING_DEFAULTS.videoPrice720P,
  videoPrice1080P: PRICING_DEFAULTS.videoPrice1080P,
  videoDiscount: PRICING_DEFAULTS.videoDiscount,
  audioPriceInput: PRICING_DEFAULTS.audioPriceInput,
  audioPriceOutput: PRICING_DEFAULTS.audioPriceOutput,
  workspaceId: '',
  audioModel: DEFAULT_AUDIO_MODEL,
  mediaBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  imageModel: DEFAULT_IMAGE_MODEL,
  videoModel: DEFAULT_VIDEO_MODEL,
  videoResolution: DEFAULT_VIDEO_RESOLUTION,
  syncRemote: '',
  syncToken: '',
  syncDevice: '',
  remoteBase: '',
};

function read(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const existed = fs.existsSync(DB_PATH);
  const raw = existed ? (read(DB_PATH) || {}) : { projects: [], tasks: [], usage: [], assets: [], versions: [], ideaDrafts: [] };
  const d = migrateDb(structuredClone(raw));
  if (!existed || JSON.stringify(raw) !== JSON.stringify(d)) write(DB_PATH, d);
  if (!fs.existsSync(SETTINGS_PATH)) {
    write(SETTINGS_PATH, { ...DEFAULT_SETTINGS });
  } else {
    const s = read(SETTINGS_PATH) || {};
    let ch = false;
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      if (s[k] === undefined) { s[k] = v; ch = true; }
    }
    // 迁移：旧默认模型升级为 3.0 系列；旧按次单价键迁移为新的按张 / 按秒键。
    if (s.imageModel === 'qwen-image-3.0-pro' || s.imageModel === 'qwen-image-2.1-turbo') { s.imageModel = DEFAULT_IMAGE_MODEL; ch = true; }
    if (String(s.videoModel || '').startsWith('wan2.')) { s.videoModel = DEFAULT_VIDEO_MODEL; ch = true; }
    if (s.videoResolution === undefined) { s.videoResolution = DEFAULT_VIDEO_RESOLUTION; ch = true; }
    // 旧 imageUnitPrice/videoUnitPrice 已弃用，移除以免与新计费口径混淆。
    if ('imageUnitPrice' in s) { delete s.imageUnitPrice; ch = true; }
    if ('videoUnitPrice' in s) { delete s.videoUnitPrice; ch = true; }
    if (ch) write(SETTINGS_PATH, s);
  }
}
ensure();

export const uid = () => crypto.randomUUID();

// 官方顾问是世界观/方法论 lens，不是账号成员：每个项目同时只雇用一位（与 laper.ai 一致）。
export const ADVISORS = [
  { id: 'script-doctor', name: '剧本医生', en: 'Script Doctor', method: '先定位根问题（结构/人物/场次功能/主题/节奏/对白），再给出按优先级排列的可执行处方，保护作者意图。' },
  { id: 'structure', name: '结构顾问', en: 'Structure Advisor', method: '以因果链与反转阶梯审视大纲与节拍：检查铺垫—升级—兑现，指出缺失的转折点。' },
  { id: 'dialogue', name: '对白顾问', en: 'Dialogue Advisor', method: '逐句检验潜台词、角色声音区分度与解释性台词，给出更小的替换方案。' },
  { id: 'producer', name: '制片可行性顾问', en: 'Production Advisor', method: '从可拍摄性、地点/道具连续性、时长与预算角度审查，指出不可实现的描写。' },
  { id: 'short-drama', name: '短剧节奏顾问', en: 'Short-form Advisor', method: '以前 3 秒钩子、每场反转、结尾悬念与竖屏可视性为准绳诊断短剧节奏。' },
  { id: 'visual', name: '视听语言顾问', en: 'Visual Storytelling Advisor', method: '把抽象文字转成可见/可听的镜头行为，检查画面是否承担叙事功能。' },
];

// 知识库条目索引：只把索引灌进 AI 上下文，正文按需读取（laper.ai 的 index → search → read 模式）。
export function knowledgeIndex(items = []) {
  return (items || []).map(({ id, name, type, summary, tags, body }) => ({
    id, name, type, summary, tags,
    chars: typeof body === 'string' ? body.length : 0,
  }));
}

export function searchKnowledge(items = [], q = '') {
  const needle = String(q || '').trim().toLowerCase();
  const pool = items || [];
  if (!needle) return pool.map(k => ({ id: k.id, name: k.name, summary: k.summary, type: k.type }));
  return pool.filter(k => [k.name, k.summary, k.type, ...(k.tags || []), k.body]
    .some(v => String(v || '').toLowerCase().includes(needle)))
    .map(k => ({ id: k.id, name: k.name, summary: k.summary, type: k.type, body: k.body }));
}

// 内存镜像：读操作零磁盘 IO；写操作同步原子落盘（Node 单线程，无并发交错）。
// 每次写入都用完整快照原子 rename，进程退出不丢数据。
let cache = read(DB_PATH) || { projects: [], tasks: [], usage: [], assets: [] };
const clone = v => JSON.parse(JSON.stringify(v));

export const db = {
  all() { return clone(cache); },
  save(data) {
    cache = clone(data);
    write(DB_PATH, cache);
    return clone(cache);
  },
  update(fn) {
    const working = clone(cache);
    const r = fn(working);
    cache = working;
    write(DB_PATH, cache);
    return r === undefined ? clone(cache) : r;
  },
};

const mask = v => v ? '***' + String(v).slice(-4) : '';
let settingsCache = { ...DEFAULT_SETTINGS, ...(read(SETTINGS_PATH) || {}) };

export const settings = {
  get() { return { ...settingsCache }; },
  raw() { return { ...settingsCache }; },
  set(patch) {
    settingsCache = { ...settingsCache, ...patch };
    write(SETTINGS_PATH, settingsCache);
    return { ...settingsCache };
  },
  public() {
    const s = settings.get();
    return {
      ...s,
      apiKey: mask(s.apiKey),
      syncToken: mask(s.syncToken),
    };
  },
  cost(promptTokens = 0, completionTokens = 0) {
    const s = settings.get();
    const p = Number(s.priceInput) || 0;
    const c = Number(s.priceOutput) || 0;
    return Math.round(((Number(promptTokens) / 1e6) * p + (Number(completionTokens) / 1e6) * c) * 1e6) / 1e6;
  },
};

export const usage = {
  add(entry) {
    const rec = {
      id: uid(),
      ts: new Date().toISOString(),
      type: 'chat',
      model: '',
      mode: '',
      scope: '',
      taskId: '',
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      cost: 0,
      ...entry,
    };
    rec.cost = entry.costOverride !== undefined
      ? Number(entry.costOverride)
      : settings.cost(rec.promptTokens, rec.completionTokens);
    delete rec.costOverride;
    db.update(d => { d.usage.unshift(rec); if (d.usage.length > 5000) d.usage.length = 5000; });
    return rec;
  },
  // 冲正/退款：以负成本记录追加一条 reversal，按 refundKey 幂等。
  // 个人版没有预充值钱包，退款语义 = 冲销已记账费用，而不是退现金；result 返回是否新建。
  refund(entry = {}) {
    const key = String(entry.refundKey || '').trim();
    if (!key) throw Object.assign(new Error('退款缺少幂等键。'), { status: 400 });
    let result = null;
    db.update(d => {
      if (d.usage.some(r => r.kind === 'refund' && r.refundKey === key)) {
        result = { created: false, refundKey: key };
        return;
      }
      const rec = {
        id: uid(),
        ts: new Date().toISOString(),
        type: 'refund',
        kind: 'refund',
        refundKey: key,
        refundOf: entry.refundOf || '',
        taskId: entry.taskId || '',
        model: entry.model || '',
        mode: 'refund',
        scope: '',
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        cost: -Math.abs(Number(entry.amount) || 0),
        reason: String(entry.reason || '任务失败或资产作废，冲销计费').slice(0, 200),
      };
      d.usage.unshift(rec);
      if (d.usage.length > 5000) d.usage.length = 5000;
      result = { created: true, refundKey: key, id: rec.id, amount: rec.cost };
    });
    return result;
  },
  refunds() {
    return db.all().usage.filter(r => r.kind === 'refund');
  },
  clear() { db.update(d => { d.usage = []; }); },
  report(days = 30) {
    const all = db.all().usage;
    const since = Date.now() - (Number(days) || 30) * 86400000;
    const rows = all.filter(r => new Date(r.ts).getTime() >= since);
    const isRefund = r => r.kind === 'refund';
    // 冲正行不增加调用次数 / token，只把负成本并入费用，使净额自动抵扣。
    const sum = acc => rows.reduce((a, r) => {
      if (!isRefund(r)) {
        a.calls += 1;
        a.promptTokens += r.promptTokens || 0;
        a.completionTokens += r.completionTokens || 0;
        a.reasoningTokens += r.reasoningTokens || 0;
        a.totalTokens += r.totalTokens || 0;
      }
      a.cost += r.cost || 0;
      return a;
    }, acc);
    const total = sum({ calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, cost: 0 });
    total.cost = Math.round(total.cost * 1e4) / 1e4;

    const dailyMap = new Map();
    for (const r of rows) {
      const date = r.ts.slice(0, 10);
      const d = dailyMap.get(date) || { date, calls: 0, totalTokens: 0, cost: 0 };
      if (!isRefund(r)) { d.calls += 1; d.totalTokens += r.totalTokens || 0; }
      d.cost += r.cost || 0;
      dailyMap.set(date, d);
    }
    const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ ...d, cost: Math.round(d.cost * 1e4) / 1e4 }));

    const modelMap = new Map();
    for (const r of rows) {
      const m = r.model || 'unknown';
      const x = modelMap.get(m) || { model: m, calls: 0, totalTokens: 0, cost: 0 };
      if (!isRefund(r)) { x.calls += 1; x.totalTokens += r.totalTokens || 0; }
      x.cost += r.cost || 0;
      modelMap.set(m, x);
    }
    const byModel = [...modelMap.values()].sort((a, b) => b.cost - a.cost)
      .map(m => ({ ...m, cost: Math.round(m.cost * 1e4) / 1e4 }));

    return { total, daily, byModel, recent: rows.slice(0, 100) };
  },
};

export function makeProject(type, name) {
  const base = {
    id: uid(),
    type,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    episodes: [],
    characters: [],
    locations: [],
    props: [],
    relationships: [],
    advisorId: '',
    worldview: {},
    knowledge: [],
    assets: [],
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 1,
    versionHash: '',
    cover: {},
    viewLayouts: {},
    audioSessions: [],
    settings: { format: 'hollywood', language: 'zh', exportConvention: 'hollywood' },
  };
  if (type === 'script') {
    base.episodes = [{ id: uid(), title: '第 1 集', nodes: [], outline: [], beats: [], scenes: [], shots: [], revisionNotes: [], optionGroups: [] }];
  } else {
    base.episodes = [{ id: uid(), title: '第 1 集', reels: [] }];
    base.film = { orientation: 'landscape', productionType: 'live-action', cameraStyle: '', artStyle: '' };
  }
  base.versionHash = stableHash(base);
  return base;
}
