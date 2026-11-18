// 实体与生产管理层：从剧本派生实体、关系图谱分析、连续性审计、知识索引检索。
// 事实来源始终是剧本节点；这些视图是同一批项目级实体的不同投影。
import { ADVISORS, knowledgeIndex, searchKnowledge } from './store.js';

const norm = s => String(s || '').trim().toUpperCase().replace(/\s*（.*?）\s*/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ');

// 从所有剧集节点派生：角色、地点（含 INT/EXT 与时段）、道具关键词、场景序列。
export function deriveEntities(project) {
  const episodes = project?.episodes || [];
  const characters = new Map();
  const locations = new Map();
  const props = new Map();
  let sceneNo = 0;
  const sceneList = [];

  for (let ei = 0; ei < episodes.length; ei++) {
    const ep = episodes[ei];
    for (const n of ep.nodes || []) {
      if (n.type === 'scene' && n.text?.trim()) {
        sceneNo++;
        sceneList.push({ no: sceneNo, episode: ei, text: n.text.trim() });
        const cleaned = n.text.trim().replace(/^(INT\.?|EXT\.?|INT\/EXT\.?|内|外)\s*/i, '').split(/\s*[-–—]\s*/)[0].trim();
        if (cleaned) {
          const prev = locations.get(cleaned) || { name: cleaned, scenes: [], intExt: /EXT|外/i.test(n.text) ? 'EXT' : 'INT', time: '' };
          prev.scenes.push(sceneNo);
          const tm = n.text.match(/(清晨|白天|日|午后|黄昏|傍晚|夜|深夜|DAWN|DAY|NIGHT|DUSK)/i);
          if (tm && !prev.time) prev.time = tm[0];
          locations.set(cleaned, prev);
        }
      }
      if (n.type === 'character' && n.text?.trim()) {
        const name = norm(n.text);
        if (name && !/^(CUT|FADE|DISSOLVE)/i.test(name)) {
          const prev = characters.get(name) || { name: n.text.trim().replace(/（.*?）|\(.*?\)/g, '').trim(), cues: 0, scenes: new Set(), episodes: new Set() };
          prev.cues++;
          prev.scenes.add(sceneNo);
          prev.episodes.add(ei + 1);
          characters.set(name, prev);
        }
      }
    }
  }
  // 道具来自项目显式记录的 props，不做剧本猜测（与官方一致：道具是项目级实体）。
  for (const p of project?.props || []) {
    if (p?.name) props.set(norm(p.name), p);
  }
  return {
    scenes: sceneList,
    characters: [...characters.values()].map(c => ({ ...c, scenes: [...c.scenes], episodes: [...c.episodes] })),
    locations: [...locations.values()],
    props: [...props.values()],
  };
}

// 关系图谱分析：找出「数据里声明但剧本从未测试」的关系、无压力的中心角色、同功能冗余。
export function analyzeRelationships(project) {
  const chars = (project?.characters || []).map(c => ({ id: c.id, name: c.name || '未命名' }));
  const rels = project?.relationships || [];
  const derived = deriveEntities(project);
  const cueCounts = new Map(derived.characters.map(c => [norm(c.name), c.cues]));
  const scriptNames = new Set(derived.characters.map(c => norm(c.name)));

  const byId = new Map(chars.map(c => [c.id, c]));
  const degree = new Map(chars.map(c => [c.id, 0]));
  const tested = new Map();
  // 扫描所有对白/动作，判断关系中的两端是否在同一场出现过（粗粒度「被戏剧化检验」信号）。
  const episodes = project?.episodes || [];
  const sceneCast = [];
  let current = new Set();
  for (const ep of episodes) {
    current = new Set();
    for (const n of ep.nodes || []) {
      if (n.type === 'scene') {
        if (current.size > 1) sceneCast.push([...current]);
        current = new Set();
      } else if (n.type === 'character' && n.text?.trim()) current.add(norm(n.text));
    }
    if (current.size > 1) sceneCast.push([...current]);
  }
  const coScene = new Set();
  for (const cast of sceneCast) {
    for (let i = 0; i < cast.length; i++) for (let j = i + 1; j < cast.length; j++) {
      coScene.add([cast[i], cast[j]].sort().join('|'));
    }
  }

  const warnings = [];
  const edges = rels.map(r => {
    const a = byId.get(r.from), b = byId.get(r.to);
    degree.set(r.from, (degree.get(r.from) || 0) + 1);
    degree.set(r.to, (degree.get(r.to) || 0) + 1);
    const key = [norm(a?.name), norm(b?.name)].sort().join('|');
    const isTested = coScene.has(key);
    if (!isTested) warnings.push({ type: 'untested', text: `关系「${a?.name || '?'} ↔ ${b?.name || '?'}：${r.label || '未命名'}」在数据里声明，但两人从未同场出现。` });
    return { ...r, fromName: a?.name || '?', toName: b?.name || '?', testedOnScreen: isTested };
  });
  // 中心角色无压力：度数高但几乎不出现在场景里，或出现在场景但没有任何关系声明。
  for (const c of chars) {
    const cues = cueCounts.get(norm(c.name)) || 0;
    if ((degree.get(c.id) || 0) === 0 && cues > 0) {
      warnings.push({ type: 'no-pressure', text: `角色「${c.name}」出现在剧本中（${cues} 次），但关系网络里没有任何连接。` });
    }
  }
  const hubs = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, d]) => ({ name: byId.get(id)?.name || '?', degree: d }));

  return {
    nodes: chars.map(c => ({ ...c, degree: degree.get(c.id) || 0, cues: cueCounts.get(norm(c.name)) || 0, inScript: scriptNames.has(norm(c.name)) })),
    edges, hubs, warnings,
    stats: { characters: chars.length, relationships: rels.length, untested: warnings.filter(w => w.type === 'untested').length },
  };
}

// 连续性审计：道具的引入/转移/损坏/兑现记录是否齐全；地点重命名后场景标题是否仍一致。
export function auditContinuity(project) {
  const issues = [];
  const props = project?.props || [];
  for (const p of props) {
    const missing = [];
    if (!p.name?.trim()) missing.push('名称');
    if (!p.introduced?.trim()) missing.push('首次出现');
    if (!p.carrier?.trim()) missing.push('当前持有人');
    if (missing.length) issues.push({ kind: 'prop', ref: p.id, name: p.name || '未命名道具', text: `道具缺少：${missing.join('、')}` });
  }
  const derived = deriveEntities(project);
  const locNames = new Set((project?.locations || []).map(l => norm(l.name)));
  for (const l of derived.locations) {
    if (locNames.size && !locNames.has(norm(l.name))) {
      issues.push({ kind: 'location', ref: l.name, name: l.name, text: `场景标题里的地点「${l.name}」未在地点表中登记（第 ${l.scenes.join('、')} 场）。` });
    }
  }
  // 角色档案与剧本角色的偏差
  const charNames = new Set((project?.characters || []).map(c => norm(c.name)));
  for (const c of derived.characters) {
    if (charNames.size && !charNames.has(norm(c.name))) {
      issues.push({ kind: 'character', ref: c.name, name: c.name, text: `剧本中的角色「${c.name}」尚无角色档案。` });
    }
  }
  return { issues, checked: { props: props.length, locations: derived.locations.length, characters: derived.characters.length } };
}

export function entityRoutes(ADVISORS_, knowledgeIndex_, searchKnowledge_) {
  return { ADVISORS: ADVISORS_ || ADVISORS, knowledgeIndex: knowledgeIndex_ || knowledgeIndex, searchKnowledge: searchKnowledge_ || searchKnowledge };
}
