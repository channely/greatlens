// 科普叙事 DSL（virtual-scene-dsl/v1）的单一事实来源。
// 设计原则：LLM 只能产出受限 DSL 片段；所有校验在此确定性完成；幻觉引用在写库前被拦截。
// 本模块纯数据、无 I/O（generateDslFromNl 除外），可被测试直接 import。
import { settings, usage } from './store.js';
import { stableHash } from './migrations.js';

export const DSL_SCHEMA_ID = 'virtual-scene-dsl/v1';
export const BAD = (message, status = 422) => Object.assign(new Error(message), { status });
const isStub = () => process.env.GL_STUB_MODELS === '1';
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const ENUMS = {
  stylePreset: ['flat-science', 'warm-science', 'high-contrast'],
  environmentKind: ['static-image', 'deferred-worldmodel'],
  assetKind: ['character', 'prop'],
  assetSource: ['polyspoon', 'nvidia', 'local', 'procedural-fallback'],
  expression: ['neutral', 'happy', 'curious', 'surprised', 'serious'],
  knowledgeRole: ['narrator', 'subject', 'observer'],
  knowledgeState: ['introduced', 'active', 'resolved'],
  cameraType: ['perspective', 'ortho'],
  motionType: ['static', 'dolly-in', 'dolly-out', 'pan', 'orbit'],
};

const TOP_KEYS = ['$schema', 'meta', 'environment', 'assets', 'characters', 'knowledge', 'scenes', 'shots', 'dialogue', 'timeline'];
const ASSET_KEYS = ['id', 'kind', 'source', 'modelRef', 'controls', 'license', 'note'];
const CONTROL_KEYS = ['color', 'emissive', 'emissiveIntensity', 'scale', 'rotationY', 'visible'];
const CHARACTER_KEYS = ['id', 'name', 'assetId', 'voiceId', 'expression', 'position', 'rotationY', 'scale', 'knowledgeRole'];
const KNOWLEDGE_KEYS = ['id', 'label', 'statement', 'state', 'dependencies', 'introducedAtShotId', 'resolvedAtShotId', 'sourceRef'];
const SCENE_KEYS = ['id', 'name', 'environmentRef', 'characterRefs', 'durationSec'];
const CAMERA_KEYS = ['type', 'fov', 'position', 'lookAt', 'targetCharacterId', 'motion'];
const MOTION_KEYS = ['type', 'to', 'durationSec'];
const SHOT_KEYS = ['id', 'sceneId', 'order', 'durationSec', 'camera', 'dialogueRefs'];
const DIALOGUE_KEYS = ['id', 'characterId', 'text', 'startSec', 'durationSec', 'shotId', 'expression', 'knowledgeRefs'];

// ---- 通用小工具 ----
const num = (v, fallback = NaN) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const diag = (severity, code, message, path = '') => ({ severity, code, message, path });
function assertKeys(obj, allowed, where, diagnostics) {
  if (!isObj(obj)) { diagnostics.push(diag('error', 'TYPE', `${where} 必须是对象`, where)); return; }
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) diagnostics.push(diag('error', 'UNKNOWN_KEY', `${where} 含未知字段 ${k}`, `${where}.${k}`));
  }
}
function checkEnum(value, values, where, diagnostics) {
  if (!values.includes(value)) diagnostics.push(diag('error', 'ENUM', `${where} 必须是 ${values.join('/')} 之一，当前为 ${JSON.stringify(value)}`, where));
}
function checkId(id, where, diagnostics) {
  if (typeof id !== 'string' || !ID_RE.test(id)) diagnostics.push(diag('error', 'ID', `${where} 的 id 非法（须匹配 ${ID_RE}）：${JSON.stringify(id)}`, where));
}
function checkVec3(v, where, diagnostics) {
  if (!Array.isArray(v) || v.length !== 3 || v.some(x => !Number.isFinite(Number(x)))) {
    diagnostics.push(diag('error', 'VEC3', `${where} 必须是长度为 3 的数值数组`, where));
  }
}
function checkDuration(v, where, diagnostics, { min = 0, max = 300 } = {}) {
  const n = num(v, -1);
  if (n < min || n > max) diagnostics.push(diag('error', 'DURATION', `${where} 时长须在 ${min}~${max} 之间，当前 ${JSON.stringify(v)}`, where));
  return n;
}

// ---- 模板：30 秒「细胞器对话」----
export function organelleDialogueTemplate(seed = '') {
  const title = String(seed || '').trim().slice(0, 40) || '细胞器对话';
  return {
    $schema: DSL_SCHEMA_ID,
    meta: { id: 'cell-talk-01', title, durationSec: 30, language: 'zh', stylePreset: 'flat-science', fps: 30 },
    environment: {
      id: 'env-cell', kind: 'static-image', backgroundAssetRef: 'asset-bg-cell',
      note: '世界模型背景占位；MVP 用现有图像生成静态背景',
    },
    assets: [
      {
        id: 'asset-nucleus', kind: 'character', source: 'polyspoon',
        modelRef: { url: '/models/nucleus/asset.glb', controlsUrl: '/models/nucleus/asset.controls.json' },
        controls: { color: '#8b5cf6', emissive: '#4c1d95', scale: 1.0 }, license: 'Apache-2.0',
        note: '细胞核：控制中心',
      },
      {
        id: 'asset-mito', kind: 'character', source: 'polyspoon',
        modelRef: { url: '/models/mitochondrion/asset.glb', controlsUrl: '/models/mitochondrion/asset.controls.json' },
        controls: { color: '#ef4444', emissive: '#7f1d1d', scale: 0.9 }, license: 'Apache-2.0',
        note: '线粒体：能量工厂',
      },
      {
        id: 'asset-bg-cell', kind: 'prop', source: 'local',
        modelRef: { url: '/media/bg-cell.png' }, controls: {}, license: 'generated',
        note: '静态细胞内部环境背景（世界模型延迟）',
      },
    ],
    characters: [
      { id: 'ch-nucleus', name: '细胞核', assetId: 'asset-nucleus', voiceId: 'voice-narrator', expression: 'serious', position: [-1.2, 0, 0], rotationY: 0.3, scale: 1, knowledgeRole: 'narrator' },
      { id: 'ch-mito', name: '线粒体', assetId: 'asset-mito', voiceId: 'voice-mito', expression: 'happy', position: [1.4, 0, 0.2], rotationY: -0.4, scale: 0.9, knowledgeRole: 'subject' },
    ],
    knowledge: [
      { id: 'k-cellfactory', label: '细胞核是控制中心', statement: '细胞核储存遗传信息，指挥细胞的一切活动。', state: 'introduced', dependencies: [], introducedAtShotId: 'sh-1' },
      { id: 'k-energy', label: '线粒体供能', statement: '线粒体通过呼吸作用产生 ATP，为细胞提供能量。', state: 'resolved', dependencies: ['k-cellfactory'], introducedAtShotId: 'sh-2', resolvedAtShotId: 'sh-3' },
    ],
    scenes: [
      { id: 'sc-cell', name: '细胞内部', environmentRef: 'env-cell', characterRefs: ['ch-nucleus', 'ch-mito'], durationSec: 30 },
    ],
    shots: [
      { id: 'sh-1', sceneId: 'sc-cell', order: 0, durationSec: 8, camera: { type: 'perspective', fov: 45, position: [0, 1.6, 5], lookAt: [0, 0.6, 0], targetCharacterId: null, motion: { type: 'dolly-in', to: [0, 1.4, 3.4], durationSec: 8 } }, dialogueRefs: ['d-1'] },
      { id: 'sh-2', sceneId: 'sc-cell', order: 1, durationSec: 10, camera: { type: 'perspective', fov: 38, position: [2, 1.2, 4], lookAt: [1.4, 0.5, 0], targetCharacterId: 'ch-mito', motion: { type: 'static' } }, dialogueRefs: ['d-2'] },
      { id: 'sh-3', sceneId: 'sc-cell', order: 2, durationSec: 12, camera: { type: 'perspective', fov: 50, position: [0, 2, 6], lookAt: [0, 0.5, 0], targetCharacterId: null, motion: { type: 'orbit', to: [3, 2, 4], durationSec: 12 } }, dialogueRefs: ['d-3', 'd-4'] },
    ],
    dialogue: [
      { id: 'd-1', characterId: 'ch-nucleus', text: '我是细胞核，细胞的控制中心。', startSec: 0.5, durationSec: 6, shotId: 'sh-1', knowledgeRefs: ['k-cellfactory'] },
      { id: 'd-2', characterId: 'ch-mito', text: '我是线粒体，专门给细胞充电！', startSec: 8.5, durationSec: 8, shotId: 'sh-2', expression: 'happy', knowledgeRefs: ['k-energy'] },
      { id: 'd-3', characterId: 'ch-nucleus', text: '那能量到底是怎么来的？', startSec: 18, durationSec: 5, shotId: 'sh-3', knowledgeRefs: ['k-energy'] },
      { id: 'd-4', characterId: 'ch-mito', text: '我把营养和氧气变成 ATP，这就是细胞的能量货币。', startSec: 23, durationSec: 6, shotId: 'sh-3', knowledgeRefs: ['k-energy'] },
    ],
    timeline: { totalSec: 30, computedFrom: 'shots' },
  };
}
export const DSL_TEMPLATES = { 'organelle-dialogue': organelleDialogueTemplate };

// ---- 文本解析（去 fence、截取首尾大括号）----
export function parseDslText(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

// ---- 归一化：补默认值、收敛字段，供校验后写库 ----
export function normalizeDsl(raw) {
  if (!isObj(raw)) return raw;
  const d = JSON.parse(JSON.stringify(raw));
  d.$schema = DSL_SCHEMA_ID;
  d.meta = isObj(d.meta) ? d.meta : {};
  d.meta.language = String(d.meta.language || 'zh');
  d.meta.fps = [24, 30, 60].includes(num(d.meta.fps, 30)) ? num(d.meta.fps, 30) : 30;
  d.meta.durationSec = num(d.meta.durationSec, 30);
  d.meta.stylePreset = String(d.meta.stylePreset || 'flat-science');
  d.assets = Array.isArray(d.assets) ? d.assets : [];
  d.characters = Array.isArray(d.characters) ? d.characters : [];
  d.knowledge = Array.isArray(d.knowledge) ? d.knowledge : [];
  d.scenes = Array.isArray(d.scenes) ? d.scenes : [];
  d.shots = Array.isArray(d.shots) ? d.shots : [];
  d.dialogue = Array.isArray(d.dialogue) ? d.dialogue : [];
  for (const k of d.knowledge) k.dependencies = Array.isArray(k.dependencies) ? k.dependencies : [];
  for (const s of d.shots) {
    s.dialogueRefs = Array.isArray(s.dialogueRefs) ? s.dialogueRefs : [];
    if (isObj(s.camera)) {
      if (isObj(s.camera.motion) && !Array.isArray(s.camera.motion.to)) delete s.camera.motion.to;
    }
  }
  for (const dl of d.dialogue) dl.knowledgeRefs = Array.isArray(dl.knowledgeRefs) ? dl.knowledgeRefs : [];
  return d;
}

// ---- 核心校验：返回 {ok, dsl, diagnostics}；error 级 diagnostics 阻断写库 ----
export function validateDsl(input, registry = null) {
  const diagnostics = [];
  if (!isObj(input)) return { ok: false, dsl: null, diagnostics: [diag('error', 'TYPE', 'DSL 根节点必须是对象')] };
  const dsl = normalizeDsl(input);

  // 1. schema id + 顶层白名单
  if (dsl.$schema !== DSL_SCHEMA_ID) diagnostics.push(diag('error', 'SCHEMA', `$schema 必须为 ${DSL_SCHEMA_ID}`));
  assertKeys(dsl, TOP_KEYS, 'root', diagnostics);
  assertKeys(dsl.meta, ['id', 'title', 'durationSec', 'language', 'stylePreset', 'fps'], 'meta', diagnostics);
  checkId(dsl.meta.id, 'meta.id', diagnostics);
  checkEnum(dsl.meta.stylePreset, ENUMS.stylePreset, 'meta.stylePreset', diagnostics);
  checkDuration(dsl.meta.durationSec, 'meta.durationSec', diagnostics, { min: 1, max: 300 });

  // 2. environment
  if (dsl.environment != null) {
    assertKeys(dsl.environment, ['id', 'kind', 'backgroundAssetRef', 'note'], 'environment', diagnostics);
    checkId(dsl.environment.id, 'environment.id', diagnostics);
    checkEnum(dsl.environment.kind, ENUMS.environmentKind, 'environment.kind', diagnostics);
    if (dsl.environment.kind === 'deferred-worldmodel') {
      diagnostics.push(diag('warning', 'DEFERRED', 'environment.kind=deferred-worldmodel 在 MVP 不渲染，仅占位'));
    }
  }

  // 3. ID 全局唯一
  const ids = new Map();
  const register = (id, where) => {
    if (typeof id !== 'string') return;
    checkId(id, where, diagnostics);
    if (ids.has(id)) diagnostics.push(diag('error', 'DUP_ID', `id ${id} 重复（${ids.get(id)} 与 ${where}）`, where));
    else ids.set(id, where);
  };
  register(dsl.meta.id, 'meta.id');
  if (dsl.environment) register(dsl.environment.id, 'environment.id');

  // 4. assets
  const assetIds = new Set();
  for (let i = 0; i < dsl.assets.length; i++) {
    const a = dsl.assets[i], w = `assets[${i}]`;
    assertKeys(a, ASSET_KEYS, w, diagnostics);
    register(a.id, `${w}.id`); assetIds.add(a.id);
    checkEnum(a.kind, ENUMS.assetKind, `${w}.kind`, diagnostics);
    checkEnum(a.source, ENUMS.assetSource, `${w}.source`, diagnostics);
    if (!isObj(a.modelRef) || !a.modelRef.url) diagnostics.push(diag('error', 'MODEL_REF', `${w}.modelRef.url 缺失`, `${w}.modelRef`));
    if (a.controls) {
      assertKeys(a.controls, CONTROL_KEYS, `${w}.controls`, diagnostics);
      if (a.controls.color != null && !/^#[0-9a-fA-F]{3,8}$/.test(String(a.controls.color))) diagnostics.push(diag('error', 'COLOR', `${w}.controls.color 须为 #RRGGBB`, `${w}.controls.color`));
      if (a.controls.scale != null && num(a.controls.scale, -1) <= 0) diagnostics.push(diag('error', 'SCALE', `${w}.controls.scale 须 > 0`, `${w}.controls.scale`));
    }
    // registry 白名单：若提供，则 GLB URL 必须来自清单（防幻觉资源）
    if (registry && Array.isArray(registry.allowedUrls) && a.modelRef?.url && !registry.allowedUrls.includes(a.modelRef.url)) {
      diagnostics.push(diag('error', 'UNKNOWN_ASSET', `${w}.modelRef.url "${a.modelRef.url}" 不在资产白名单（疑似幻觉引用）`, `${w}.modelRef.url`));
    }
  }

  // 5. characters
  const charIds = new Set();
  for (let i = 0; i < dsl.characters.length; i++) {
    const c = dsl.characters[i], w = `characters[${i}]`;
    assertKeys(c, CHARACTER_KEYS, w, diagnostics);
    register(c.id, `${w}.id`); charIds.add(c.id);
    if (!assetIds.has(c.assetId)) diagnostics.push(diag('error', 'REF', `${w}.assetId "${c.assetId}" 未声明（疑似幻觉引用）`, `${w}.assetId`));
    checkEnum(c.expression, ENUMS.expression, `${w}.expression`, diagnostics);
    checkEnum(c.knowledgeRole, ENUMS.knowledgeRole, `${w}.knowledgeRole`, diagnostics);
    checkVec3(c.position, `${w}.position`, diagnostics);
  }

  // 6. knowledge + 状态机 + DAG
  const knowIds = new Set();
  const knowMap = new Map();
  for (let i = 0; i < dsl.knowledge.length; i++) {
    const k = dsl.knowledge[i], w = `knowledge[${i}]`;
    assertKeys(k, KNOWLEDGE_KEYS, w, diagnostics);
    register(k.id, `${w}.id`); knowIds.add(k.id); knowMap.set(k.id, k);
    checkEnum(k.state, ENUMS.knowledgeState, `${w}.state`, diagnostics);
  }
  for (let i = 0; i < dsl.knowledge.length; i++) {
    const k = dsl.knowledge[i], w = `knowledge[${i}]`;
    for (const dep of k.dependencies) {
      if (!knowIds.has(dep)) diagnostics.push(diag('error', 'REF', `${w}.dependencies 含未声明的 ${dep}（疑似幻觉引用）`, `${w}.dependencies`));
    }
    // 状态顺序：依赖知识点必须在本条之前声明/引入（按 declared order 近似时间序）。
    // 科普叙事中依赖只需已 introduced 即可，不要求先 resolved（如"细胞核控制"引入后支撑"线粒体供能"）。
    const selfIdx = i;
    if (k.state === 'resolved' || k.state === 'active') {
      for (const dep of k.dependencies) {
        const depObj = knowMap.get(dep);
        if (!depObj) continue;
        const depIdx = dsl.knowledge.indexOf(depObj);
        if (depIdx > selfIdx) diagnostics.push(diag('error', 'KNOWLEDGE_ORDER', `${w} 依赖 ${dep} 却先于本条声明/引入`, `${w}.dependencies`));
      }
    }
  }

  // 7. scenes
  const sceneIds = new Set();
  for (let i = 0; i < dsl.scenes.length; i++) {
    const s = dsl.scenes[i], w = `scenes[${i}]`;
    assertKeys(s, SCENE_KEYS, w, diagnostics);
    register(s.id, `${w}.id`); sceneIds.add(s.id);
    if (dsl.environment && s.environmentRef !== dsl.environment.id) diagnostics.push(diag('error', 'REF', `${w}.environmentRef 不匹配 environment.id`, `${w}.environmentRef`));
    for (const cr of s.characterRefs) if (!charIds.has(cr)) diagnostics.push(diag('error', 'REF', `${w}.characterRefs 含未声明的 ${cr}（疑似幻觉引用）`, `${w}.characterRefs`));
  }

  // 8. shots + 时间闭包
  const shotIds = new Set();
  const shotWindows = new Map();
  let cursor = 0;
  const orderedShots = [...dsl.shots].sort((a, b) => num(a.order, 0) - num(b.order, 0));
  for (let i = 0; i < orderedShots.length; i++) {
    const s = orderedShots[i], w = `shots[${i}]`;
    assertKeys(s, SHOT_KEYS, w, diagnostics);
    register(s.id, `${w}.id`); shotIds.add(s.id);
    if (!sceneIds.has(s.sceneId)) diagnostics.push(diag('error', 'REF', `${w}.sceneId "${s.sceneId}" 未声明（疑似幻觉引用）`, `${w}.sceneId`));
    const dur = checkDuration(s.durationSec, `${w}.durationSec`, diagnostics, { min: 0.1, max: 300 });
    shotWindows.set(s.id, { start: cursor, end: cursor + (dur > 0 ? dur : 0) });
    cursor += (dur > 0 ? dur : 0);
    const cam = s.camera;
    if (!isObj(cam)) { diagnostics.push(diag('error', 'TYPE', `${w}.camera 缺失`, `${w}.camera`)); continue; }
    assertKeys(cam, CAMERA_KEYS, `${w}.camera`, diagnostics);
    checkEnum(cam.type, ENUMS.cameraType, `${w}.camera.type`, diagnostics);
    if (cam.type === 'perspective') {
      const fov = num(cam.fov, -1);
      if (fov < 10 || fov > 120) diagnostics.push(diag('error', 'FOV', `${w}.camera.fov 须在 10~120`, `${w}.camera.fov`));
    }
    checkVec3(cam.position, `${w}.camera.position`, diagnostics);
    if (cam.lookAt != null) checkVec3(cam.lookAt, `${w}.camera.lookAt`, diagnostics);
    if (cam.targetCharacterId != null && !charIds.has(cam.targetCharacterId)) diagnostics.push(diag('error', 'REF', `${w}.camera.targetCharacterId 未声明（疑似幻觉引用）`, `${w}.camera.targetCharacterId`));
    const m = cam.motion;
    if (!isObj(m)) { diagnostics.push(diag('error', 'TYPE', `${w}.camera.motion 缺失`, `${w}.camera.motion`)); continue; }
    assertKeys(m, MOTION_KEYS, `${w}.camera.motion`, diagnostics);
    checkEnum(m.type, ENUMS.motionType, `${w}.camera.motion.type`, diagnostics);
    if (m.type !== 'static') checkVec3(m.to, `${w}.camera.motion.to`, diagnostics);
  }
  const total = num(dsl.meta.durationSec, 0);
  if (Math.abs(cursor - total) > 0.5) diagnostics.push(diag('error', 'TIMELINE', `镜头时长之和 ${cursor.toFixed(1)}s 与 meta.durationSec ${total}s 不一致（差须 ≤0.5s）`, 'meta.durationSec'));

  // 9. dialogue + 时间窗
  for (let i = 0; i < dsl.dialogue.length; i++) {
    const dl = dsl.dialogue[i], w = `dialogue[${i}]`;
    assertKeys(dl, DIALOGUE_KEYS, w, diagnostics);
    register(dl.id, `${w}.id`);
    if (!charIds.has(dl.characterId)) diagnostics.push(diag('error', 'REF', `${w}.characterId "${dl.characterId}" 未声明（疑似幻觉引用）`, `${w}.characterId`));
    const win = shotWindows.get(dl.shotId);
    if (!win) diagnostics.push(diag('error', 'REF', `${w}.shotId "${dl.shotId}" 未声明（疑似幻觉引用）`, `${w}.shotId`));
    const st = num(dl.startSec, -1), dd = num(dl.durationSec, -1);
    if (st < 0 || dd <= 0) diagnostics.push(diag('error', 'DURATION', `${w} startSec/durationSec 非法`, w));
    if (win && (st < win.start - 0.01 || st + dd > win.end + 0.01)) {
      diagnostics.push(diag('error', 'TIME_WINDOW', `${w} 时间 [${st}, ${st + dd}] 越出镜头 ${dl.shotId} 的窗口 [${win.start}, ${win.end}]`, w));
    }
    if (dl.expression != null) checkEnum(dl.expression, ENUMS.expression, `${w}.expression`, diagnostics);
    for (const kr of dl.knowledgeRefs) if (!knowIds.has(kr)) diagnostics.push(diag('error', 'REF', `${w}.knowledgeRefs 含未声明的 ${kr}（疑似幻觉引用）`, `${w}.knowledgeRefs`));
    // 对白引用知识点时，该点必须在镜头时间窗起点前已 introduced（按 declared order）
    for (const kr of dl.knowledgeRefs) {
      const k = knowMap.get(kr);
      if (!k || k.state !== 'introduced') continue;
      const introIdx = dsl.knowledge.findIndex(x => x.id === kr);
      const introShot = k.introducedAtShotId;
      if (introShot && win) {
        const introWin = shotWindows.get(introShot);
        if (introWin && win.start < introWin.start) {
          diagnostics.push(diag('error', 'KNOWLEDGE_ORDER', `${w} 在知识点 ${kr} 引入之前就引用了它`, `${w}.knowledgeRefs`));
        }
      }
      void introIdx;
    }
  }

  // 10. timeline 只能等于计算值
  if (!isObj(dsl.timeline)) diagnostics.push(diag('error', 'TYPE', 'timeline 缺失'));
  else {
    assertKeys(dsl.timeline, ['totalSec', 'computedFrom'], 'timeline', diagnostics);
    if (dsl.timeline.computedFrom !== 'shots') diagnostics.push(diag('error', 'TIMELINE', 'timeline.computedFrom 必须为 shots'));
    if (Math.abs(num(dsl.timeline.totalSec, -1) - cursor) > 0.01) diagnostics.push(diag('error', 'TIMELINE', `timeline.totalSec 应等于镜头时长之和 ${cursor.toFixed(1)}`));
  }

  const ok = !diagnostics.some(x => x.severity === 'error');
  return { ok, dsl: ok ? dsl : null, diagnostics };
}

// ---- 局部 patch：按稳定 ID 定位，原子应用；IP 锁字段拒绝 ----
export function applyPatches(dsl, patches, ipLocks = []) {
  const results = [];
  if (!Array.isArray(patches)) return { dsl, results: [diag('error', 'PATCH', 'patches 必须是数组')] };
  const next = isObj(dsl) ? JSON.parse(JSON.stringify(dsl)) : null;
  if (!next) return { dsl, results: [diag('error', 'PATCH', '当前 DSL 不存在，无法 patch')] };

  const collections = ['assets', 'characters', 'knowledge', 'scenes', 'shots', 'dialogue'];
  const findById = id => {
    for (const col of collections) {
      const idx = (next[col] || []).findIndex(x => x.id === id);
      if (idx >= 0) return { col, idx, obj: next[col][idx] };
    }
    if (next.environment?.id === id) return { col: 'environment', idx: -1, obj: next.environment };
    if (next.meta?.id === id) return { col: 'meta', idx: -1, obj: next.meta };
    return null;
  };
  const setPath = (obj, path, value) => {
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (cur == null || !(key in cur)) return false;
      cur = cur[key];
    }
    const last = parts[parts.length - 1];
    if (cur == null || !(last in cur)) return false;
    cur[last] = value;
    return true;
  };

  for (const p of patches) {
    if (!isObj(p) || p.op !== 'set' || !p.targetId || !p.path) {
      results.push(diag('error', 'PATCH', 'patch 须为 {op:"set", targetId, path, value}')); continue;
    }
    const locked = (ipLocks || []).some(l => l.locked && l.refId === p.targetId && (l.path ? l.path === p.path : true));
    if (locked) { results.push(diag('error', 'IP_LOCK', `字段 ${p.targetId}.${p.path} 被 IP 锁保护`, p.path)); continue; }
    const found = findById(p.targetId);
    if (!found) { results.push(diag('error', 'PATCH', `targetId ${p.targetId} 不存在`, p.path)); continue; }
    if (!setPath(found.obj, p.path, p.value)) { results.push(diag('error', 'PATCH', `path ${p.path} 在 ${p.targetId} 上不存在`, p.path)); continue; }
    results.push(diag('info', 'OK', `已更新 ${p.targetId}.${p.path}`, p.path));
  }
  const anyError = results.some(r => r.severity === 'error');
  if (anyError) return { dsl, results }; // 原子：任一失败，整批不生效
  const check = validateDsl(next);
  if (!check.ok) return { dsl, results: [...results, ...check.diagnostics.filter(x => x.severity === 'error')] };
  return { dsl: next, results };
}

export function dslHash(dsl) {
  return stableHash(dsl);
}

// ---- LLM system prompt（JSON-only + 白名单注入）----
export function buildDslSystemPrompt(registry = {}) {
  const assets = (registry.assets || []).map(a => `${a.id}(${a.kind},${a.source})`).join(', ') || '（无预置资产，请用模板中的细胞器资产 id）';
  const voices = (registry.voices || []).join(', ') || 'voice-narrator, voice-mito';
  return `你是科普短视频的“叙事 DSL 编译器”，为浏览器内的 Three.js 虚拟制片导演台输出结构化场景描述。
只输出一个符合 virtual-scene-dsl/v1 的 JSON 对象，不要 markdown、不要解释、不要注释。
硬性规则：
- $schema 固定为 "${DSL_SCHEMA_ID}"。
- meta.durationSec 为总秒数（≤30）；shots 的 durationSec 之和必须等于它；timeline.totalSec 也等于它，computedFrom 固定 "shots"。
- 只能引用下面白名单中出现的资产 id 与音色 id，禁止编造任何 id（编造的引用会被服务端拒绝）：
  资产白名单：${assets}
  音色白名单：${voices}
- knowledge 的知识点状态只能是 introduced/active/resolved；dependencies 必须指向已声明知识点；先 introduced 再 resolved。
- 每条 dialogue 的 shotId 必须存在，startSec/durationSec 必须落在该镜头时间窗内；knowledgeRefs 必须指向已声明知识点。
- characters 的 assetId 必须来自资产白名单；position 是 [x,y,z] 数值数组。
- 参考骨架（30秒、3镜、细胞器对话）：${JSON.stringify(organelleDialogueTemplate()).slice(0, 2600)}
用中文写文本字段，保持科普、轻松、准确的风格。`;
}

// ---- NL → DSL（复用 idea.js 自定义 fetch 模式，避免剧本 system 污染）----
export async function generateDslFromNl({ seed, registry = {}, brief = {} } = {}) {
  const local = organelleDialogueTemplate(brief.title || seed || '');
  const cfg = settings.get();
  if (isStub() || !cfg.apiKey || !cfg.baseUrl || !String(seed || '').trim()) {
    const v = validateDsl(local, registry);
    return { dsl: v.dsl || local, source: 'local', diagnostics: v.diagnostics };
  }
  const base = String(cfg.baseUrl).replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model || 'qwen4-max',
        messages: [
          { role: 'system', content: buildDslSystemPrompt(registry) },
          { role: 'user', content: `请把这个创意编译成科普叙事 DSL（≤30秒）：\n${String(seed).trim()}` },
        ],
        temperature: 0.6,
      }),
    });
    if (!res.ok) { const v = validateDsl(local, registry); return { dsl: v.dsl || local, source: 'local', diagnostics: [...v.diagnostics, diag('warning', 'LLM_HTTP', `模型返回 ${res.status}，已用本地模板兜底`)] }; }
    const json = await res.json();
    const parsed = parseDslText(json?.choices?.[0]?.message?.content);
    if (json.usage) {
      try {
        usage.add({
          type: 'chat', model: cfg.model || 'qwen4-max', mode: 'virtual-dsl', scope: 'virtual',
          detail: { purpose: '科普叙事 DSL 生成' },
          promptTokens: json.usage.prompt_tokens ?? json.usage.input_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? json.usage.output_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        });
      } catch {}
    }
    if (!parsed) { const v = validateDsl(local, registry); return { dsl: v.dsl || local, source: 'local', diagnostics: [...v.diagnostics, diag('warning', 'LLM_PARSE', '模型输出无法解析为 JSON，已用本地模板兜底')] }; }
    const check = validateDsl(parsed, registry);
    if (!check.ok) {
      const v = validateDsl(local, registry);
      return { dsl: v.dsl || local, source: 'local', diagnostics: [...check.diagnostics, diag('warning', 'LLM_REJECTED', '模型输出未通过校验（幻觉/时序错误），已用本地模板兜底')] };
    }
    return { dsl: check.dsl, source: 'ai', diagnostics: check.diagnostics };
  } catch (e) {
    const v = validateDsl(local, registry);
    return { dsl: v.dsl || local, source: 'local', diagnostics: [...v.diagnostics, diag('warning', 'LLM_ERROR', `模型调用失败（${e.message}），已用本地模板兜底`)] };
  } finally { clearTimeout(timer); }
}

export function localDslFallback(seed) { return organelleDialogueTemplate(seed); }
