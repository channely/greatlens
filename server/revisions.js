// 草稿级修订说明 + Option 1/2/3 备选方案。
// 与项目版本历史（versions.js）不同：这里操作的是「节拍 / 语义节点」粒度的备选文本与修订批注。
// 全部本地确定性生成，提案默认不写项目；采纳时按稳定 ID + expectedText + revision 三道校验 fail closed。
import crypto from 'node:crypto';
import { db, uid } from './store.js';
import { stableHash } from './migrations.js';
import { autoVersionForSave } from './versions.js';

const bad = (message, status = 422) => Object.assign(new Error(message), { status });

function findEpisode(project, episodeId) {
  return (project.episodes || []).find(e => e.id === episodeId) || (project.episodes || [])[0];
}

// 目标可以是 beat 或语义节点，统一暴露 { id, text } 与写回函数。
function locateTarget(ep, kind, id) {
  const key = String(kind === 'beat' ? 'beats' : 'nodes');
  const list = Array.isArray(ep[key]) ? ep[key] : [];
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return null;
  return { list, idx, item: list[idx] };
}

function makeToken(projectId, revision, episodeId, kind, targetId, expectedText) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ projectId, revision, episodeId, kind, targetId, expectedText }))
    .digest('hex')
    .slice(0, 16);
}

// 三种确定性改写视角：克制 / 加强冲突 / 留白。不调用模型，保证可重复、可测试、零费用。
function alternatives(text) {
  const base = String(text || '').trim();
  if (!base) return [];
  return [
    { id: uid(), label: 'Option 1 · 克制', text: base.replace(/[！!]{1,}/g, '。').replace(/\s+/g, ' ').trim() },
    { id: uid(), label: 'Option 2 · 加强冲突', text: `${base}——但他没有退路。` },
    { id: uid(), label: 'Option 3 · 留白', text: `${base}（此处留白，让观众自己判断。）` },
  ];
}

// 提案：只返回 optionGroup，不写项目；前端展示后由作者显式选择。
export function proposeOptions(body = {}) {
  const d = db.all();
  const project = d.projects.find(p => p.id === body.projectId);
  if (!project) throw bad('项目不存在', 404);
  const ep = findEpisode(project, body.episodeId);
  if (!ep) throw bad('剧集不存在', 404);
  const kind = body.kind === 'beat' ? 'beat' : 'node';
  const targetId = String(body.targetId || '');
  const target = locateTarget(ep, kind, targetId);
  if (!target) throw bad('目标节拍 / 节点不存在', 404);
  const expectedText = String(target.item.text || target.item.summary || '');
  const alts = alternatives(expectedText || body.text || '');
  if (!alts.length) throw bad('目标内容为空，无法生成备选', 422);

  const group = {
    id: uid(),
    targetKind: kind,
    targetId,
    expectedText,
    alternatives: alts,
    chosenId: '',
    createdAt: new Date().toISOString(),
  };
  const token = makeToken(project.id, project.revision, ep.id, kind, targetId, expectedText);
  return { group, token, note: '提案未写入项目；选择某一 Option 时按当前 revision 与原文校验后采纳。' };
}

// 采纳某个备选：稳定 ID + expectedText + revision + token 四道校验，任一不符即拒绝。
export function applyOption(body = {}) {
  const group = body.group || {};
  const applied = db.update(d => {
    const idx = d.projects.findIndex(p => p.id === body.projectId);
    if (idx < 0) throw bad('项目不存在', 404);
    const before = d.projects[idx];
    if (body.baseRevision !== undefined && body.baseRevision !== null && Number(body.baseRevision) !== Number(before.revision || 1)) {
      throw bad('项目已被其他会话更新，请重新生成备选。', 409);
    }
    const ep = findEpisode(before, body.episodeId);
    const kind = group.targetKind === 'beat' ? 'beat' : 'node';
    const target = locateTarget(ep, kind, group.targetId);
    if (!target) throw bad('目标节拍 / 节点已不存在，请重新生成备选。', 409);
    const currentText = String(target.item.text || target.item.summary || '');
    if (currentText !== String(group.expectedText || '')) throw bad('目标内容已变化，备选已失效。', 422);
    const expectedToken = makeToken(before.id, before.revision, ep.id, kind, group.targetId, group.expectedText);
    if (!body.token || body.token !== expectedToken) throw bad('备选令牌无效或已过期，请重新生成备选。', 428);
    const chosen = (group.alternatives || []).find(a => a.id === body.alternativeId);
    if (!chosen) throw bad('所选 Option 不存在。', 409);

    const after = structuredClone(before);
    const epAfter = findEpisode(after, body.episodeId);
    const tAfter = locateTarget(epAfter, kind, group.targetId);
    if (kind === 'beat') tAfter.item.summary = chosen.text;
    else tAfter.item.text = chosen.text;
    if (!Array.isArray(epAfter.optionGroups)) epAfter.optionGroups = [];
    const stored = {
      ...structuredClone(group),
      chosenId: chosen.id,
      chosenLabel: chosen.label,
      adoptedAt: new Date().toISOString(),
    };
    // 同一目标只保留最近一次采纳记录，避免面板被历史备选淹没。
    epAfter.optionGroups = epAfter.optionGroups.filter(g => !(g.targetKind === kind && g.targetId === group.targetId));
    epAfter.optionGroups.unshift(stored);
    after.revision = Number(before.revision || 1) + 1;
    after.updatedAt = new Date().toISOString();
    after.versionHash = stableHash(after);
    autoVersionForSave(d, before, after);
    d.projects[idx] = after;
    return { project: after, stored, chosen };
  });
  return applied;
}

// 修订说明：附加到节拍 / 节点，不改动原文；按稳定 ID 定位，同样校验 revision。
export function addRevisionNote(body = {}) {
  const noteText = String(body.note || '').trim();
  if (!noteText) throw bad('修订说明不能为空', 400);
  const added = db.update(d => {
    const idx = d.projects.findIndex(p => p.id === body.projectId);
    if (idx < 0) throw bad('项目不存在', 404);
    const before = d.projects[idx];
    if (body.baseRevision !== undefined && body.baseRevision !== null && Number(body.baseRevision) !== Number(before.revision || 1)) {
      throw bad('项目已被其他会话更新，请重试。', 409);
    }
    const after = structuredClone(before);
    const ep = findEpisode(after, body.episodeId);
    if (!ep) throw bad('剧集不存在', 404);
    const kind = body.kind === 'beat' ? 'beat' : 'node';
    if (body.targetId) {
      const target = locateTarget(ep, kind, body.targetId);
      if (!target) throw bad('目标节拍 / 节点不存在', 409);
    }
    if (!Array.isArray(ep.revisionNotes)) ep.revisionNotes = [];
    const note = {
      id: uid(), targetKind: kind, targetId: String(body.targetId || ''),
      text: noteText.slice(0, 400), createdAt: new Date().toISOString(),
    };
    ep.revisionNotes.unshift(note);
    after.revision = Number(before.revision || 1) + 1;
    after.updatedAt = new Date().toISOString();
    after.versionHash = stableHash(after);
    autoVersionForSave(d, before, after);
    d.projects[idx] = after;
    return { project: after, note };
  });
  return added;
}

export function listRevisions(body = {}) {
  const project = db.all().projects.find(p => p.id === body.projectId);
  if (!project) throw bad('项目不存在', 404);
  const ep = findEpisode(project, body.episodeId);
  if (!ep) return { revisionNotes: [], optionGroups: [] };
  return {
    revisionNotes: Array.isArray(ep.revisionNotes) ? ep.revisionNotes : [],
    optionGroups: Array.isArray(ep.optionGroups) ? ep.optionGroups : [],
  };
}
