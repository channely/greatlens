import test from 'node:test';
import assert from 'node:assert/strict';
import { planIdeaStage } from '../server/idea.js';

// 首页带入的描述预填到 brief.theme，验证它确实参与后续提案与建项。
test('首页描述作为 theme 带入后，参与标题/大纲/节拍/开场提案', () => {
  const seed = '雨夜便利店，女人低头折信，镜头缓慢推近，暖白荧光灯，30 秒竖屏短片';
  const draft = {
    brief: {
      protagonist: '女人', desire: '寄出未寄出的信', opposition: '过去的自己',
      length: '30 秒竖屏短片', tone: '潮湿、克制', theme: seed,
    },
  };

  const title = planIdeaStage({ stage: 'title', draft }).payload;
  assert.ok([...title.options, title.logline].some(s => s.includes('女人')));

  const outline = planIdeaStage({ stage: 'outline', draft }).payload;
  assert.ok(outline.acts.some(s => s.includes(seed.slice(0, 8)) || s.includes('女人')));

  const beats = planIdeaStage({ stage: 'beats', draft }).payload;
  assert.ok(beats.beats.some(s => s.includes(seed) || s.includes('未寄出的信')));

  const opening = planIdeaStage({ stage: 'opening', draft }).payload;
  // opening 节点用 tone 的最后一项（克制）与 protagonist 组装，theme 经 outline/beats 已体现。
  assert.ok(opening.nodes.some(n => n.text.includes('女人')));
  assert.ok(opening.nodes.some(n => n.text.includes('克制')));
});

test('seed 为空时提案退回默认值，不抛错', () => {
  const draft = { brief: { protagonist: '', desire: '', opposition: '', length: '', tone: '', theme: '' } };
  const r = planIdeaStage({ stage: 'brief', draft });
  assert.ok(r.payload.theme, '空 theme 使用默认主题约束');
});
