// FDX（Final Draft XML）与 Fountain 文本 → GreatLens 语义节点
import { uid } from './store.js';

const TYPE_MAP = {
  'scene heading': 'scene', 'scene': 'scene', 'heading': 'scene',
  'action': 'action', 'general': 'action',
  'character': 'character', 'character cue': 'character',
  'dialogue': 'dialogue', 'dialog': 'dialogue',
  'parenthetical': 'parenthetical',
  'transition': 'transition',
  'shot': 'action',
  'notes': 'note', 'note': 'note',
};

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function textOf(xml) {
  const t = String(xml || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n');
  return decodeEntities(t).replace(/[ \t]+/g, ' ').trim();
}

function tagContent(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : '';
}

export function parseFDX(xml) {
  const scenes = [...String(xml).matchAll(/<Scene\b[^>]*>([\s\S]*?)<\/Scene>/gi)].map(m => m[1]);
  const nodes = [];
  const characters = new Set();
  const locations = new Set();

  for (const sceneXml of scenes) {
    const heading = textOf(tagContent(sceneXml, 'SceneHeader') || tagContent(sceneXml, 'SceneHeading'));
    if (heading) {
      nodes.push({ id: uid(), type: 'scene', text: heading });
      const loc = heading.replace(/^(INT\.?|EXT\.?|INT\/EXT\.?|EST\.?|I\/E\.?)\s*/i, '').split(/[-–—]/)[0].trim();
      if (loc) locations.add(loc);
    }
    for (const pm of sceneXml.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/gi)) {
      const attrs = pm[1] || '';
      const typeRaw = (attrs.match(/Type\s*=\s*["']([^"']+)["']/i) || [])[1] || 'Action';
      const text = textOf(tagContent(pm[2], 'Text') || pm[2]);
      if (!text) continue;
      const norm = typeRaw.trim().toLowerCase();
      const type = TYPE_MAP[norm] || 'action';
      nodes.push({ id: uid(), type, text });
      if (type === 'character') characters.add(text.replace(/\s*\(CONT'D\)$/i, '').replace(/\s*\(CONTINUED\)$/i, '').trim());
    }
    // 没有 Paragraph 包裹的 SceneHeader 之外的纯文本兜底
    if (!heading) {
      const loose = textOf(sceneXml);
      if (loose) nodes.push({ id: uid(), type: 'action', text: loose });
    }
  }

  // 无 <Scene> 结构时按段落顺序兜底
  if (!nodes.length) {
    for (const pm of String(xml).matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/gi)) {
      const typeRaw = (pm[1].match(/Type\s*=\s*["']([^"']+)["']/i) || [])[1] || 'Action';
      const text = textOf(tagContent(pm[2], 'Text') || pm[2]);
      if (!text) continue;
      const type = TYPE_MAP[typeRaw.trim().toLowerCase()] || 'action';
      nodes.push({ id: uid(), type, text });
      if (type === 'character') characters.add(text.trim());
    }
  }

  return { nodes, characters: [...characters], locations: [...locations] };
}

export function parseFountain(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const nodes = [];
  const characters = new Set();
  const locations = new Set();
  let prevWasCharacter = false;

  for (let raw of lines) {
    let line = raw.trim();
    if (!line) { prevWasCharacter = false; continue; }
    if (line.startsWith('[[') && line.endsWith(']]')) {
      nodes.push({ id: uid(), type: 'note', text: line.slice(2, -2).trim() });
      prevWasCharacter = false; continue;
    }
    if (line.startsWith('.') && !line.startsWith('..')) {
      const t = line.slice(1).trim();
      nodes.push({ id: uid(), type: 'scene', text: t });
      const loc = t.replace(/^(INT\.?|EXT\.?|INT\/EXT\.?|EST\.?|I\/E\.?)\s*/i, '').split(/[-–—]/)[0].trim();
      if (loc) locations.add(loc);
      prevWasCharacter = false; continue;
    }
    if (/^(INT\.?|EXT\.?|INT\/EXT\.?|EST\.?|I\/E\.?)\s/i.test(line)) {
      nodes.push({ id: uid(), type: 'scene', text: line });
      const loc = line.replace(/^(INT\.?|EXT\.?|INT\/EXT\.?|EST\.?|I\/E\.?)\s*/i, '').split(/[-–—]/)[0].trim();
      if (loc) locations.add(loc);
      prevWasCharacter = false; continue;
    }
    if (line.startsWith('>') && line.endsWith('<')) {
      nodes.push({ id: uid(), type: 'transition', text: line.slice(1, -1).trim() });
      prevWasCharacter = false; continue;
    }
    if (line.startsWith('(') && line.endsWith(')')) {
      nodes.push({ id: uid(), type: 'parenthetical', text: line.slice(1, -1).trim() });
      continue;
    }
    const forceChar = line.startsWith('@');
    if (forceChar) line = line.slice(1).trim();
    const letters = line.replace(/[^A-Za-z\u4e00-\u9fa5]/g, '');
    const isAllCaps = letters.length >= 2 && letters === letters.toUpperCase() && /[A-Z]/.test(letters);
    if ((isAllCaps || forceChar) && line.length < 60) {
      const name = line.replace(/\s*\(CONT'D\)$/i, '').replace(/\s*\(CONTINUED\)$/i, '').trim();
      nodes.push({ id: uid(), type: 'character', text: name });
      characters.add(name);
      prevWasCharacter = true; continue;
    }
    nodes.push({ id: uid(), type: prevWasCharacter ? 'dialogue' : 'action', text: line });
    prevWasCharacter = false;
  }
  return { nodes, characters: [...characters], locations: [...locations] };
}

export function parseScreenplay(text) {
  const looksXML = /<FinalDraft\b/i.test(text) || /<Paragraph\b/i.test(text);
  const result = looksXML ? parseFDX(text) : parseFountain(text);
  return {
    ...result,
    stats: {
      scenes: result.nodes.filter(n => n.type === 'scene').length,
      paragraphs: result.nodes.length,
      characters: result.characters.length,
    },
  };
}
