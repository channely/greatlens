import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const ASSETS_DIR = path.join(DATA_DIR, 'assets');
export const DB_PATH = path.join(DATA_DIR, 'db.json');
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

// 百炼华北2（北京）：qwen4-max 输入 ¥10/百万 token，输出 ¥30/百万 token（思维链计入输出）
const DEFAULT_SETTINGS = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen4-max',
  temperature: 1,
  enableThinking: true,
  priceInput: 10,
  priceOutput: 30,
  imageUnitPrice: 0.2,
  videoUnitPrice: 0.5,
  mediaBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  imageModel: 'qwen-image-3.0-pro',
  videoModel: 'wan2.7-t2v',
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
  if (!fs.existsSync(DB_PATH)) write(DB_PATH, { projects: [], tasks: [], usage: [], assets: [] });
  const d = read(DB_PATH) || {};
  let changed = false;
  for (const k of ['projects', 'tasks', 'usage', 'assets']) {
    if (!Array.isArray(d[k])) { d[k] = []; changed = true; }
  }
  if (changed) write(DB_PATH, d);
  if (!fs.existsSync(SETTINGS_PATH)) {
    write(SETTINGS_PATH, { ...DEFAULT_SETTINGS });
  } else {
    const s = read(SETTINGS_PATH) || {};
    let ch = false;
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      if (s[k] === undefined) { s[k] = v; ch = true; }
    }
    if (ch) write(SETTINGS_PATH, s);
  }
}
ensure();

export const uid = () => crypto.randomUUID();

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
  clear() { db.update(d => { d.usage = []; }); },
  report(days = 30) {
    const all = db.all().usage;
    const since = Date.now() - (Number(days) || 30) * 86400000;
    const rows = all.filter(r => new Date(r.ts).getTime() >= since);
    const sum = acc => rows.reduce((a, r) => {
      a.calls += 1;
      a.promptTokens += r.promptTokens || 0;
      a.completionTokens += r.completionTokens || 0;
      a.reasoningTokens += r.reasoningTokens || 0;
      a.totalTokens += r.totalTokens || 0;
      a.cost += r.cost || 0;
      return a;
    }, acc);
    const total = sum({ calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0, cost: 0 });
    total.cost = Math.round(total.cost * 1e4) / 1e4;

    const dailyMap = new Map();
    for (const r of rows) {
      const date = r.ts.slice(0, 10);
      const d = dailyMap.get(date) || { date, calls: 0, totalTokens: 0, cost: 0 };
      d.calls += 1; d.totalTokens += r.totalTokens || 0; d.cost += r.cost || 0;
      dailyMap.set(date, d);
    }
    const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ ...d, cost: Math.round(d.cost * 1e4) / 1e4 }));

    const modelMap = new Map();
    for (const r of rows) {
      const m = r.model || 'unknown';
      const x = modelMap.get(m) || { model: m, calls: 0, totalTokens: 0, cost: 0 };
      x.calls += 1; x.totalTokens += r.totalTokens || 0; x.cost += r.cost || 0;
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
    worldview: {},
    knowledge: [],
    assets: [],
    settings: { format: 'hollywood', language: 'zh' },
  };
  if (type === 'script') {
    base.episodes = [{ id: uid(), title: '第 1 集', nodes: [], outline: [], beats: [], scenes: [], shots: [] }];
  } else {
    base.episodes = [{ id: uid(), title: '第 1 集', reels: [] }];
    base.film = { orientation: 'landscape', productionType: 'live-action', cameraStyle: '', artStyle: '' };
  }
  return base;
}
