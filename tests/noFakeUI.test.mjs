// 虚假功能回归检查（P0-2）：
// 静态扫描源码，防止"看起来能点、实际没效果"的装饰性入口回流。
// 只检查确定的反模式，不做脆弱的 AST 推断；命中即失败并给出文件:行号。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir, exts) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some(e => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

const srcFiles = walk(path.join(ROOT, 'src'), ['.jsx', '.js']);
const linesOf = f => fs.readFileSync(f, 'utf8').split(/\r?\n/).map((text, i) => ({ file: path.relative(ROOT, f), line: i + 1, text }));
const allLines = srcFiles.flatMap(linesOf);

// 明确的假入口模式：曾经的摆设/误导入口，修复后不应再次出现。
const BANNED = [
  { name: '侧栏假播放条 side-video', re: /className=["']side-video["']/ },
  { name: 'Login 假按钮', re: /className=["'][^"']*side-login[^"']*["'][^>]*>\s*Login/ },
  { name: '空 onClick', re: /onClick=\{\(\)\s*=>\s*\{\s*\}\}/ },
  { name: '假链接 href="#"', re: /href=["']#["']/ },
  { name: '通用 GitHub 首页链接', re: /href=["']https:\/\/github\.com\/["']/ },
  { name: 'Fountain 导入入口（无解析器，仅 FDX 支持导入）', re: /accept=["'][^"']*\.fountain[^"']*["']/ },
  { name: '误导图标 title（使用说明/协作反馈）', re: /title=["'](使用说明|协作反馈)["']/ },
];

test('源码不应含已识别的假入口模式', () => {
  const hits = [];
  for (const { name, re } of BANNED) {
    for (const { file, line, text } of allLines) {
      if (re.test(text)) hits.push(`${name} → ${file}:${line}`);
    }
  }
  assert.deepEqual(hits, [], `发现假入口模式：\n${hits.join('\n')}`);
});

test('所有前端 api 调用的后端路由都已注册', () => {
  const apiSrc = fs.readFileSync(path.join(ROOT, 'src/api.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
  // 抽取 api.js 中形如 '/xxx' 或 `/xxx` 的请求路径（含 :param 与 ${} 模板）
  const paths = [...apiSrc.matchAll(/['"`](\/(?:api\/)?[a-zA-Z0-9_:/${}.-]+)['"`]/g)]
    .map(m => m[1])
    .filter(p => p.startsWith('/api/') || p.startsWith('/'));
  const missing = [];
  for (const p of new Set(paths)) {
    if (!p.startsWith('/api/')) continue;
    // 把模板变量段与 :param 归一为占位符再比对
    const norm = p.replace(/\$\{[^}]+\}/g, 'X').replace(/:[A-Za-z_]+/g, 'X');
    const pattern = norm.split('/').map(seg => seg === 'X' ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
    const re = new RegExp(`['"\`]${pattern}['"\`]`);
    if (!re.test(serverSrc)) missing.push(p);
  }
  assert.deepEqual(missing, [], `前端调用了未注册的后端路由：\n${missing.join('\n')}`);
});
