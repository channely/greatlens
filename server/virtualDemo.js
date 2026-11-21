// 内置演示案例：30 秒「细胞器对话」。一键创建可直接预演/导出的 virtual 项目。
// 全部用内置模板 + 已生成的 Polyspoon GLB，stub 模式也能跑通，无外部依赖。
import { db, uid, makeProject } from './store.js';
import { organelleDialogueTemplate, validateDsl } from './virtualDsl.js';
import { compileDsl } from './virtualInterpreter.js';
import { virtualRegistry } from './virtualScene.js';
import { stableHash } from './migrations.js';

export const DEMO_NAME = '细胞器对话 · 30 秒演示';
export const DEMO_SEED = '30 秒科普：细胞核和线粒体的对话，讲清楚细胞核控制与线粒体供能，我是不白吃风格';

export function createDemoProject(force = false) {
  const existing = db.all().projects.find(p => p.type === 'virtual' && p.name === DEMO_NAME);
  if (existing && !force) return { project: existing, created: false };

  const dsl = organelleDialogueTemplate(DEMO_SEED);
  const check = validateDsl(dsl, virtualRegistry());
  if (!check.ok) throw Object.assign(new Error(`内置演示 DSL 校验失败：${check.diagnostics.map(d => d.message).join('; ')}`), { status: 500 });
  const compiled = compileDsl(check.dsl, virtualRegistry());
  if (!compiled.ok) throw Object.assign(new Error('内置演示 DSL 编译失败'), { status: 500 });

  return db.update(d => {
    if (force && existing) d.projects = d.projects.filter(p => p.id !== existing.id);
    const p = makeProject('virtual', DEMO_NAME);
    p.virtual.dsl = check.dsl;
    p.virtual.compiled = {
      hash: compiled.hash, dslHash: stableHash(check.dsl), scenePlan: compiled.sceneGraph,
      timeline: compiled.timeline, diagnostics: compiled.diagnostics, compiledAt: new Date().toISOString(),
    };
    p.virtual.knowledgeState = compiled.knowledgeState;
    // 预置 IP 锁：主角形象与音色（风格统一的系列化生产基线）。
    p.virtual.ipLocks = [
      { id: `lock_${uid()}`, kind: 'character', refId: 'asset-nucleus', locked: true, priority: 'high', note: '细胞核主角形象锁定' },
      { id: `lock_${uid()}`, kind: 'character', refId: 'asset-mito', locked: true, priority: 'high', note: '线粒体主角形象锁定' },
      { id: `lock_${uid()}`, kind: 'voice', refId: 'voice-narrator', locked: true, priority: 'high', note: '旁白音色锁定' },
    ];
    d.projects.unshift(p);
    return { project: p, created: true };
  });
}
