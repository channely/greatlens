// 上下文生成：从真实项目字段组装 grounded prompt，成功后按既定槽位回填。
import { db } from './store.js';
import { generateImage, generateVideo } from './media.js';
import { bindAsset } from './bindings.js';

const bad = (message, status = 400) => Object.assign(new Error(message), { status });

function targetOf(project, body) {
  const kind = String(body.targetKind || 'project');
  const id = String(body.targetId || project.id);
  const slot = String(body.slot || 'lookImage');
  const episodeId = String(body.episodeId || project.episodes?.[0]?.id || '');
  if (kind === 'project') return { name: project.name, fields: [project.logline, project.cover?.logline, project.synopsis] };
  if (kind === 'character') {
    const t = (project.characters || []).find(x => x.id === id);
    if (!t) throw bad('角色不存在', 404);
    return { name: t.name, fields: [t.look, t.voice, t.bio] };
  }
  if (kind === 'location') {
    const t = (project.locations || []).find(x => x.id === id);
    if (!t) throw bad('地点不存在', 404);
    return { name: t.name, fields: [t.shooting, t.time, t.weather, t.light, t.notes] };
  }
  if (kind === 'prop') {
    const t = (project.props || []).find(x => x.id === id);
    if (!t) throw bad('道具不存在', 404);
    return { name: t.name, fields: [t.purpose, t.states, t.continuity, t.constraint] };
  }
  const ep = (project.episodes || []).find(e => e.id === episodeId);
  const collection = kind === 'shot' ? 'shots' : 'scenes';
  const t = (ep?.[collection] || []).find(x => x.id === id || x.nodeId === id);
  if (!t) throw bad('场景 / 镜头不存在', 404);
  return { name: t.text || t.scene || t.title || '', fields: [t.visual, t.audio, t.notes, t.shotSize, t.camera, t.motion] };
}

function groundedPrompt(project, body, target, prevFrame = '') {
  const base = [
    `项目：${project.name}`,
    project.cover?.logline || project.logline ? `故事线：${project.cover?.logline || project.logline}` : '',
    Object.values(project.worldview || {}).filter(Boolean).slice(0, 3).join('；'),
    `对象：${target.name}`,
    target.fields.filter(Boolean).join('；'),
    `用途：${body.purpose || 'scene'}`,
    prevFrame ? '连续性：必须以前一分镜图为视觉参考，保持人物、服装、光线、视线方向一致' : '',
  ].filter(Boolean).join('\n');
  const extra = String(body.extraPrompt || '').trim();
  return extra ? `${base}\n补充要求：${extra}` : base;
}

// 电影海报是独立视觉产物：片名 + 故事线 + 调性 + 主要角色/地点，而不是普通场景静帧。
function posterPrompt(project, body) {
  const title = project.cover?.title || project.name;
  const lines = [
    `电影海报设计，${title}`,
    project.cover?.subtitle ? `副标题：${project.cover.subtitle}` : '',
    project.cover?.logline || project.logline ? `故事线：${project.cover?.logline || project.logline}` : '',
    Object.entries(project.worldview || {}).filter(([, v]) => v).slice(0, 5).map(([k, v]) => `${k}：${v}`).join('；'),
    (project.characters || []).slice(0, 3).map(c => c.name).filter(Boolean).join('、') ? `主要人物：${(project.characters || []).slice(0, 3).map(c => c.name).filter(Boolean).join('、')}` : '',
    (project.locations || []).slice(0, 2).map(l => l.name).filter(Boolean).join('、') ? `关键场景：${(project.locations || []).slice(0, 2).map(l => l.name).filter(Boolean).join('、')}` : '',
    '海报构图：主体居中、标题区留出负空间、电影级调色，没有可读的伪文字',
  ].filter(Boolean).join('\n');
  const extra = String(body.extraPrompt || '').trim();
  return extra ? `${lines}\n补充要求：${extra}` : lines;
}

// 虚拟制片环境基底：MVP 用现有图像生成静态背景；DSL 中 environment 仅占位。
function virtualBackgroundPrompt(project, body) {
  const dsl = project.virtual?.dsl;
  const env = dsl?.environment || {};
  const lines = [
    `科普短视频背景概念图：${project.name}`,
    dsl?.meta?.title ? `主题：${dsl.meta.title}` : '',
    '细胞内部微观世界，扁平科普插画风格，柔和发光，中心留白供角色对话，无文字、无水印',
    env.note ? `说明：${String(env.note).slice(0, 120)}` : '',
  ].filter(Boolean).join('\n');
  const extra = String(body.extraPrompt || '').trim();
  return extra ? `${lines}\n补充要求：${extra}` : lines;
}

// 分镜连续性硬约束（对齐 laper）：后续镜头要求前帧时，若前一镜没有可用的分镜图，
// 在派发任务之前阻断——不发任务、不扣费。参考位次序固定，不可对调。
function continuityFrame(project, body) {
  if (body.requirePrevFrame !== true || body.purpose !== 'storyboard') return null;
  const episodeId = String(body.episodeId || project.episodes?.[0]?.id || '');
  const ep = (project.episodes || []).find(e => e.id === episodeId);
  const shots = ep?.shots || [];
  const idx = shots.findIndex(s => s.id === body.targetId);
  if (idx <= 0) throw bad('连续性要求前一镜头，但当前镜头不存在或已是第一镜', 428);
  const prev = shots[idx - 1];
  const frame = prev?.storyboardImage?.url || prev?.storyboardImage || prev?.refImage?.url || prev?.refImage;
  if (!frame) throw bad(`第 ${idx} 镜要求前帧接续，但第 ${idx - 1} 镜还没有分镜图；已阻断生成，未提交任务也未扣费`, 428);
  return frame;
}

export async function createGeneration(projectId, body = {}) {
  const project = db.all().projects.find(p => p.id === projectId);
  if (!project) throw bad('项目不存在', 404);
  const purpose = String(body.purpose || 'scene');
  const isPoster = purpose === 'poster';
  const isVirtualBg = purpose === 'virtual-background';
  if (isVirtualBg && project.type !== 'virtual') throw bad('virtual-background 仅用于 virtual 项目', 422);
  // 连续性检查必须发生在任何 generateImage / generateVideo 之前。
  const prevFrame = continuityFrame(project, body);
  // 海报/虚拟背景都基于项目整体，不需要实体目标。
  const target = (isPoster || isVirtualBg) ? { name: project.name, fields: [] } : targetOf(project, body);
  const prompt = isPoster ? posterPrompt(project, body)
    : isVirtualBg ? virtualBackgroundPrompt(project, body)
    : groundedPrompt(project, body, target, prevFrame);
  const binding = body.skipBinding ? null : {
    kind: isPoster || isVirtualBg ? 'project' : String(body.targetKind || 'project'),
    projectId,
    entityId: isPoster || isVirtualBg ? project.id : String(body.targetId || project.id),
    episodeId: isPoster || isVirtualBg ? '' : String(body.episodeId || project.episodes?.[0]?.id || ''),
    slot: isPoster ? 'posterImage' : isVirtualBg ? 'background' : String(body.slot || 'lookImage'),
  };
  const request = { purpose, targetKind: binding?.kind || '', targetId: binding?.entityId || '', prompt, extraPrompt: body.extraPrompt || '' };

  let result;
  if (purpose === 'trailer') {
    result = await generateVideo({
      prompt, projectId,
      duration: body.duration || 5,
      resolution: body.resolution || '480P',
      model: body.model,
      negativePrompt: body.negativePrompt,
    });
  } else {
    result = await generateImage({
      prompt, projectId,
      size: body.size || '1024*1024',
      model: body.model,
      negativePrompt: body.negativePrompt,
      n: 1,
    });
  }

  db.update(d => {
    const task = d.tasks.find(t => t.taskId === result.taskId || t.id === result.taskId);
    if (task) Object.assign(task, {
      purpose, binding, request,
      bindingStatus: binding ? 'pending' : 'skipped',
      usageRecordedAt: task.usageRecordedAt || '',
    });
  });

  if (binding && result.status === 'succeeded' && result.assets?.length) {
    try {
      const bound = bindAsset(result.assets[0].id, binding, '生成后自动回填');
      db.update(d => {
        const task = d.tasks.find(t => t.taskId === result.taskId || t.id === result.taskId);
        if (task) Object.assign(task, { bindingStatus: 'bound', boundAssetId: bound.asset.id });
      });
      result.boundRef = bound.ref;
    } catch (e) {
      db.update(d => {
        const task = d.tasks.find(t => t.taskId === result.taskId || t.id === result.taskId);
        if (task) Object.assign(task, { bindingStatus: 'needs-review', bindingError: e.message });
      });
      result.bindingError = e.message;
    }
  }

  return { ...result, prompt, purpose, binding };
}
