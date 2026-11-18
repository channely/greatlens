// attachments.js —— 零第三方依赖的用户附件解析器
// 把上传的 DOCX / PDF / Markdown / TXT 解析为纯文本，供「加入知识库 / 据此新建项目」使用。
// 所有解析都在内存中完成：不写临时文件、不执行任何上传内容。
//
// 仅使用 Node 内置模块（node:zlib）。ESM 导出，函数可被单测直接调用。

import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

// 安全的 uint16 小端读取：越界返回 0
function u16(buf, off) {
  if (!Buffer.isBuffer(buf) || off < 0 || off + 2 > buf.length) return 0;
  return buf.readUInt16LE(off);
}

// 安全的 uint32 小端读取：越界返回 0
function u32(buf, off) {
  if (!Buffer.isBuffer(buf) || off < 0 || off + 4 > buf.length) return 0;
  return buf.readUInt32LE(off);
}

// 附件带 status 的统一报错
function attachmentError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// UTF-8 解码并去掉 BOM（含 UTF-8 BOM，顺手兼容 UTF-16 BOM）
function decodeUtf8(buffer) {
  let s = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); // 去 UTF-8 BOM
  return s;
}

// 折叠多余空行：规范化换行为 \n，并把连续 4 个及以上换行压成 3 个（最多保留 2 个空行）
function collapseBlankLines(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

// XML / HTML 数字实体与命名实体解码（单次扫描，避免二次解码）
function decodeXmlEntities(s) {
  return String(s ?? '').replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,
    (full, ent) => {
      switch (ent) {
        case 'amp': return '&';
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
      }
      try {
        const cp = ent[1] === 'x' || ent[1] === 'X'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
        if (!Number.isFinite(cp)) return full;
        return String.fromCodePoint(cp);
      } catch {
        return full;
      }
    },
  );
}

// ---------------------------------------------------------------------------
// 最小 ZIP 读取器（用于 DOCX）
// ---------------------------------------------------------------------------

const SIG_LOCAL = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 local file header
const SIG_CENTRAL = [0x50, 0x4b, 0x01, 0x02]; // PK\x01\x02 central directory header
const SIG_DESC = [0x50, 0x4b, 0x07, 0x08]; // PK\x07\x08 data descriptor
const SIG_EOCD = 0x06054b50; // End of central directory signature

// 从 buf[from..] 起查找 4 字节签名，返回下标，找不到返回 -1
function findSignature(buf, from, sig) {
  const last = buf.length - sig.length;
  for (let i = Math.max(0, from); i <= last; i++) {
    if (buf[i] === sig[0] && buf[i + 1] === sig[1] && buf[i + 2] === sig[2] && buf[i + 3] === sig[3]) {
      return i;
    }
  }
  return -1;
}

// 反向扫描 End of Central Directory（注释最长 65535 字节）
function findEocd(buf) {
  const start = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= start; i--) {
    if (u32(buf, i) === SIG_EOCD) {
      const commentLen = u16(buf, i + 20);
      if (i + 22 + commentLen <= buf.length) return i;
    }
  }
  return -1;
}

// 解析 central directory，返回指定条目元数据；找不到返回 null
function findCentralEntry(buf, targetName) {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;

  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16); // central directory 起始偏移

  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) break; // 不是 central header，提前结束
    const flags = u16(buf, p + 8);
    const method = u16(buf, p + 10);
    const compSize = u32(buf, p + 20);
    const uncompSize = u32(buf, p + 24);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOffset = u32(buf, p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    if (name === targetName) {
      return { flags, method, compSize, uncompSize, localOffset };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// 根据已知元数据从 local header 中读出并解压条目
function inflateEntry(buf, meta) {
  const { flags, method, compSize, localOffset } = meta;
  if (u32(buf, localOffset) !== 0x04034b50) return null;

  const nameLen = u16(buf, localOffset + 26);
  const extraLen = u16(buf, localOffset + 28);
  const dataOffset = localOffset + 30 + nameLen + extraLen;
  if (dataOffset > buf.length) return null;

  let end = dataOffset + compSize;
  if (!(compSize > 0)) {
    // size 为 0 且带 bit 3 data descriptor：从下一个 PK 签名推断数据结束位置
    const candidates = [SIG_DESC, SIG_CENTRAL, SIG_LOCAL]
      .map((sig) => findSignature(buf, dataOffset, sig))
      .filter((x) => x >= 0);
    if (!candidates.length) return null;
    end = Math.min(...candidates);
  }
  if (end > buf.length) end = buf.length;

  const raw = buf.slice(dataOffset, end);
  if (method === 0) return raw; // store，不压缩
  if (method === 8) return zlib.inflateRawSync(raw); // deflate
  return null; // 不支持的压缩方法
}

// 兜底：直接扫描 local file header（当 EOCD / central directory 不可用时）
function readEntryByLocalScan(buf, targetName) {
  for (let p = 0; p <= buf.length - 30; p++) {
    if (u32(buf, p) !== 0x04034b50) continue;
    const flags = u16(buf, p + 6);
    const method = u16(buf, p + 8);
    const compSize = u32(buf, p + 18);
    const nameLen = u16(buf, p + 26);
    const extraLen = u16(buf, p + 28);
    if (nameLen <= 0 || p + 30 + nameLen > buf.length) continue;
    const name = buf.slice(p + 30, p + 30 + nameLen).toString('utf8');
    if (name !== targetName) continue;

    const dataOffset = p + 30 + nameLen + extraLen;
    let end = dataOffset + compSize;
    if (!(compSize > 0)) {
      const candidates = [SIG_DESC, SIG_CENTRAL]
        .map((sig) => findSignature(buf, dataOffset, sig))
        .filter((x) => x >= 0);
      // 下一个 local header 从 p 之后开始找
      const nextLocal = findSignature(buf, dataOffset, SIG_LOCAL);
      if (nextLocal >= 0) candidates.push(nextLocal);
      if (!candidates.length) return null;
      end = Math.min(...candidates);
    }
    if (end > buf.length) end = buf.length;
    const raw = buf.slice(dataOffset, end);
    if (method === 0) return raw;
    if (method === 8) return zlib.inflateRawSync(raw);
    return null;
  }
  return null;
}

// 读取 ZIP 中指定名称的条目内容（Buffer）
function readZipEntry(buf, name) {
  const meta = findCentralEntry(buf, name);
  if (meta) {
    try {
      const out = inflateEntry(buf, meta);
      if (out) return out;
    } catch {
      // central directory 信息异常时回退到 local scan
    }
  }
  return readEntryByLocalScan(buf, name);
}

// ---------------------------------------------------------------------------
// DOCX 解析
// ---------------------------------------------------------------------------

// 把 word/document.xml 转换为纯文本：保留段落 / 制表符 / 换行，去掉其余标签并解码实体
function documentXmlToText(xml) {
  let s = String(xml ?? '');
  s = s.replace(/<\/w:p\s*>/g, '\n'); // 段落结束 → 换行
  s = s.replace(/<w:tab\b[^>]*\/?>/g, '\t'); // 制表符
  s = s.replace(/<w:br\b[^>]*\/?>/g, '\n'); // 软换行
  s = s.replace(/<w:cr\b[^>]*\/?>/g, '\n'); // 回车
  s = s.replace(/<[^>]+>/g, ''); // 去掉其余 XML 标签
  s = decodeXmlEntities(s);
  return collapseBlankLines(s);
}

/**
 * 解析 DOCX（本质是 ZIP 包）为纯文本。
 * @param {Buffer} buffer DOCX 文件字节
 * @returns {{ text: string, kind: 'docx', warning?: string }}
 */
export function parseDocx(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw attachmentError('DOCX 内容必须是 Buffer', 400);
  }

  const xmlBuffer = readZipEntry(buffer, 'word/document.xml');
  if (!xmlBuffer) {
    return {
      text: '',
      kind: 'docx',
      warning: '未找到 word/document.xml，文件可能不是有效的 DOCX',
    };
  }

  try {
    return {
      text: documentXmlToText(xmlBuffer.toString('utf8')),
      kind: 'docx',
    };
  } catch (err) {
    return {
      text: '',
      kind: 'docx',
      warning: `DOCX 解析失败：${err?.message || String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// PDF 解析（尽力而为）
// ---------------------------------------------------------------------------

// 字节流按 UTF-16BE 解码（处理 BOM）
function utf16beToString(bytes) {
  let off = 0;
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) off = 2;
  const len = bytes.length - off;
  const even = len - (len % 2);
  const swapped = Buffer.allocUnsafe(even);
  for (let i = 0; i < even; i += 2) {
    swapped[i] = bytes[off + i + 1];
    swapped[i + 1] = bytes[off + i];
  }
  return swapped.toString('utf16le');
}

// 十六进制字符串 <...> → 文本（按 UTF-16BE 解码；异常时退回单字节 latin1）
function decodePdfHexString(hex) {
  let h = String(hex ?? '').replace(/[^0-9a-fA-F]/g, '');
  if (!h) return '';
  if (h.length % 2) h += '0'; // 奇数位补 0
  const bytes = Buffer.from(h, 'hex');
  if (bytes.length < 2) return bytes.toString('latin1');

  const asUtf16 = utf16beToString(bytes);
  let bad = 0;
  for (const ch of asUtf16) {
    const cp = ch.codePointAt(0);
    if (ch === '\uFFFD' || (cp < 32 && ch !== '\n' && ch !== '\r' && ch !== '\t')) bad++;
  }
  // 若 UTF-16BE 解出大量替换符 / 控制字符，则按单字节解读
  if (asUtf16.length && bad / asUtf16.length > 0.3) return bytes.toString('latin1');
  return asUtf16;
}

// 解析 PDF 字面字符串 (...)：支持嵌套括号与 \( \) \\ \n \r \t \b \f 和 \ddd 八进制
function parsePdfLiteralString(s, start) {
  let i = start + 1;
  let depth = 1;
  let out = '';
  const n = s.length;

  while (i < n && depth > 0) {
    const c = s[i];
    if (c === '\\') {
      i++;
      if (i >= n) break;
      const e = s[i];
      switch (e) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case '\n': break; // 行继续符，忽略
        case '\r': if (s[i + 1] === '\n') i++; break;
        default:
          if (e >= '0' && e <= '7') {
            let oct = e;
            let count = 1;
            while (count < 3 && i + 1 < n && s[i + 1] >= '0' && s[i + 1] <= '7') {
              oct += s[++i];
              count++;
            }
            out += String.fromCharCode(parseInt(oct, 8));
          } else {
            out += e; // \( \) \\ 及其它转义按字面处理
          }
      }
      i++;
      continue;
    }
    if (c === '(') { depth++; out += c; i++; continue; }
    if (c === ')') { depth--; if (depth > 0) out += c; i++; continue; }
    out += c;
    i++;
  }
  return { value: out, next: i };
}

// 字面字符串若带 UTF-16BE BOM，则按 UTF-16BE 解码
function decodePdfLiteralText(value) {
  if (value.length >= 2 && value.charCodeAt(0) === 0xFE && value.charCodeAt(1) === 0xFF) {
    return utf16beToString(Buffer.from(value.slice(2), 'latin1'));
  }
  return value;
}

// 把内容流切成 token：字符串 / 数组括号 / 名称 / 关键字或数字
function tokenizeContent(s) {
  const tokens = [];
  const n = s.length;
  const DELIM = /[\s()<>\[\]{}%\/]/;
  let i = 0;

  while (i < n) {
    const c = s[i];
    if (c === '%') { // 注释直到行尾
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++;
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') {
      const r = parsePdfLiteralString(s, i);
      tokens.push({ t: 'str', v: decodePdfLiteralText(r.value) });
      i = r.next;
      continue;
    }
    if (c === '<') {
      if (s[i + 1] === '<') { i += 2; continue; } // 字典 << 起始，忽略
      const end = s.indexOf('>', i + 1);
      if (end < 0) { i = n; continue; }
      tokens.push({ t: 'str', v: decodePdfHexString(s.slice(i + 1, end)) });
      i = end + 1;
      continue;
    }
    if (c === '>') { i++; continue; } // 忽略 >> 及单个 >
    if (c === '[') { tokens.push({ t: 'bracketOpen' }); i++; continue; }
    if (c === ']') { tokens.push({ t: 'bracketClose' }); i++; continue; }
    if (c === '/') { // 名称，如 /F1
      let j = i + 1;
      while (j < n && !DELIM.test(s[j])) j++;
      tokens.push({ t: 'name', v: s.slice(i, j) });
      i = j;
      continue;
    }
    // 数字或关键字（Tj / TJ / T* / Tf ...）
    let j = i;
    while (j < n && !DELIM.test(s[j])) j++;
    if (j === i) { i++; continue; } // 防御性：避免死循环
    tokens.push({ t: 'word', v: s.slice(i, j) });
    i = j;
  }
  return tokens;
}

// 从一次 BT...ET 块的 token 序列中提取文本
function extractTextFromTokens(tokens) {
  let out = '';
  let lastStr = null; // 最近一个字符串操作数，供 Tj / ' / " 使用

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'str') { lastStr = tk.v; continue; }
    if (tk.t !== 'word') continue;

    const op = tk.v;
    if (op === 'Tj' || op === "'" || op === '"') {
      // ' 与 " 的 PDF 语义是「先换行、再显示文本」（' ≈ T* 后接 Tj）
      if (op === "'" || op === '"') out += '\n';
      if (lastStr != null) out += lastStr;
      lastStr = null;
    } else if (op === 'TJ') {
      // TJ 数组：[<...> -120 <...>] TJ —— 忽略数字（字距调整），只拼接字符串
      let j = i - 1;
      while (j >= 0 && tokens[j].t !== 'bracketOpen') j--;
      if (j >= 0) {
        for (let k = j + 1; k < tokens.length && tokens[k].t !== 'bracketClose'; k++) {
          if (tokens[k].t === 'str') out += tokens[k].v;
        }
      }
      lastStr = null;
    } else if (op === 'T*' || op === 'Td' || op === 'TD') {
      out += '\n'; // 换行类操作符
      lastStr = null;
    } else {
      lastStr = null; // Tf / TL / cm 等其它操作符清空挂起字符串
    }
  }
  return out;
}

// 在字符串中查找独立单词（前后是分隔符）
function findWord(s, word, from) {
  let p = from;
  while ((p = s.indexOf(word, p)) >= 0) {
    const before = p === 0 ? '' : s[p - 1];
    const after = s[p + word.length] || '';
    if (!/\w/.test(before) && !/\w/.test(after)) return p;
    p += word.length;
  }
  return -1;
}

// 从内容流提取所有 BT...ET 块的文本；每块结束补一个换行
function extractTextFromContent(content) {
  const s = String(content ?? '');
  let out = '';
  let idx = 0;

  while (true) {
    const bt = findWord(s, 'BT', idx);
    if (bt < 0) break;
    const et = findWord(s, 'ET', bt + 2);
    const blockEnd = et < 0 ? s.length : et;
    out += extractTextFromTokens(tokenizeContent(s.slice(bt + 2, blockEnd)));
    out += '\n';
    idx = blockEnd + 2 > s.length ? s.length : blockEnd + 2;
  }
  return out;
}

// 用内容流特征（BT / Tj / TJ / T* 数量）评估解码结果，挑最像内容流的那个
function contentScore(s) {
  const str = String(s ?? '');
  return (str.match(/\bBT\b/g) || []).length
    + (str.match(/\bTj\b/g) || []).length
    + (str.match(/\bTJ\b/g) || []).length
    + (str.match(/T\*/g) || []).length;
}

// FlateDecode 解码：zlib 包装 / 裸 deflate 都试一遍，取特征分数最高者
function decodePdfStream(raw) {
  let best = raw;
  let bestScore = contentScore(raw.toString('latin1'));
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
    try {
      const out = fn(raw);
      const sc = contentScore(out.toString('latin1'));
      if (sc > bestScore) {
        best = out;
        bestScore = sc;
      }
    } catch {
      // 非压缩流会在这里抛错，忽略即可
    }
  }
  return best;
}

// 遍历 PDF 里的 stream ... endstream，回调收到原始字节切片
function forEachPdfStream(buf, cb) {
  const s = buf.toString('latin1'); // 1 字节 1 字符，索引即字节偏移
  let from = 0;
  while (true) {
    const start = s.indexOf('stream', from);
    if (start < 0) break;
    const before = start === 0 ? '' : s[start - 1];
    if (/[A-Za-z0-9]/.test(before)) { from = start + 6; continue; }

    let p = start + 6;
    if (s[p] === '\r') p++;
    if (s[p] === '\n') p++;
    if (s[start + 6] !== '\r' && s[start + 6] !== '\n') { from = start + 6; continue; }

    const end = s.indexOf('endstream', p);
    if (end < 0) break;
    let dataEnd = end;
    if (s[dataEnd - 1] === '\n') dataEnd--;
    if (s[dataEnd - 1] === '\r') dataEnd--;
    cb(buf.slice(p, dataEnd));
    from = end + 9; // 'endstream'.length
  }
}

/**
 * 解析 PDF 为纯文本（尽力而为，非 100% 精确）。
 * 支持 FlateDecode 压缩流、BT...ET 块、Tj / TJ / ' / " 操作符，
 * 字面字符串与十六进制字符串（UTF-16BE）。
 * @param {Buffer} buffer PDF 文件字节
 * @returns {{ text: string, kind: 'pdf', pages: number, warning: string }}
 */
export function parsePdf(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw attachmentError('PDF 内容必须是 Buffer', 400);
  }

  let rawText = '';
  try {
    forEachPdfStream(buffer, (raw) => {
      const decoded = decodePdfStream(raw);
      rawText += extractTextFromContent(decoded.toString('latin1'));
    });
  } catch (err) {
    // 单个流解析失败不应中断整个文件
    rawText += '';
  }
  const text = collapseBlankLines(rawText);

  // 统计页面：/Type /Page（\b 保证不匹配 /Pages）
  const latin = buffer.toString('latin1');
  const pageCount = (latin.match(/\/Type\s*\/Page\b/g) || []).length;

  const baseWarning = 'PDF 文本提取为尽力而为，复杂排版、字体编码或扫描件可能导致提取不完整';
  let warning = baseWarning;
  if (text.replace(/\s/g, '').length < 20) {
    warning = `PDF 可能为扫描件或使用了未支持的字体编码，建议手动核对；${baseWarning}`;
  }
  if (pageCount === 0) {
    warning += '；未能统计到页面对象（可能使用了对象流）';
  }

  return { text, kind: 'pdf', pages: pageCount, warning };
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------

const EXT_KIND = {
  '.docx': 'docx',
  '.pdf': 'pdf',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
};

const MIME_KIND = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/pdf': 'pdf',
  'text/markdown': 'md',
  'text/x-markdown': 'md',
  'text/plain': 'txt',
};

/**
 * 按文件名（必要时用 mime 兜底）解析附件为纯文本。
 * @param {Buffer} buffer 文件内容
 * @param {string} filename 文件名，用于判定类型
 * @param {string} [mime] MIME 类型，可空；仅在无扩展名时兜底
 * @returns {{ text: string, kind: string, pages?: number, warning?: string }}
 */
export function parseAttachment(buffer, filename, mime) {
  if (!Buffer.isBuffer(buffer)) {
    throw attachmentError('附件内容必须是 Buffer', 400);
  }

  const name = String(filename ?? '').toLowerCase();
  const m = name.match(/\.([a-z0-9]+)\s*$/);
  const ext = m ? `.${m[1]}` : '';
  let kind = EXT_KIND[ext];

  // 仅当没有扩展名时，用 mime 兜底判定
  if (!kind && !ext && mime) {
    kind = MIME_KIND[String(mime).toLowerCase().split(';')[0].trim()];
  }

  if (kind === 'docx') return parseDocx(buffer);
  if (kind === 'pdf') return parsePdf(buffer);
  if (kind === 'md' || kind === 'txt') {
    return { text: decodeUtf8(buffer), kind };
  }

  throw attachmentError(`不支持的文件类型：${ext || '(无扩展名)'}`, 415);
}

// 支持的扩展名列表
export function supportedExtensions() {
  return ['.docx', '.pdf', '.md', '.markdown', '.txt'];
}
