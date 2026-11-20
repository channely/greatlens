// idea-first：brief 驱动的分阶段提案与一次性建项。
// 阶段提案默认用确定性本地提案器；brief 冷启动可用模型做专业分析填充（失败自动回退本地）。
import { db, uid, makeProject, settings, usage } from './store.js';
import { stableHash } from './migrations.js';
import { createVersion } from './versions.js';

export const IDEA_STAGES = ['brief', 'title', 'outline', 'beats', 'characters', 'locations', 'opening', 'review'];
const BAD = (message, status = 422) => Object.assign(new Error(message), { status });
// 运行时读取，便于测试切换 stub（不要在模块加载时固化）。
const isStub = () => process.env.GL_STUB_MODELS === '1';

const BRIEF_FIELDS = ['protagonist', 'desire', 'opposition', 'length', 'tone', 'theme'];
const BRIEF_DEFAULT = {
  protagonist: '', desire: '', opposition: '', length: '短片', tone: '', theme: '',
};

function text(value, fallback = '') {
  return String(value ?? '').trim() || fallback;
}

function lines(value) {
  if (Array.isArray(value)) return value.map(v => v && typeof v === 'object' ? v.text : v).filter(Boolean);
  return String(value || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
}

// ---- brief 专业分析填充 ----
// 目标：把首页一句话 seed 解构成 brief 六字段。模型可用则用模型，失败/未配置则本地抽取兜底，
// 保证向导永远不会卡在"请求失败"。所有字段仅作为可编辑默认值返回，不写项目。
function localBriefAnalysis(seed, incoming = {}) {
  const s = String(seed || '').trim();
  const out = { ...BRIEF_DEFAULT };
  for (const k of BRIEF_FIELDS) if (incoming[k]) out[k] = String(incoming[k]).trim();
  if (!s) return out;

  // 长度 / 形式：识别秒数、剧集、短片等。
  if (/(\d+)\s*秒|30\s*s\b/i.test(s)) { const m = s.match(/(\d+)\s*秒/); out.length = m ? `${m[1]} 秒短片` : '30 秒短片'; }
  else if (/剧集|连续剧|第.?季|episode/i.test(s)) out.length = '系列剧集';
  else if (/短片|微电影|短片/i.test(s)) out.length = '短片';

  // 调性：抓取明确的风格词。
  const tones = ['克制', '潮湿', '温暖', '冷峻', '荒诞', '黑色幽默', '抒情', '悬疑', '写实', '诗意', '压抑', '明亮', '怀旧', '悲怆'];
  const found = tones.filter(t => s.includes(t));
  if (found.length) out.tone = found.join('、');

  // 主题约束：用整句话（截断）作为要追问的问题；用户可改。
  if (!out.theme) out.theme = s.length > 60 ? s.slice(0, 60) + '…' : s;

  // 主角 / 欲望 / 反对：抽取引号内台词、@角色、以及"关于X的Y"结构做弱假设。
  const quoted = s.match(/[“"]([^”"]{2,30})[”"]/);
  const atChar = s.match(/@([\u4e00-\u9fa5A-Za-z0-9]{1,8})/);
  const about = s.match(/关于([\u4e00-\u9fa5]{2,10})/);
  if (!out.protagonist) out.protagonist = atChar ? atChar[1] : (about ? `与「${about[1]}」有关的人` : '一个普通人');
  if (!out.desire) out.desire = quoted ? `说出「${quoted[1]}」` : '想要一个说得出口的答案';
  if (!out.opposition) out.opposition = '一段无法回避的旧关系';
  return out;
}

const BRIEF_SYSTEM = `你是专业编剧与故事开发顾问。把用户的一句话创意，专业地解构成剧本 brief 的六个字段。
只输出 JSON 对象，不要任何解释、不要 markdown，格式：
{"protagonist":"主角是谁（一个短句，≤20字，如：退休邮差林岸）","desire":"主角想要什么（可行动的目标，≤25字）","opposition":"反对力量/阻力（≤20字，如：不肯先走的旧友）","length":"片长与形式（如 30 秒短片 / 5 分钟短片 / 系列剧集）","tone":"调性（2-4 个词，逗号分隔）","theme":"一句话主题约束/要追问的问题（≤40字）"}
原则：尊重用户原文，不要凭空扩写成完整剧情；每个字段都必须是 Short、具体、可直接放进表格的短语，不要写成整段描述。用中文。`;

// 各字段长度上限，避免 AI 冗长输出污染后续标题/项目名。
const BRIEF_LEN = { protagonist: 24, desire: 30, opposition: 24, length: 16, tone: 28, theme: 48 };
function clampBrief(brief) {
  const out = {};
  for (const k of BRIEF_FIELDS) {
    if (brief[k] != null) out[k] = String(brief[k]).trim().slice(0, BRIEF_LEN[k]);
  }
  return out;
}

function parseBriefJSON(raw) {
  if (!raw) return null;
  let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    const out = {};
    for (const k of BRIEF_FIELDS) if (obj[k] != null && String(obj[k]).trim()) out[k] = String(obj[k]).trim().slice(0, 120);
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

export async function analyzeBrief(seed, incoming = {}) {
  const local = localBriefAnalysis(seed, incoming);
  const cfg = settings.get();
  if (isStub() || !cfg.apiKey || !cfg.baseUrl || !String(seed || '').trim()) {
    return { brief: clampBrief(local), source: 'local' };
  }
  const base = String(cfg.baseUrl).replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model || 'qwen4-max',
        messages: [
          { role: 'system', content: BRIEF_SYSTEM },
          { role: 'user', content: String(seed).trim() },
        ],
        temperature: 0.7,
      }),
    });
    if (!res.ok) return { brief: clampBrief(local), source: 'local' };
    const json = await res.json();
    const parsed = parseBriefJSON(json?.choices?.[0]?.message?.content);
    if (!parsed) return { brief: clampBrief(local), source: 'local' };
    if (json.usage) {
      try {
        usage.add({
          type: 'chat', model: cfg.model || 'qwen4-max', mode: 'idea-brief', scope: 'brief',
          detail: { purpose: 'idea-first brief 分析填充' },
          promptTokens: json.usage.prompt_tokens ?? json.usage.input_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? json.usage.output_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        });
      } catch { /* 计费失败不影响主流程 */ }
    }
    // 用户已填字段优先，模型只补空位；theme 保留 seed 原文用途。
    const merged = { ...parsed };
    for (const k of BRIEF_FIELDS) if (incoming[k] && String(incoming[k]).trim()) merged[k] = String(incoming[k]).trim();
    if (incoming.theme) merged.theme = String(incoming.theme).trim();
    return { brief: clampBrief(merged), source: 'ai' };
  } catch {
    return { brief: clampBrief(local), source: 'local' };
  } finally {
    clearTimeout(timer);
  }
}

function briefOf(draft = {}) {
  const b = draft.brief || draft;
  return {
    protagonist: text(b.protagonist, '一个普通人'),
    desire: text(b.desire, '想要一个说不出口的答案'),
    opposition: text(b.opposition, '一段无法回避的旧关系'),
    length: text(b.length, '短片'),
    tone: text(b.tone, '克制、潮湿、带一点暖意'),
    theme: text(b.theme, '迟到的道歉能否被听见'),
  };
}

function stagePayload(stage, draft = {}) {
  const b = briefOf(draft);
  switch (stage) {
    case 'brief':
      return b;
    case 'title':
      return {
        options: [
          `《${b.protagonist}的${b.desire}》`,
          `《${b.opposition}来信》`,
          `《${b.length}里的${b.tone.split('、')[0]}》`,
        ],
        logline: `${b.protagonist}为了${b.desire}，必须与${b.opposition}再次相遇。`,
      };
    case 'outline':
      return {
        acts: [
          `开端：${b.protagonist}被一件小事重新拉回${b.opposition}的视线。`,
          `发展：${b.desire}的代价逐渐显现，${b.tone}成为推进 pressure 的方式。`,
          `高潮：一个无法回避的选择逼问「${b.theme}」。`,
          `结局：答案不一定被说出，但关系的位置已经改变。`,
        ],
      };
    case 'beats':
      return {
        beats: [
          '钩子：一个可见的异常动作。',
          `目标：${b.protagonist}明确说出想要什么。`,
          `阻力：${b.opposition}以不正面冲突的方式挡路。`,
          '转折：一个细节推翻此前判断。',
          '中点：代价从情绪变成具体损失。',
          '低谷：主角失去原本计划。',
          `高潮：围绕「${b.theme}」做出不可撤销的选择。`,
          '落点：留下一个可被追问的画面。',
        ],
      };
    case 'characters':
      return {
        characters: [
          { id: uid(), name: b.protagonist, bio: `欲望：${b.desire}。弱点：习惯把请求包装成闲聊。` },
          { id: uid(), name: b.opposition, bio: '并非恶人，有自己的一套自洽理由。' },
          { id: uid(), name: '证人', bio: '掌握关键信息，但只在边缘出现。' },
        ],
        note: '这里是开局草案，可在角色档案里改名与补充。',
      };
    case 'locations':
      return {
        locations: [
          { id: uid(), name: '主场景', bio: `${b.tone}，承担主要对手戏。` },
          { id: uid(), name: '过渡空间', bio: '走廊 / 路上，用于改变关系距离。' },
          { id: uid(), name: '私人空间', bio: '主角独处，暴露真实欲望。' },
        ],
      };
    case 'opening':
      return {
        nodes: [
          { id: uid(), type: 'scene', text: `INT. 主场景 - 黄昏` },
          { id: uid(), type: 'action', text: `${b.protagonist}推门进来，先看见的不是人，而是${b.opposition}留下的东西。` },
          { id: uid(), type: 'action', text: `空气里有${b.tone.split('、').pop()}的味道。` },
        ],
      };
    case 'review':
      return {
        checklist: [
          { key: 'outline', label: '大纲', done: lines(draft.outline?.acts || draft.outline).length > 0 },
          { key: 'beats', label: '节拍', done: lines(draft.beats?.beats || draft.beats).length > 0 },
          { key: 'script', label: '开场剧本', done: lines(draft.opening?.nodes || draft.opening).length > 0 },
          { key: 'characters', label: '角色档案', done: lines(draft.characters?.characters || draft.characters).length > 0 },
          { key: 'locations', label: '地点', done: lines(draft.locations?.locations || draft.locations).length > 0 },
        ],
      };
    default:
      throw BAD(`未知阶段：${stage}`);
  }
}

export function planIdeaStage({ stage, draft = {}, clientDraftId = '' } = {}) {
  const current = IDEA_STAGES.indexOf(stage);
  if (current < 0) throw BAD(`未知阶段：${stage}`);
  const next = IDEA_STAGES[current + 1] || null;
  return {
    clientDraftId: text(clientDraftId, uid()),
    stage,
    nextStage: next,
    payload: stagePayload(stage, draft),
  };
}

export function createProjectFromIdea(body = {}) {
  const clientDraftId = text(body.clientDraftId);
  if (!clientDraftId) throw BAD('缺少 clientDraftId，无法保证幂等创建');
  const draft = body.draft || {};
  if (!draft.title && !draft.brief?.title) throw BAD('需要先确认标题');

  const created = db.update(d => {
    const existing = d.projects.find(p => p.ideaDraftId === clientDraftId);
    if (existing) return { project: existing, created: false };

    const type = ['script', 'cinema'].includes(body.type) ? body.type : 'script';
    const b = briefOf(draft);
    const p = makeProject(type, text(draft.title || draft.brief?.title, '未命名项目'));
    p.ideaDraftId = clientDraftId;
    p.cover = {
      title: p.name,
      logline: text(draft.logline || draft.title?.logline, `${b.protagonist}为了${b.desire}。`),
      author: text(draft.author, ''),
    };
    p.synopsis = text(draft.synopsis, p.cover.logline);
    p.settings = {
      ...(p.settings || {}),
      format: text(draft.format, 'hollywood'),
      language: text(draft.language, 'zh'),
      exportConvention: text(draft.exportConvention, draft.format || 'hollywood'),
    };
    if (draft.advisorId) p.advisorId = text(draft.advisorId);

    const ep = p.episodes[0];
    if (type === 'script') {
      ep.outline = lines(draft.outline?.acts || draft.outline).map(t => ({ id: uid(), text: t }));
      ep.beats = lines(draft.beats?.beats || draft.beats).map(t => ({ id: uid(), text: t }));
      const opening = lines(draft.opening?.nodes?.map(n => n.text) || draft.opening);
      ep.nodes = opening.map(t => ({
        id: uid(),
        type: /^(INT|EXT|INT\/EXT|内|外)[\.．\s]/i.test(t) ? 'scene' : 'action',
        text: t,
      }));
    } else {
      ep.reels = [{
        id: uid(), title: 'Reel 1 · 开场', scene: b.tone, refs: [],
        performance: b.desire, shots: [], storyboardImage: '', clip: '',
        duration: 30, continuity: 'natural', versions: [],
      }];
    }

    p.characters = lines(draft.characters?.characters?.map(c => c.name) || draft.characters)
      .map(name => ({ id: uid(), name, bio: '', voice: '' }));
    p.locations = lines(draft.locations?.locations?.map(l => l.name) || draft.locations)
      .map(name => ({ id: uid(), name, notes: '' }));

    const attachments = Array.isArray(draft.attachments) ? draft.attachments : [];
    p.knowledge = attachments.filter(a => a?.text || a?.dataBase64).map(a => ({
      id: uid(),
      name: text(a.name, '参考材料'),
      type: text(a.kind, 'reference'),
      summary: String(a.text || '图片参考').slice(0, 120).replace(/\s+/g, ' ').trim(),
      tags: [text(a.kind, '附件')],
      body: String(a.text || ''),
      image: a.dataBase64 ? `data:${text(a.mime, 'image/*')};base64,${a.dataBase64}` : '',
    }));

    p.versionHash = stableHash(p);
    d.projects.unshift(p);
    d.ideaDrafts.unshift({ id: clientDraftId, projectId: p.id, createdAt: new Date().toISOString() });
    return { project: p, created: true };
  });

  if (created.created) {
    createVersion(created.project.id, {
      name: 'AI 创意初始版本',
      description: '由 idea-first 向导建立，保留创建时的全部草案。',
    });
  }
  return created;
}
