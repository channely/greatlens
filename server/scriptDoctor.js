// Script Doctor 与结构化 AI 动作：诊断 → 处方 → 显式采纳。
// 本实现使用确定性本地提案器，不调用外部模型；所有写入按稳定节点 ID 重定位并 fail closed。
import crypto from 'node:crypto';
import { db } from './store.js';
import { stableHash } from './migrations.js';
import { autoVersionForSave } from './versions.js';

const uid = () => crypto.randomUUID();
const bad = (message, status = 422) => Object.assign(new Error(message), { status });

function findEpisode(project, episodeId) {
  return (project.episodes || []).find(e => e.id === episodeId) || (project.episodes || [])[0];
}

function makeToken(projectId, revision, diagnosis) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ projectId, revision, diagnosis }))
    .digest('hex')
    .slice(0, 16);
}

export function diagnose(project, episodeId) {
  const ep = findEpisode(project, episodeId);
  const nodes = ep?.nodes || [];
  const longActions = nodes.filter(n => n.type === 'action' && String(n.text || '').length > 180);
  const longDialogue = nodes.filter(n => n.type === 'dialogue' && String(n.text || '').length > 120);
  const scenes = nodes.filter(n => n.type === 'scene');

  const rootCause = longActions.length
    ? '动作段落承载了过多镜头决策，读者难以判断哪一件事先发生。'
    : longDialogue.length
      ? '对白长度超过一个表演节拍，潜台词被解释性文字稀释。'
      : scenes.length < 2
        ? '场景功能过于集中，转折缺少空间上的重新落点。'
        : '结构与人物意图已经基本对齐，剩余问题集中在节奏微调。';

  const evidence = [];
  if (longActions[0]) evidence.push({ nodeId: longActions[0].id, type: 'action', chars: String(longActions[0].text).length, text: String(longActions[0].text).slice(0, 80) });
  if (longDialogue[0]) evidence.push({ nodeId: longDialogue[0].id, type: 'dialogue', chars: String(longDialogue[0].text).length, text: String(longDialogue[0].text).slice(0, 80) });
  if (!evidence.length) evidence.push({ nodeId: nodes[0]?.id || '', type: scenes.length ? 'scene' : 'empty', chars: nodes.length, text: `共 ${nodes.length} 个语义节点、${scenes.length} 个场景标题` });

  return {
    rootCause,
    location: longActions[0]?.id || longDialogue[0]?.id || scenes[0]?.id || nodes[0]?.id || null,
    evidence,
    lens: '结构 / 场次功能 / 可拍摄性',
  };
}

export function prescribe(project, episodeId, diagnosis, token) {
  const expected = makeToken(project.id, project.revision, diagnosis);
  if (!token || token !== expected) throw bad('请先完成诊断并携带有效 diagnosisToken，不能直接开处方。', 428);

  const ep = findEpisode(project, episodeId);
  const nodes = ep?.nodes || [];
  const actions = [];
  const target = nodes.find(n => n.id === diagnosis.location) || nodes[nodes.length - 1];
  if (!target) return { diagnosis, actions: [], confidence: 0.2, note: '当前没有可定位的语义节点，请先写入剧本。' };

  if (target.type === 'action' && String(target.text || '').length > 180) {
    actions.push({
      op: 'insert_after',
      targetNodeId: target.id,
      anchorNodeId: target.id,
      expectedText: target.text,
      payload: { nodes: [{ type: 'comment', text: '医生建议：把这段动作拆成「进入」与「发现」两个可拍动作。' }] },
      protectIntent: '不改写原文字，只插入一条可删除的批注',
      priority: 'high',
    });
  } else if (target.type === 'dialogue' && String(target.text || '').length > 120) {
    actions.push({
      op: 'insert_after',
      targetNodeId: target.id,
      anchorNodeId: target.id,
      expectedText: target.text,
      payload: { nodes: [{ type: 'comment', text: '医生建议：把解释性句子移入动作，让对白只留潜台词。' }] },
      protectIntent: '保留原对白，只插入一条可删除的批注',
      priority: 'high',
    });
  } else {
    actions.push({
      op: 'insert_after',
      targetNodeId: target.id,
      anchorNodeId: target.id,
      expectedText: target.text,
      payload: { nodes: [{ type: 'comment', text: '医生建议：在本场结尾增加一个可见决定，让转折有落点。' }] },
      protectIntent: '不改变既有台词与动作',
      priority: 'medium',
    });
  }

  return { diagnosis, actions, confidence: 0.72 };
}

function locateNode(ep, action) {
  const idx = (ep.nodes || []).findIndex(n => n.id === action.targetNodeId);
  if (idx < 0) throw bad(`目标节点不存在：${action.targetNodeId || '空'}。请重新诊断后再采纳。`, 409);
  const node = ep.nodes[idx];
  if (action.expectedText !== undefined && String(node.text || '') !== String(action.expectedText)) {
    throw bad('目标节点内容已变化，处方已失效。请重新诊断。', 422);
  }
  return { idx, node };
}

export function applyActions(project, episodeId, actions) {
  if (!Array.isArray(actions) || !actions.length) throw bad('没有可采纳的动作');
  const ep = findEpisode(project, episodeId);
  if (!ep) throw bad('剧集不存在', 404);
  if (!Array.isArray(ep.nodes)) ep.nodes = [];

  for (const action of actions) {
    const { idx, node } = locateNode(ep, action);
    switch (action.op) {
      case 'replace_node_text':
        node.text = String(action.payload?.text ?? '');
        break;
      case 'insert_after': {
        const inserts = Array.isArray(action.payload?.nodes) ? action.payload.nodes : [];
        if (!inserts.length) throw bad('insert_after 缺少 payload.nodes');
        const normalized = inserts.map(n => ({
          id: String(n.id || uid()),
          type: String(n.type || 'action'),
          text: String(n.text || ''),
        }));
        ep.nodes.splice(idx + 1, 0, ...normalized);
        break;
      }
      case 'delete_node':
        ep.nodes.splice(idx, 1);
        break;
      case 'replace_char_range': {
        const start = Number(action.payload?.start);
        const end = Number(action.payload?.end);
        const text = String(node.text || '');
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
          throw bad('字符范围越界，已拒绝采纳。');
        }
        node.text = text.slice(0, start) + String(action.payload?.text ?? '') + text.slice(end);
        break;
      }
      default:
        throw bad(`未知动作：${action.op}`);
    }
  }
  return ep;
}

export function planAct(body = {}) {
  const d = db.all();
  const project = d.projects.find(p => p.id === body.projectId);
  if (!project) throw bad('项目不存在', 404);
  const episodeId = body.episodeId || project.episodes?.[0]?.id;
  const mode = String(body.mode || (Array.isArray(body.actions) ? 'proposal' : 'doctor-prescribe'));

  if (mode === 'doctor-prescribe') {
    const envelope = { stage: 'prescription', ...prescribe(project, episodeId, body.diagnosis || diagnose(project, episodeId), body.diagnosisToken) };
    return { project, episodeId, body, envelope };
  }

  if (mode === 'doctor-diagnose' || !body.actions) {
    const diag = diagnose(project, episodeId);
    const token = makeToken(project.id, project.revision, diag);
    const envelope = { stage: 'diagnosis', diagnosis: diag, diagnosisToken: token, actions: [], confidence: 0.68 };
    return { project, episodeId, body, envelope };
  }

  const envelope = { stage: 'proposal', diagnosis: body.diagnosis || null, actions: body.actions, confidence: body.confidence ?? 0.7 };
  return { project, episodeId, body, envelope };
}

export function act(body = {}) {
  const plan = planAct(body);
  if (!body.apply) return { envelope: plan.envelope };

  const applied = db.update(d => {
    const idx = d.projects.findIndex(p => p.id === plan.project.id);
    if (idx < 0) throw bad('项目不存在', 404);
    const before = d.projects[idx];
    if (body.baseRevision !== undefined && body.baseRevision !== null && Number(body.baseRevision) !== Number(before.revision || 1)) {
      throw bad('项目已被其他会话更新，请重新诊断后再采纳。', 409);
    }
    const after = structuredClone(before);
    applyActions(after, plan.episodeId, plan.envelope.actions);
    after.revision = Number(before.revision || 1) + 1;
    after.updatedAt = new Date().toISOString();
    after.versionHash = stableHash(after);
    autoVersionForSave(d, before, after);
    d.projects[idx] = after;
    return after;
  });
  return { envelope: plan.envelope, project: applied };
}
