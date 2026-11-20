// Script → Cinema 显式转换（对齐 laper：peer 文档类型，一次性复制，不往返合并）。
// 源 Script 项目只读不改；产出独立 Cinema 项目，场景标题 → reel.scene，场景内容 → reel.performance。
import { db, uid, makeProject } from './store.js';
import { deriveEntities } from './entities.js';
import { stableHash } from './migrations.js';
import { createVersion } from './versions.js';

const bad = (message, status = 422) => Object.assign(new Error(message), { status });

function collectSceneBodies(ep) {
  // 按场景标题切分正文，作为每个 reel 的表演草案（可再逐句改写）。
  const bodies = [];
  let current = null;
  for (const n of ep?.nodes || []) {
    if (n.type === 'scene') {
      current = { heading: n.text.trim(), lines: [] };
      bodies.push(current);
    } else if (current) {
      const t = String(n.text || '').trim();
      if (!t) continue;
      const prefix = n.type === 'character' ? `${t}\n` : '';
      current.lines.push(n.type === 'dialogue' ? `“${t}”` : prefix + t);
    }
  }
  return bodies;
}

export function convertScriptToCinema({ sourceId, name } = {}) {
  const source = db.all().projects.find(p => p.id === sourceId);
  if (!source) throw bad('源项目不存在', 404);
  if (source.type !== 'script') throw bad('只有 Script 项目可以转换为 Cinema', 422);

  const converted = db.update(d => {
    const src = d.projects.find(p => p.id === sourceId);
    const cinema = makeProject('cinema', String(name || `${src.name} · Cinema`).trim() || '未命名 Cinema');
    // 共享项目级实体：角色、道具、封面、世界观、知识资料（一次性复制，之后各自独立）。
    cinema.characters = JSON.parse(JSON.stringify(src.characters || []));
    cinema.props = JSON.parse(JSON.stringify(src.props || []));
    cinema.cover = JSON.parse(JSON.stringify(src.cover || {}));
    cinema.worldview = JSON.parse(JSON.stringify(src.worldview || {}));
    cinema.knowledge = JSON.parse(JSON.stringify(src.knowledge || []));
    cinema.convertedFrom = { projectId: src.id, name: src.name, at: new Date().toISOString() };

    const derived = deriveEntities(src);
    const ep = cinema.episodes[0];
    let reelIndex = 0;
    for (const srcEp of src.episodes || []) {
      const bodies = collectSceneBodies(srcEp);
      const shots = JSON.parse(JSON.stringify(srcEp.shots || []));
      for (const body of bodies) {
        const shotSlice = shots.splice(0, Math.max(1, Math.ceil(shots.length / Math.max(1, bodies.length))));
        ep.reels.push({
          id: uid(),
          title: `Reel ${++reelIndex} · ${body.heading.slice(0, 24)}`,
          scene: body.heading,
          refs: [],
          performance: body.lines.join('\n'),
          shots: shotSlice,
          storyboardImage: null,
          clip: '',
          duration: 30,
          continuity: 'natural',
          versions: [],
          sourceNodeId: derived.scenes.find(s => s.text === body.heading)?.nodeId || '',
        });
      }
      if (srcEp.outline?.length) ep.outline = JSON.parse(JSON.stringify(srcEp.outline));
      if (srcEp.beats?.length) ep.beats = JSON.parse(JSON.stringify(srcEp.beats));
    }
    if (ep.reels.length === 0) {
      ep.reels.push({ id: uid(), title: 'Reel 1', scene: '', refs: [], performance: '', shots: [], storyboardImage: null, clip: '', duration: 30, continuity: 'natural', versions: [] });
    }
    cinema.versionHash = stableHash(cinema);
    d.projects.unshift(cinema);
    return cinema;
  });

  createVersion(converted.id, {
    name: '从 Script 转换',
    description: `由「${source.name}」一次性转换建立；源项目保持不变，两者各自独立演进。`,
  });
  return converted;
}
