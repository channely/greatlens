// 剧本导出引擎：零第三方依赖，仅使用 Node 内置模块（Buffer 等）。
// 支持 FDX / TXT / DOCX / PDF 四种剧本格式，以及大纲（outline）导出。
// 所有格式都由同一个「语义条目流」生成，保证好莱坞 / 亚洲两种约定在各格式间表现一致。

// ---------------------------------------------------------------------------
// 常量与基础工具
// ---------------------------------------------------------------------------

// 纯文本排版宽度（字符数）。好莱坞对白宽约 3.0 英寸，等宽字体下约 34 字符。
const LINE_WIDTH = 70;   // 场景/动作等正文的逻辑行宽
const DIALOGUE_WIDTH = 34; // 对白软换行宽度（≈3.0in）
const CHAR_INDENT = 10;   // 角色名缩进约 10 空格
const DLG_INDENT = 4;     // 对白缩进约 4 空格
const PAREN_INDENT = 6;   // 附加动作（括号）缩进

// FDX（Final Draft 8）段落类型映射
const FDX_TYPE_MAP = {
  scene: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  subtitle: 'Dialogue',
};

// DOCX 段落样式映射
const DOCX_STYLE_MAP = {
  scene: 'SceneHeading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  subtitle: 'Normal', // 字幕在 Word 中走正文样式
};

// 规范化业务参数
function normalizeConvention(convention, project) {
  const c = convention || project?.settings?.format || 'hollywood';
  return c === 'asian' ? 'asian' : 'hollywood';
}

// 按用户给定顺序解析出要导出的剧集（episodeIndexes 为索引数组）。
// 未指定或为空时导出全部剧集；越界 / 非整数索引直接忽略。
function resolveEpisodes(project, episodeIndexes) {
  const eps = Array.isArray(project?.episodes) ? project.episodes : [];
  let indexes = episodeIndexes;
  if (!Array.isArray(indexes) || indexes.length === 0) {
    indexes = eps.map((_, i) => i);
  }
  return indexes
    .map(i => Number(i))
    .filter(i => Number.isInteger(i) && i >= 0 && i < eps.length)
    .map(i => eps[i]);
}

// XML 文本转义：& < > " ' 全部处理（& 必须最先替换）
function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// 附加动作（parenthetical）：数据模型里 text 不含括号，导出时补上
function parenText(text) {
  const t = String(text ?? '');
  return /^\s*\([\s\S]*\)\s*$/.test(t) ? t : `(${t})`;
}

// 按字符数软换行；英文尽量在空白处断行，中文按宽度硬切。
function wrapText(text, width) {
  const chars = Array.from(String(text ?? ''));
  const out = [];
  let i = 0;
  while (i < chars.length) {
    if (i + width >= chars.length) {
      out.push(chars.slice(i).join(''));
      break;
    }
    let end = i + width;
    // 在后半段里寻找最近的空白作为断点，避免切断英文单词
    for (let j = end; j > i + Math.floor(width / 2); j--) {
      if (/\s/.test(chars[j])) { end = j; break; }
    }
    out.push(chars.slice(i, end).join('').trimEnd());
    i = end;
    while (i < chars.length && /\s/.test(chars[i])) i++;
  }
  return out.length ? out : [''];
}

// 把单个节点转成「显示文本」（不含缩进、不含大小写变换）。
// 亚洲约定：场景用「场次 N」前缀、角色用「角色名：」后缀；两种约定都给括号动作补括号。
function nodeDisplayText(node, conv, sceneNo) {
  const t = String(node?.text ?? '');
  switch (node?.type) {
    case 'scene':
      return conv === 'asian' ? `场次 ${sceneNo}  ${t}` : t;
    case 'character':
      return conv === 'asian' ? `${t}：` : t;
    case 'parenthetical':
      return parenText(t);
    default:
      return t;
  }
}

// 收集「语义条目流」：每条 { text, type }，type 为节点类型或 'title'（剧集标题）。
// comment 节点不进导出；场景编号按集重置。
function collectScreenplayItems(project, episodeIndexes, conv) {
  const items = [];
  for (const ep of resolveEpisodes(project, episodeIndexes)) {
    items.push({ text: String(ep?.title ?? ''), type: 'title' });
    let sceneNo = 0;
    for (const node of (Array.isArray(ep?.nodes) ? ep.nodes : [])) {
      if (!node || node.type === 'comment') continue;
      if (node.type === 'scene') sceneNo += 1;
      items.push({ text: nodeDisplayText(node, conv, sceneNo), type: node.type });
    }
  }
  return items;
}

// 大纲条目流：剧集标题 + 序号化的 outline 条目
function collectOutlineItems(project, episodeIndexes) {
  const items = [];
  for (const ep of resolveEpisodes(project, episodeIndexes)) {
    items.push({ text: String(ep?.title ?? ''), type: 'title' });
    const outline = Array.isArray(ep?.outline) ? ep.outline : [];
    outline.forEach((o, i) => {
      const t = typeof o === 'string' ? o : String(o?.text ?? '');
      items.push({ text: `${i + 1}. ${t}`, type: 'action' });
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// 1) 剧本纯文本（好莱坞 / 亚洲约定）
// ---------------------------------------------------------------------------

// 把条目按约定排成一行（可能含换行）
function layoutLine(item, conv) {
  const text = item.text;
  if (conv === 'asian') {
    // 亚洲约定：对白不缩进，场景/角色由 nodeDisplayText 加前缀后缀
    return text;
  }
  // 好莱坞约定
  switch (item.type) {
    case 'scene':
      return text.toUpperCase();
    case 'action':
      return wrapText(text, LINE_WIDTH).join('\n');
    case 'character':
      return ' '.repeat(CHAR_INDENT) + text.toUpperCase();
    case 'dialogue':
      return wrapText(text, DIALOGUE_WIDTH).map(l => ' '.repeat(DLG_INDENT) + l).join('\n');
    case 'parenthetical':
      return ' '.repeat(PAREN_INDENT) + text;
    case 'transition':
      return text.toUpperCase().padStart(LINE_WIDTH);
    case 'subtitle':
      return wrapText(text, DIALOGUE_WIDTH).map(l => ' '.repeat(DLG_INDENT) + l).join('\n');
    default:
      return text;
  }
}

export function buildScreenplayText(project, episodeIndexes, convention) {
  const conv = normalizeConvention(convention, project);
  const items = collectScreenplayItems(project, episodeIndexes, conv);
  // 剧集标题也作为一块；块间空行让纯文本更接近剧本排版
  const blocks = items.map(item => layoutLine(item, conv));
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

// ---------------------------------------------------------------------------
// 2) 大纲纯文本
// ---------------------------------------------------------------------------

export function buildOutlineText(project, episodeIndexes) {
  const items = collectOutlineItems(project, episodeIndexes);
  return items.map(i => i.text).join('\n') + (items.length ? '\n' : '');
}

// ---------------------------------------------------------------------------
// 3) Final Draft 8 .fdx
// ---------------------------------------------------------------------------

export function toFDX(project, episodeIndexes) {
  const conv = normalizeConvention(undefined, project);
  const items = collectScreenplayItems(project, episodeIndexes, conv);
  const paragraphs = items.map(item => {
    // 剧集标题用 Action 段落承载，节点按类型映射
    const type = item.type === 'title' ? 'Action' : (FDX_TYPE_MAP[item.type] || 'Action');
    return `    <Paragraph Type="${type}"><Text>${xmlEscape(item.text)}</Text></Paragraph>`;
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<FinalDraft DocumentType="Script" Template="No" Version="1">\n'
    + '  <Content>\n'
    + '    <Script>\n'
    + paragraphs.join('\n')
    + '\n    </Script>\n'
    + '  </Content>\n'
    + '</FinalDraft>\n';
}

// ---------------------------------------------------------------------------
// 4) TXT（复用 buildScreenplayText）
// ---------------------------------------------------------------------------

export function toTXT(project, episodeIndexes, convention) {
  return buildScreenplayText(project, episodeIndexes, convention);
}

// ---------------------------------------------------------------------------
// 5) DOCX：手写 CRC32 + ZIP（store 无压缩）+ OpenXML 最小部件
// ---------------------------------------------------------------------------

// CRC32 查表（IEEE 802.3，多项式 0xEDB88320）
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// 用 store（压缩方式 0）打包若干 {name, data} 为合法 ZIP Buffer
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const time = 0;                                   // 00:00:00
  const date = ((2024 - 1980) << 9) | (1 << 5) | 1; // 2024-01-01

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);

    // 本地文件头 30 字节
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4);         // version needed
    lh.writeUInt16LE(0, 6);          // flags
    lh.writeUInt16LE(0, 8);          // method: store
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);         // extra length
    locals.push(lh, nameBuf, data);

    // 中央目录头 46 字节
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // signature
    ch.writeUInt16LE(20, 4);         // version made by
    ch.writeUInt16LE(20, 6);         // version needed
    ch.writeUInt16LE(0, 8);          // flags
    ch.writeUInt16LE(0, 10);         // method: store
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);         // extra length
    ch.writeUInt16LE(0, 32);         // comment length
    ch.writeUInt16LE(0, 34);         // disk number start
    ch.writeUInt16LE(0, 36);         // internal attrs
    ch.writeUInt32LE(0, 38);         // external attrs
    ch.writeUInt32LE(offset, 42);    // local header offset
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + data.length;
  }

  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // disk with central dir
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);    // central dir offset
  eocd.writeUInt16LE(0, 20);         // comment length

  return Buffer.concat([...locals, ...centrals, eocd]);
}

// 生成一段 Word 段落 XML
function docxParagraph(style, text) {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>`
    + `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

// 由条目流构造 DOCX Buffer
function buildDocxFromItems(project, items) {
  const bodyXml = items.length
    ? items.flatMap(item => {
        const style = item.type === 'title' ? 'Title' : (DOCX_STYLE_MAP[item.type] || 'Normal');
        return String(item.text).split(/\r?\n/).map(seg => docxParagraph(style, seg));
      }).join('')
    : docxParagraph('Normal', '');

  const title = xmlEscape(project?.name || '剧本');
  const parts = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="SimSun" w:cs="SimSun"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="SceneHeading"><w:name w:val="Scene Heading"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:caps/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Action"><w:name w:val="Action"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Character"><w:name w:val="Character"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="120"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Dialogue"><w:name w:val="Dialogue"/><w:pPr><w:ind w:left="1440" w:right="1440"/><w:spacing w:after="120"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Parenthetical"><w:name w:val="Parenthetical"/><w:pPr><w:ind w:left="1080" w:right="1440"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Transition"><w:name w:val="Transition"/><w:pPr><w:jc w:val="right"/><w:spacing w:before="120" w:after="120"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>GreatLens</dc:creator><cp:lastModifiedBy>GreatLens</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>GreatLens Export</Application></Properties>`,
  };

  return buildZip(Object.entries(parts).map(([name, xml]) => ({
    name,
    data: Buffer.from(xml, 'utf8'),
  })));
}

export function toDOCX(project, episodeIndexes, convention) {
  const conv = normalizeConvention(convention, project);
  const items = collectScreenplayItems(project, episodeIndexes, conv);
  return buildDocxFromItems(project, items);
}

// ---------------------------------------------------------------------------
// 6) PDF 1.4：STSong-Light + UniGB-UCS2-H 显示中文，手写 xref
// ---------------------------------------------------------------------------

// PDF 字符串转义（仅用于 Helvetica 的 ASCII 文本）
function pdfEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

// 把文本编码为 UTF-16BE 十六进制（UniGB-UCS2-H 期望 UCS-2 码元）
function toUcs2Hex(text) {
  let hex = '';
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp > 0xFFFF) {
      const v = cp - 0x10000;
      hex += (0xD800 + (v >> 10)).toString(16).padStart(4, '0').toUpperCase();
      hex += (0xDC00 + (v & 0x3FF)).toString(16).padStart(4, '0').toUpperCase();
    } else {
      hex += cp.toString(16).padStart(4, '0').toUpperCase();
    }
  }
  return hex;
}

// 由条目流构造 PDF Buffer
function buildPdfFromItems(items) {
  // 把条目展开成物理行；每页约 54 行
  const lines = [];
  for (const item of items) {
    for (const seg of String(item.text).split(/\r?\n/)) {
      lines.push({ text: seg, type: item.type });
    }
  }
  const LINES_PER_PAGE = 54;
  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (!pages.length) pages.push([{ text: '', type: 'action' }]);

  const pageCount = pages.length;
  const pageRefs = pages.map((_, i) => `${6 + 2 * i} 0 R`).join(' ');
  const maxObj = 2 * pageCount + 5; // 最后一页内容流的对象号

  const parts = [];
  const offsets = new Array(maxObj + 1).fill(0);
  // PDF 头 + 二进制标记注释（帮助阅读器识别为二进制文件）
  const header = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
  parts.push(header);
  let pos = header.length;

  // 所有对象体均为 ASCII，按 latin1 写回即 1 字节 1 字符，偏移可控
  function addObject(num, body) {
    offsets[num] = pos;
    const b = Buffer.from(`${num} 0 obj\n${body}\nendobj\n`, 'latin1');
    parts.push(b);
    pos += b.length;
  }

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageCount} >>`);
  // F1：Adobe 标准中文 CJK 字体，无需内嵌
  addObject(3, '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>');
  addObject(4, '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 >>');
  // F2：英文场景标题用 Helvetica-Bold 模拟粗体
  addObject(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pages.forEach((pageLines, idx) => {
    const pageNum = 6 + 2 * idx;
    const contentNum = pageNum + 1;
    addObject(pageNum, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 5 0 R >> >> /Contents ${contentNum} 0 R >>`);

    let content = 'BT\n/F1 12 Tf\n16 TL\n54 788 Td\n';
    for (const line of pageLines) {
      const text = line.text;
      if (!text) {
        content += 'T*\n';
      } else if (line.type === 'scene' && /^[\x00-\x7F]+$/.test(text)) {
        // 纯英文场景标题：Helvetica-Bold + 大写，模拟粗体
        content += `/F2 12 Tf\n(${pdfEscape(text.toUpperCase())}) Tj\nT*\n`;
      } else {
        // 中文 / 其它内容：STSong-Light，UTF-16BE 十六进制
        content += `/F1 12 Tf\n<${toUcs2Hex(text)}> Tj\nT*\n`;
      }
    }
    content += 'ET\n';
    addObject(contentNum, `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
  });

  // xref 表：偏移为各对象的字节起始位置
  const xrefOffset = pos;
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxObj; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(parts);
}

export function toPDF(project, episodeIndexes, convention) {
  const conv = normalizeConvention(convention, project);
  return buildPdfFromItems(collectScreenplayItems(project, episodeIndexes, conv));
}

// ---------------------------------------------------------------------------
// 7) 统一出口：exportRender
// ---------------------------------------------------------------------------

// 生成安全文件名：去除路径分隔符 / 控制字符 / 引号，中文保留，附加正确扩展名
function safeBaseName(name) {
  let s = String(name ?? '剧本').trim();
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, '_').slice(0, 80);
  return s || '剧本';
}

const CONTENT_TYPES = {
  fdx: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

export function exportRender(project, { format = 'txt', kind = 'screenplay', episodeIndexes, convention } = {}) {
  const f = String(format || 'txt').toLowerCase();
  const k = String(kind || 'screenplay').toLowerCase();
  const conv = normalizeConvention(convention, project);

  if (!CONTENT_TYPES[f]) throw new Error(`不支持的导出格式：${f}`);
  // 大纲只允许 txt / docx / pdf
  if (k === 'outline' && !['txt', 'docx', 'pdf'].includes(f)) {
    throw new Error('大纲仅支持 txt / docx / pdf 格式');
  }

  let body;
  if (k === 'outline') {
    if (f === 'txt') body = buildOutlineText(project, episodeIndexes);
    else if (f === 'docx') body = buildDocxFromItems(project, collectOutlineItems(project, episodeIndexes));
    else body = buildPdfFromItems(collectOutlineItems(project, episodeIndexes));
  } else {
    if (f === 'fdx') body = toFDX(project, episodeIndexes);
    else if (f === 'txt') body = toTXT(project, episodeIndexes, conv);
    else if (f === 'docx') body = toDOCX(project, episodeIndexes, conv);
    else body = toPDF(project, episodeIndexes, conv);
  }

  const suffix = k === 'outline' ? '-大纲' : '';
  return {
    filename: `${safeBaseName(project?.name)}${suffix}.${f}`,
    contentType: CONTENT_TYPES[f],
    body, // 文本格式（txt/fdx）为 string，二进制格式（docx/pdf）为 Buffer
  };
}
