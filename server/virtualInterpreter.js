// 确定性 DSL 解释器：把已校验的 DSL 编译为场景图 + 时间轴 + 知识状态。
// 纯函数，无 I/O、无副作用、无动态代码；相同输入必得相同 hash。
import { validateDsl, dslHash, ENUMS } from './virtualDsl.js';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, f = NaN) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const diag = (severity, code, message, path = '') => ({ severity, code, message, path });

// 计算镜头时间窗与对白排布（唯一时间真相）
export function computeTimeline(dsl) {
  const shots = [];
  let cursor = 0;
  const ordered = [...(dsl.shots || [])].sort((a, b) => num(a.order, 0) - num(b.order, 0));
  for (const s of ordered) {
    const dur = num(s.durationSec, 0);
    shots.push({ id: s.id, order: num(s.order, 0), startSec: cursor, endSec: cursor + dur, durationSec: dur, sceneId: s.sceneId });
    cursor += dur;
  }
  const dialogue = (dsl.dialogue || []).map(d => ({
    id: d.id, characterId: d.characterId, shotId: d.shotId,
    startSec: num(d.startSec, 0), endSec: num(d.startSec, 0) + num(d.durationSec, 0),
    text: String(d.text || ''), expression: d.expression || 'neutral', knowledgeRefs: [...(d.knowledgeRefs || [])],
  }));
  return { totalSec: cursor, shots, dialogue };
}

// 知识状态机：仅允许 introduced → active → resolved
export function advanceKnowledge(state, event) {
  const order = ENUMS.knowledgeState;
  const cur = state?.state || 'introduced';
  const to = event?.to;
  if (!order.includes(to)) return { ok: false, error: `非法目标状态 ${to}`, state };
  const fromIdx = order.indexOf(cur), toIdx = order.indexOf(to);
  if (toIdx < fromIdx) return { ok: false, error: `不允许从 ${cur} 回退到 ${to}`, state };
  if (toIdx === fromIdx) return { ok: true, state };
  return { ok: true, state: { ...state, state: to, lastTransition: { from: cur, to, at: event.at || new Date().toISOString(), shotId: event.shotId || null, by: event.by || 'user' } } };
}

export function validateSceneGraph(sceneGraph) {
  const out = [];
  if (!sceneGraph || !Array.isArray(sceneGraph.nodes)) out.push(diag('error', 'GRAPH', 'sceneGraph.nodes 缺失'));
  else {
    const ids = new Set();
    for (const n of sceneGraph.nodes) {
      if (!n.id || ids.has(n.id)) out.push(diag('error', 'GRAPH', `场景节点 id 缺失或重复：${n.id}`));
      ids.add(n.id);
      if (!['environment', 'character', 'prop', 'group'].includes(n.kind)) out.push(diag('error', 'GRAPH', `未知节点类型 ${n.kind}`));
      if (n.kind === 'character' && (!n.assetId || !n.assetUrl)) out.push(diag('error', 'GRAPH', `角色 ${n.id} 缺少 assetId/assetUrl`));
    }
  }
  return out;
}

// 主编译入口：dsl → {sceneGraph, timeline, knowledgeState, diagnostics, hash}
export function compileDsl(input, registry = null) {
  const check = validateDsl(input, registry);
  if (!check.ok) {
    return {
      sceneGraph: { nodes: [] }, timeline: { totalSec: 0, shots: [], dialogue: [] },
      knowledgeState: { facts: [], transitions: [] },
      diagnostics: check.diagnostics, hash: '', ok: false,
    };
  }
  const dsl = check.dsl;
  const timeline = computeTimeline(dsl);
  const assetById = new Map((dsl.assets || []).map(a => [a.id, a]));

  // 场景图：environment 作为根节点属性，角色/道具作为节点
  const nodes = [];
  nodes.push({
    id: dsl.environment?.id || 'env-default',
    kind: 'environment',
    assetRef: dsl.environment?.backgroundAssetRef || null,
    mode: dsl.environment?.kind || 'static-image',
    note: dsl.environment?.note || '',
  });
  for (const c of dsl.characters || []) {
    const asset = assetById.get(c.assetId);
    nodes.push({
      id: c.id, kind: 'character', name: c.name, assetId: c.assetId,
      assetUrl: asset?.modelRef?.url || null,
      controlsUrl: asset?.modelRef?.controlsUrl || null,
      controls: { ...(asset?.controls || {}) },
      expression: c.expression || 'neutral',
      transform: { position: [...(c.position || [0, 0, 0])], rotationY: num(c.rotationY, 0), scale: num(c.scale, 1) },
      voiceId: c.voiceId || '', knowledgeRole: c.knowledgeRole || 'observer',
    });
  }
  // props（非角色资产）也进场景图，便于后续扩展道具
  for (const a of dsl.assets || []) {
    if (a.kind !== 'prop' || String(a.modelRef?.url || '').endsWith('.png') || String(a.modelRef?.url || '').endsWith('.jpg')) continue;
    nodes.push({
      id: a.id, kind: 'prop', assetId: a.id, assetUrl: a.modelRef?.url || null,
      controls: { ...(a.controls || {}) }, transform: { position: [0, 0, 0], rotationY: 0, scale: num(a.controls?.scale, 1) },
    });
  }
  const sceneGraph = { nodes, scenes: (dsl.scenes || []).map(s => ({ ...s })) };
  const graphDiag = validateSceneGraph(sceneGraph);

  // 知识状态：facts 从 DSL 投影，transitions 空（由导演台操作生成）
  const knowledgeState = {
    facts: (dsl.knowledge || []).map(k => ({
      id: k.id, label: k.label, statement: k.statement, state: k.state,
      dependencies: [...(k.dependencies || [])],
      introducedAtShotId: k.introducedAtShotId || null,
      resolvedAtShotId: k.resolvedAtShotId || null,
    })),
    transitions: [],
  };

  const diagnostics = [...check.diagnostics, ...graphDiag];
  const hash = dslHash({ sceneGraph, timeline, knowledgeState });
  return { sceneGraph, timeline, knowledgeState, diagnostics, hash, ok: !diagnostics.some(d => d.severity === 'error') };
}
