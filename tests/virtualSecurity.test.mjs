import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeModelUrl, resolveModel, clampControls } from '../server/virtualScene.js';
import { validateDsl, applyPatches } from '../server/virtualDsl.js';
import { organelleDialogueTemplate } from '../server/virtualDsl.js';
import { validateVideoBuffer } from '../server/virtualRender.js';

test('成片校验拒绝损坏/空白/伪造 WebM（导出无法观看的根因防线）', () => {
  // 用户实际遇到的 7 字节残片
  assert.match(validateVideoBuffer(Buffer.from('a29bac6dab1eeb', 'hex')), /过小|无效/);
  assert.match(validateVideoBuffer(Buffer.alloc(0)), /空/);
  // 有 EBML 头但体积不足
  assert.match(validateVideoBuffer(Buffer.from('1a45dfa3', 'hex')), /过小/);
  // 体积够但没有 EBML 魔数（例如 MP4 冒充 webm）
  const noMagic = Buffer.alloc(2048, 0);
  assert.match(validateVideoBuffer(noMagic), /不是 WebM/);
  // 合法 stub：EBML 头 + 足量字节
  const good = Buffer.concat([Buffer.from('1a45dfa340204286810142f7810142f2830e4e5dc0', 'hex'), Buffer.alloc(2000, 0)]);
  assert.equal(validateVideoBuffer(good), null);
});

test('拒绝路径穿越与远程协议（防 SSRF / 任意文件读取）', () => {
  const bad = [
    '/models/../../etc/passwd', '/models/%2e%2e/secret', '//evil.com/x.glb',
    'https://evil.com/x.glb', 'http://127.0.0.1/admin', 'file:///etc/passwd',
    '/models\\..\\secret', 'javascript:alert(1)', '/api/settings',
  ];
  for (const u of bad) assert.equal(isSafeModelUrl(u), false, `应拒绝：${u}`);
  assert.equal(isSafeModelUrl('/models/nucleus/asset.glb'), true);
  assert.equal(isSafeModelUrl('/media/upload-x.png'), true);
  assert.throws(() => resolveModel('https://evil.com/x.glb'), /不允许的模型 URL/);
});

test('controls 只接受白名单键与合法范围', () => {
  const out = clampControls({
    color: '#ff0000', scale: 999, emissiveIntensity: -5, rotationY: 100,
    visible: 'yes', evil: 'alert(1)', __proto__: { polluted: true },
  }, { runtimeControls: ['color', 'scale', 'emissiveIntensity', 'rotationY', 'visible'] });
  assert.equal(out.color, '#ff0000');
  assert.equal(out.scale, 20, 'scale 应被钳制');
  assert.equal(out.emissiveIntensity, 0);
  assert.ok(out.rotationY <= Math.PI * 2);
  assert.equal(out.visible, true);
  assert.equal(out.evil, undefined, '未知键应被丢弃');
});

test('DSL 校验拒绝脚本注入样式的非法字段', () => {
  const t = organelleDialogueTemplate();
  t.characters[0].name = '<script>alert(1)</script>';
  // 文本字段当前原样保留（渲染层用 React 文本节点，不会执行）；这里验证结构字段不被污染
  t.characters[0].assetId = '"><img src=x onerror=alert(1)>';
  const r = validateDsl(t);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'REF'));
});

test('applyPatches 不接受非 set 操作与幻觉 path', () => {
  const t = organelleDialogueTemplate();
  const r = applyPatches(t, [
    { op: 'delete', targetId: 'sh-1', path: 'camera.fov' },
    { op: 'set', targetId: 'sh-1', path: '__proto__.evil', value: 1 },
  ], []);
  assert.equal(r.dsl, t, '任一 patch 失败应整批不生效');
  assert.ok(r.results.every(x => x.severity === 'error'));
});

test('DSL ID 规则拒绝超长与特殊字符', () => {
  const t = organelleDialogueTemplate();
  t.shots[0].id = 'x'.repeat(200);
  const r = validateDsl(t);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some(d => d.code === 'ID'));
});
