// 作者口味记忆：把「已采纳 / 已弃用」的 AI 输出沉淀成可解释的长期偏好，
// 再注入后续 AI 请求。全程本地确定性计算，不调用模型、不额外计费、不覆盖作者原文。
import { db, uid } from './store.js';

const MAX_EVENTS = 120;
const MAX_ACCEPTED = 6;
const MAX_REJECTED = 6;
const MAX_RULES = 30;

export function emptyTaste(projectId) {
  return {
    projectId: String(projectId || ''),
    enabled: true,
    rules: [],            // 作者显式写下的规则：{ id, text, kind:'keep'|'avoid', createdAt }
    accepted: [],         // 从采纳输出提炼的短片段
    rejected: [],         // 从弃用输出提炼的短片段
    events: [],           // 反馈流水（有界）
    stats: { accepted: 0, rejected: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function getTaste(projectId) {
  const id = String(projectId || '');
  let found = null;
  db.update(d => {
    if (!Array.isArray(d.taste)) d.taste = [];
    let t = d.taste.find(x => x.projectId === id);
    if (!t) { t = emptyTaste(id); d.taste.push(t); }
    found = JSON.parse(JSON.stringify(t));
  });
  return found;
}

function snippet(text, max = 90) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function pushUnique(list, value, cap) {
  if (!value) return list;
  if (list.some(x => x === value || x.text === value)) return list.slice(0, cap);
  const next = [...list, typeof value === 'string' ? value : value];
  return next.slice(-cap);
}

const MODE_CATEGORY = {
  dialogue: '对白',
  rewrite: '改写',
  diagnose: '结构诊断',
  storyboard: '分镜',
  continue: '续写',
};

// 记录一次反馈并增量提炼偏好。verdict 只接受 accepted / rejected。
export function recordFeedback(projectId, body = {}) {
  const id = String(projectId || '');
  const verdict = String(body.verdict || '');
  if (verdict !== 'accepted' && verdict !== 'rejected') {
    throw Object.assign(new Error('verdict 必须是 accepted 或 rejected。'), { status: 400 });
  }
  const text = snippet(body.text, 160);
  const category = String(body.category || MODE_CATEGORY[String(body.mode || '')] || '').slice(0, 40);
  let out = null;
  db.update(d => {
    if (!Array.isArray(d.taste)) d.taste = [];
    let t = d.taste.find(x => x.projectId === id);
    if (!t) { t = emptyTaste(id); d.taste.push(t); }
    t.events = Array.isArray(t.events) ? t.events : [];
    t.rules = Array.isArray(t.rules) ? t.rules : [];
    t.accepted = Array.isArray(t.accepted) ? t.accepted : [];
    t.rejected = Array.isArray(t.rejected) ? t.rejected : [];
    t.stats = t.stats && typeof t.stats === 'object' ? t.stats : { accepted: 0, rejected: 0 };

    t.events.unshift({
      id: uid(), verdict, text, category,
      mode: String(body.mode || '').slice(0, 40),
      scope: String(body.scope || '').slice(0, 80),
      note: String(body.note || '').slice(0, 200),
      createdAt: new Date().toISOString(),
    });
    t.events = t.events.slice(0, MAX_EVENTS);
    t.stats[verdict] = Number(t.stats[verdict] || 0) + 1;

    const sample = snippet(text);
    if (verdict === 'accepted') t.accepted = pushUnique(t.accepted, sample, MAX_ACCEPTED);
    else t.rejected = pushUnique(t.rejected, sample, MAX_REJECTED);
    t.updatedAt = new Date().toISOString();
    out = JSON.parse(JSON.stringify(t));
  });
  return out;
}

export function addRule(projectId, body = {}) {
  const text = snippet(body.text, 160);
  if (!text) throw Object.assign(new Error('规则内容不能为空。'), { status: 400 });
  const kind = body.kind === 'avoid' ? 'avoid' : 'keep';
  let out = null;
  db.update(d => {
    if (!Array.isArray(d.taste)) d.taste = [];
    const id = String(projectId || '');
    let t = d.taste.find(x => x.projectId === id);
    if (!t) { t = emptyTaste(id); d.taste.push(t); }
    t.rules = Array.isArray(t.rules) ? t.rules : [];
    if (t.rules.length >= MAX_RULES) throw Object.assign(new Error('规则数量已达上限。'), { status: 422 });
    t.rules.push({ id: uid(), text, kind, source: 'manual', createdAt: new Date().toISOString() });
    t.updatedAt = new Date().toISOString();
    out = JSON.parse(JSON.stringify(t));
  });
  return out;
}

export function removeRule(projectId, ruleId) {
  let out = null;
  db.update(d => {
    const t = (d.taste || []).find(x => x.projectId === String(projectId || ''));
    if (!t) return;
    t.rules = (t.rules || []).filter(r => r.id !== ruleId);
    t.updatedAt = new Date().toISOString();
    out = JSON.parse(JSON.stringify(t));
  });
  return out;
}

export function setTasteEnabled(projectId, enabled) {
  let out = null;
  db.update(d => {
    if (!Array.isArray(d.taste)) d.taste = [];
    const id = String(projectId || '');
    let t = d.taste.find(x => x.projectId === id);
    if (!t) { t = emptyTaste(id); d.taste.push(t); }
    t.enabled = enabled !== false;
    t.updatedAt = new Date().toISOString();
    out = JSON.parse(JSON.stringify(t));
  });
  return out;
}

// 把口味档案压成一段 system 提示；关闭或无内容时返回空串，不影响既有行为。
export function tastePrompt(taste) {
  if (!taste || taste.enabled === false) return '';
  const parts = [];
  const rules = Array.isArray(taste.rules) ? taste.rules : [];
  const keeps = rules.filter(r => r.kind !== 'avoid').map(r => r.text);
  const avoids = rules.filter(r => r.kind === 'avoid').map(r => r.text);
  if (keeps.length) parts.push(`【作者长期偏好 · 请保持】\n${keeps.map(x => '- ' + x).join('\n')}`);
  if (avoids.length) parts.push(`【作者明确避免 · 请勿使用】\n${avoids.map(x => '- ' + x).join('\n')}`);
  if (Array.isArray(taste.accepted) && taste.accepted.length) {
    parts.push(`【作者采纳过的写法示例 · 参考其节奏与措辞，不要照抄】\n${taste.accepted.map(x => '- ' + x).join('\n')}`);
  }
  if (Array.isArray(taste.rejected) && taste.rejected.length) {
    parts.push(`【作者弃用过的写法 · 避免同类表达】\n${taste.rejected.map(x => '- ' + x).join('\n')}`);
  }
  if (!parts.length) return '';
  return '\n' + parts.join('\n') + '\n以上偏好来自作者的历史反馈，优先级低于本次请求里的 constraints 与 authority。';
}

// 按 projectId 从数据库取口味并生成提示；供 ai.js 在组装 system 时调用。
export function tastePromptForProject(projectId) {
  if (!projectId) return '';
  const t = (db.all().taste || []).find(x => x.projectId === String(projectId));
  return tastePrompt(t);
}
