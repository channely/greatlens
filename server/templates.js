// 新建项目起始模板：三幕结构 / 角色优先 / 空白剧本。
// 确定性本地种子，只生成可编辑的初始实体与节拍，不调用模型、不写入项目之外的数据。
import { uid } from './store.js';

export const START_TEMPLATES = [
  { id: 'blank', name: '空白剧本', desc: '只有第 1 集与空节点，从第一场开始写。' },
  { id: 'three-act', name: '三幕结构', desc: '预置建置 / 对抗 / 结局三幕与六个骨架节拍。' },
  { id: 'character-first', name: '角色优先', desc: '先建三位角色的档案骨架，再写围绕他们的节拍。' },
];

const TEMPLATE_IDS = new Set(START_TEMPLATES.map(t => t.id));

function beat(name, summary) {
  return { id: uid(), name, summary, tension: 3 };
}

// 对 makeProject 产出的空项目应用模板，返回同一个项目对象（原地填充 episodes[0]）。
export function applyStartTemplate(project, templateId) {
  const id = TEMPLATE_IDS.has(templateId) ? templateId : 'blank';
  if (project.type !== 'script') return project; // Cinema 暂不使用剧本起始模板
  const ep = project.episodes?.[0];
  if (!ep) return project;
  ep.template = id;

  if (id === 'three-act') {
    ep.outline = [
      { id: uid(), text: '第一幕 · 建置：交代世界与主角欲望' },
      { id: uid(), text: '第二幕 · 对抗：反对力量升级，中点转折' },
      { id: uid(), text: '第三幕 · 结局：高潮与落点' },
    ];
    ep.beats = [
      beat('开场画面', '用一个可见动作确立主角所处世界。'),
      beat('催化剂', '打破日常的事件出现。'),
      beat('中点转折', '目标从被动转为主动。'),
      beat('一切皆失', '最低点，主角失去退路。'),
      beat('高潮', '主角做出不可撤销的决定。'),
      beat('终场画面', '与开场形成呼应的收束。'),
    ];
  } else if (id === 'character-first') {
    project.characters = [
      { id: uid(), name: '主角', bio: '', voice: '', arc: '', look: '', notes: '' },
      { id: uid(), name: '对手', bio: '', voice: '', arc: '', look: '', notes: '' },
      { id: uid(), name: '关键关系', bio: '', voice: '', arc: '', look: '', notes: '' },
    ];
    ep.beats = [
      beat('主角登场', '主角带着一个未被满足的欲望出现。'),
      beat('关系压力', '对手与主角的目标正面冲突。'),
      beat('关系转折', '关键关系改变立场，逼出主角决定。'),
    ];
  }
  // blank：保持 makeProject 的空结构不变。
  return project;
}
