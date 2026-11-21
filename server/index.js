import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, settings, usage, uid, makeProject, ASSETS_DIR, ROOT, ADVISORS, knowledgeIndex, searchKnowledge } from './store.js';
import { stableHash } from './migrations.js';
import { planIdeaStage, createProjectFromIdea, analyzeBrief } from './idea.js';
import { applyStartTemplate, START_TEMPLATES } from './templates.js';
import { act as aiAct } from './scriptDoctor.js';
import {
  getTaste, recordFeedback, addRule, removeRule, setTasteEnabled,
} from './taste.js';
import {
  proposeOptions, applyOption, addRevisionNote, listRevisions,
} from './revisions.js';
import {
  listVersions, getVersion, createVersion, updateVersion, deleteVersion,
  restoreVersion, autoVersionForSave,
} from './versions.js';
import { callModel } from './ai.js';
import { parseScreenplay } from './fdx.js';
import { deriveEntities, analyzeRelationships, auditContinuity, auditReadiness } from './entities.js';
import {
  generateImage, generateVideo, pollTask, listTasks, listAssets, removeAsset,
  refundTask, refundTaskCharges,
} from './media.js';
import { uploadAsset } from './assets.js';
import { createGeneration } from './generation.js';
import { planAudio, generateAudio } from './audio.js';
import { bindAsset, unbindAsset, listProjectAssets } from './bindings.js';
import { syncStatus, configureSync, pushSync, pullSync } from './sync.js';
import { exportRender } from './export.js';
import { convertScriptToCinema } from './toCinema.js';
import { parseAttachment, supportedExtensions } from './attachments.js';
import { modelCatalog, normalizeResolution } from './models.js';
import {
  organelleDialogueTemplate, validateDsl, normalizeDsl, applyPatches, dslHash,
  generateDslFromNl, parseDslText, buildDslSystemPrompt,
} from './virtualDsl.js';
import { compileDsl } from './virtualInterpreter.js';
import { virtualRegistry, loadCatalog, listVirtualAssets, bindVirtualBackground, resolveModel, clampControls } from './virtualScene.js';
import { startWorkflow, advanceWorkflow, retryStep, workflowStatus } from './virtualWorkflow.js';
import { createRenderJob, getRenderJob, completeRenderJob, generateVoiceover } from './virtualRender.js';
import { createDemoProject, DEMO_NAME, DEMO_SEED } from './virtualDemo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
// 安全：拦截恶意网页借浏览器跨域调用本机 API（DNS rebinding / CSRF）。
// 允许本机来源；开启异地共享后端时，用 GL_ALLOW_ORIGINS=域名1,域名2 放行。
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const extraOrigins = new Set((process.env.GL_ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));
function originAllowed(origin) {
  try {
    const u = new URL(origin);
    return LOCAL_HOSTS.has(u.hostname) || extraOrigins.has(u.hostname);
  } catch { return false; }
}
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin)) return res.status(403).json({ error: '来源未被允许，请设置 GL_ALLOW_ORIGINS' });
  next();
});
app.use(cors({ origin: (origin, cb) => cb(null, !origin || originAllowed(origin) ? origin : false) }));
app.use(express.json({ limit: '16mb' }));

const wrap = fn => (req, res) => {
  Promise.resolve(fn(req, res)).catch(err => {
    if (res.headersSent) return;
    res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
  });
};

// ---------- settings ----------
app.get('/api/settings', (_req, res) => res.json(settings.public()));
const NUMERIC_SETTINGS = [
  'temperature', 'priceInput', 'priceOutput',
  'imageGenPrice', 'imageInputPrice', 'videoPrice480P', 'videoPrice720P', 'videoPrice1080P', 'videoDiscount',
  'audioPriceInput', 'audioPriceOutput',
];
const ALLOWED_SETTINGS = [
  'baseUrl', 'apiKey', 'model', 'temperature', 'enableThinking',
  'priceInput', 'priceOutput', 'imageGenPrice', 'imageInputPrice',
  'videoPrice480P', 'videoPrice720P', 'videoPrice1080P', 'videoDiscount',
  'mediaBaseUrl', 'imageModel', 'videoModel', 'videoResolution',
  'workspaceId', 'audioModel',
  'syncRemote', 'syncToken', 'syncDevice', 'remoteBase',
];
app.put('/api/settings', (req, res) => {
  const patch = {};
  for (const k of ALLOWED_SETTINGS) {
    const v = req.body?.[k];
    // 前端回传的掩码（***abcd）不能覆盖真实密钥
    if (v === undefined || (typeof v === 'string' && /^\*{2,}/.test(v))) continue;
    patch[k] = k === 'enableThinking' ? (v === true || v === 'true' || v === 1)
      : NUMERIC_SETTINGS.includes(k) ? Number(v)
      : String(v);
  }
  // 分辨率只接受 480P / 720P / 1080P；折扣钳制到 0.01–1。
  if (patch.videoResolution) patch.videoResolution = normalizeResolution(patch.videoResolution);
  if (patch.videoDiscount !== undefined) {
    const d = Number(patch.videoDiscount);
    patch.videoDiscount = Number.isFinite(d) ? Math.max(0.01, Math.min(1, d)) : 1;
  }
  if (Object.keys(patch).length) settings.set(patch);
  res.json(settings.public());
});

// 模型目录与计费口径（单一事实来源，供前端下拉与价格展示）
app.get('/api/models', (_req, res) => res.json(modelCatalog()));

// ---------- usage & billing ----------
app.get('/api/usage', (req, res) => res.json(usage.report(Number(req.query.days) || 30)));
app.get('/api/usage/refunds', (_req, res) => res.json(usage.refunds()));
app.post('/api/usage/clear', (_req, res) => { usage.clear(); res.json({ ok: true }); });

// ---------- projects ----------
app.get('/api/projects', (_req, res) => {
  const d = db.all();
  res.json(d.projects.map(({ episodes, ...p }) => ({ ...p, episodeCount: episodes?.length || 0 })));
});

app.get('/api/project-templates', (_req, res) => res.json(START_TEMPLATES));

// Script → Cinema 一次性显式转换（peer 类型，不往返合并，源项目保持不变）。
app.post('/api/projects/:id/to-cinema', wrap(async (req, res) => {
  const converted = convertScriptToCinema({ sourceId: req.params.id, name: req.body?.name || '' });
  res.status(201).json(converted);
}));

app.post('/api/projects', (req, res) => {
  const { type = 'script', name = '未命名项目', template } = req.body || {};
  if (!['script', 'cinema', 'virtual'].includes(type)) return res.status(400).json({ error: 'invalid type' });
  const p = applyStartTemplate(makeProject(type, name), template);
  db.update(d => { d.projects.unshift(p); });
  res.status(201).json(p);
});

app.get('/api/projects/:id', (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

app.put('/api/projects/:id', wrap(async (req, res) => {
  const rawMatch = req.headers['if-match'] ?? req.body?.baseRevision;
  const baseRevision = rawMatch === undefined || rawMatch === null || rawMatch === ''
    ? undefined
    : Number(String(rawMatch).replace(/^"|"$/g, ''));

  const saved = db.update(d => {
    const idx = d.projects.findIndex(x => x.id === req.params.id);
    if (idx < 0) throw Object.assign(new Error('not found'), { status: 404 });
    const before = d.projects[idx];
    if (Number.isFinite(baseRevision) && baseRevision !== Number(before.revision || 1)) {
      throw Object.assign(
        new Error(`项目已被其他会话更新（当前 r${before.revision || 1}，请求基于 r${baseRevision}）。请刷新后再编辑。`),
        { status: 409 },
      );
    }
    const patch = { ...req.body, id: before.id };
    delete patch.createdAt;
    delete patch.revision;
    delete patch.versionHash;
    delete patch.baseRevision;
    patch.updatedAt = new Date().toISOString();

    const after = { ...before, ...patch };
    after.revision = Number(before.revision || 1) + 1;
    after.versionHash = stableHash(after);
    autoVersionForSave(d, before, after);
    d.projects[idx] = after;
    return after;
  });
  res.json(saved);
}));

// 项目设置：与导出弹窗共用同一 project.settings，不维护第二份状态。
app.patch('/api/projects/:id/settings', wrap(async (req, res) => {
  const baseRevision = req.body?.baseRevision;
  const saved = db.update(d => {
    const idx = d.projects.findIndex(x => x.id === req.params.id);
    if (idx < 0) throw Object.assign(new Error('not found'), { status: 404 });
    const before = d.projects[idx];
    if (baseRevision !== undefined && baseRevision !== null && Number(baseRevision) !== Number(before.revision || 1)) {
      throw Object.assign(new Error('项目已被其他会话更新，请刷新后再保存设置。'), { status: 409 });
    }
    const patch = { ...before, settings: { ...(before.settings || {}), ...(req.body?.settings || {}) } };
    if (req.body?.name !== undefined) patch.name = String(req.body.name || '').trim() || before.name;
    if (req.body?.logline !== undefined) patch.logline = String(req.body.logline || '');
    if (req.body?.synopsis !== undefined) patch.synopsis = String(req.body.synopsis || '');
    if (req.body?.cover !== undefined) patch.cover = { ...(before.cover || {}), ...(req.body.cover || {}) };
    if (req.body?.advisorId !== undefined) {
      const aid = String(req.body.advisorId || '');
      if (aid && !ADVISORS.some(a => a.id === aid)) throw Object.assign(new Error('未知顾问'), { status: 400 });
      patch.advisorId = aid; // 与工作台「顾问视角」共享同一字段
    }
    patch.revision = Number(before.revision || 1) + 1;
    patch.updatedAt = new Date().toISOString();
    patch.versionHash = stableHash(patch);
    autoVersionForSave(d, before, patch);
    d.projects[idx] = patch;
    return patch;
  });
  res.json(saved);
}));

// ---------- idea-first ----------
app.post('/api/ai/idea', wrap(async (req, res) => res.json(planIdeaStage(req.body || {}))));
// brief 专业分析填充：把一句话 seed 解构成六字段，用户可再改。模型失败自动回退本地。
app.post('/api/ai/idea/brief', wrap(async (req, res) => {
  const { seed, brief } = req.body || {};
  res.json(await analyzeBrief(seed, brief || {}));
}));
app.post('/api/projects/from-idea', wrap(async (req, res) => {
  const result = createProjectFromIdea(req.body || {});
  res.status(result.created ? 201 : 200).json(result);
}));

// ---------- project versions ----------
app.get('/api/projects/:id/versions', wrap(async (req, res) => res.json(listVersions(req.params.id))));
app.post('/api/projects/:id/versions', wrap(async (req, res) => {
  res.status(201).json(createVersion(req.params.id, req.body || {}));
}));
app.get('/api/projects/:id/versions/:versionId', wrap(async (req, res) => {
  res.json(getVersion(req.params.id, req.params.versionId));
}));
app.patch('/api/projects/:id/versions/:versionId', wrap(async (req, res) => {
  res.json(updateVersion(req.params.id, req.params.versionId, req.body || {}));
}));
app.delete('/api/projects/:id/versions/:versionId', wrap(async (req, res) => {
  res.json(deleteVersion(req.params.id, req.params.versionId));
}));
app.post('/api/projects/:id/versions/:versionId/restore', wrap(async (req, res) => {
  res.json(restoreVersion(req.params.id, req.params.versionId, req.body?.baseRevision));
}));

app.delete('/api/projects/:id', (req, res) => {
  db.update(d => { d.projects = d.projects.filter(x => x.id !== req.params.id); });
  res.json({ ok: true });
});

app.post('/api/projects/:id/episodes', (req, res) => {
  const ep = db.update(d => {
    const p = d.projects.find(x => x.id === req.params.id);
    if (!p) return null;
    const item = (p.type === 'cinema' || p.type === 'virtual')
      ? { id: uid(), title: req.body.title || `第 ${p.episodes.length + 1} 集`, reels: [] }
      : { id: uid(), title: req.body.title || `第 ${p.episodes.length + 1} 集`, nodes: [], outline: [], beats: [], scenes: [], shots: [] };
    p.episodes.push(item);
    p.updatedAt = new Date().toISOString();
    return item;
  });
  if (!ep) return res.status(404).json({ error: 'not found' });
  res.status(201).json(ep);
});

// ---------- virtual production（科普叙事导演台）----------
// 批次 1：DSL 核心。批次 2/6/7 会继续扩展 catalog/assets/render/workflow 路由。
function findVirtual(id) {
  const p = db.all().projects.find(x => x.id === id);
  if (!p || p.type !== 'virtual') return null;
  return p;
}
app.get('/api/virtual/demo', (_req, res) => res.json({ name: DEMO_NAME, seed: DEMO_SEED }));
app.post('/api/virtual/demo', wrap(async (req, res) => {
  const r = createDemoProject(req.body?.force === true);
  res.status(r.created ? 201 : 200).json(r.project);
}));
app.get('/api/virtual/catalog', (_req, res) => res.json(loadCatalog()));
app.get('/api/virtual/:id/assets', (req, res) => {
  const p = findVirtual(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(listVirtualAssets(req.params.id));
});
app.post('/api/virtual/:id/assets/bind-background', (req, res) => {
  const p = findVirtual(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  try {
    const r = bindVirtualBackground(req.params.id, String(req.body?.assetId || ''));
    res.json(r.ref);
  } catch (e) { res.status(e.status || 422).json({ error: e.message }); }
});
app.get('/api/virtual/:id/dsl', (req, res) => {
  const p = findVirtual(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({ dsl: p.virtual?.dsl || null, compiled: p.virtual?.compiled || null });
});
app.post('/api/virtual/:id/dsl', wrap(async (req, res) => {
  const p = findVirtual(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const seed = String(req.body?.seed || '').trim();
  if (!seed) return res.status(422).json({ error: '缺少创意描述 seed' });
  const result = await generateDslFromNl({ seed, registry: virtualRegistry(), brief: req.body?.brief || {} });
  // 草稿不写项目；让用户在编辑器确认后再 PUT。
  res.json(result);
}));
app.put('/api/virtual/:id/dsl', wrap(async (req, res) => {
  const rawMatch = req.headers['if-match'] ?? req.body?.baseRevision;
  const baseRevision = rawMatch === undefined || rawMatch === null || rawMatch === '' ? undefined
    : Number(String(rawMatch).replace(/^"|"$/g, ''));
  const check = validateDsl(req.body?.dsl ?? req.body, virtualRegistry());
  if (!check.ok) return res.status(422).json({ error: 'DSL 校验未通过', diagnostics: check.diagnostics });
  const saved = db.update(d => {
    const idx = d.projects.findIndex(x => x.id === req.params.id);
    if (idx < 0 || d.projects[idx].type !== 'virtual') return { missing: true };
    const before = d.projects[idx];
    if (Number.isFinite(baseRevision) && baseRevision !== Number(before.revision || 1)) return { conflict: true, revision: before.revision };
    const after = { ...before, virtual: { ...before.virtual, dsl: check.dsl } };
    after.updatedAt = new Date().toISOString();
    after.revision = (before.revision || 1) + 1;
    after.versionHash = stableHash(after);
    try { autoVersionForSave(d, before, after, { kind: 'manual', name: 'DSL 更新' }); } catch {}
    d.projects[idx] = after;
    return { project: after };
  });
  if (saved.missing) return res.status(404).json({ error: 'not found' });
  if (saved.conflict) return res.status(409).json({ error: 'revision 冲突', revision: saved.revision });
  res.json({ dsl: saved.project.virtual.dsl, revision: saved.project.revision });
}));
app.post('/api/virtual/:id/validate', (req, res) => {
  const p = findVirtual(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const check = validateDsl(req.body?.dsl ?? req.body, virtualRegistry());
  res.status(check.ok ? 200 : 422).json({ ok: check.ok, diagnostics: check.diagnostics });
});
app.post('/api/virtual/:id/compile', (req, res) => {
  const p = findVirtual(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const dsl = req.body?.dsl ?? p.virtual?.dsl;
  if (!dsl) return res.status(422).json({ error: '当前项目没有 DSL，请先生成或保存' });
  const result = compileDsl(dsl, virtualRegistry());
  if (!result.ok) return res.status(422).json(result);
  if (req.body?.persist === true) {
    db.update(d => {
      const proj = d.projects.find(x => x.id === req.params.id);
      if (!proj) return;
      proj.virtual.compiled = {
        hash: result.hash, dslHash: dslHash(dsl), scenePlan: result.sceneGraph,
        timeline: result.timeline, diagnostics: result.diagnostics, compiledAt: new Date().toISOString(),
      };
      // 知识状态从 DSL 投影；保留已存在的 transition 历史与已推进状态。
      const prevFacts = new Map((proj.virtual.knowledgeState?.facts || []).map(f => [f.id, f]));
      proj.virtual.knowledgeState = proj.virtual.knowledgeState || { facts: [], transitions: [] };
      proj.virtual.knowledgeState.facts = result.knowledgeState.facts.map(f => {
        const prev = prevFacts.get(f.id);
        return prev ? { ...f, state: prev.state } : f;
      });
    });
  }
  res.json(result);
});
app.get('/api/virtual/:id/knowledge', (req, res) => {
  const p = findVirtual(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p.virtual?.knowledgeState || { facts: [], transitions: [] });
});
app.post('/api/virtual/:id/knowledge/:kid/transition', (req, res) => {
  const p = findVirtual(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const { to } = req.body || {};
  const order = ['introduced', 'active', 'resolved'];
  if (!order.includes(to)) return res.status(422).json({ error: `非法目标状态 ${to}` });
  try {
    const saved = db.update(d => {
      const proj = d.projects.find(x => x.id === req.params.id);
      const ks = proj.virtual.knowledgeState;
      const fact = (ks.facts || []).find(f => f.id === req.params.kid);
      if (!fact) throw Object.assign(new Error('知识点不存在'), { status: 404 });
      const from = fact.state || 'introduced';
      const fromIdx = order.indexOf(from), toIdx = order.indexOf(to);
      if (toIdx < fromIdx) throw Object.assign(new Error(`不允许从 ${from} 回退到 ${to}`), { status: 422 });
      const before = structuredClone(proj);
      fact.state = to;
      ks.transitions.push({ id: uid(), factId: fact.id, from, to, at: new Date().toISOString(), by: 'user' });
      proj.updatedAt = new Date().toISOString();
      proj.revision = (proj.revision || 1) + 1;
      autoVersionForSave(d, before, proj);
      return ks;
    });
    res.json(saved);
  } catch (e) { res.status(e.status || 422).json({ error: e.message }); }
});
app.post('/api/virtual/:id/ip-locks', (req, res) => {
  try {
    const locks = db.update(d => {
      const p = d.projects.find(x => x.id === req.params.id);
      if (!p || p.type !== 'virtual') throw Object.assign(new Error('not found'), { status: 404 });
      p.virtual.ipLocks = Array.isArray(req.body?.locks) ? req.body.locks : [];
      return p.virtual.ipLocks;
    });
    res.json(locks);
  } catch (e) { res.status(e.status || 422).json({ error: e.message }); }
});

// 工作流
app.post('/api/virtual/:id/workflow', wrap(async (req, res) => {
  res.status(201).json(startWorkflow(req.params.id));
}));
app.get('/api/virtual/:id/workflow', wrap(async (req, res) => {
  const run = workflowStatus(req.params.id, req.query.runId);
  res.json(run || { steps: [] });
}));
app.post('/api/virtual/:id/workflow/:runId/:stepId/advance', wrap(async (req, res) => {
  res.json(advanceWorkflow(req.params.id, req.params.runId, req.params.stepId, req.body || {}));
}));
app.post('/api/virtual/:id/workflow/:runId/:stepId/retry', wrap(async (req, res) => {
  res.json(retryStep(req.params.id, req.params.runId, req.params.stepId));
}));

// 渲染与配音
app.post('/api/virtual/:id/render', wrap(async (req, res) => {
  res.json(await createRenderJob(req.params.id, req.body || {}));
}));
app.get('/api/virtual/:id/render/:jobId', wrap(async (req, res) => {
  res.json(getRenderJob(req.params.id, req.params.jobId));
}));
app.post('/api/virtual/:id/render/:jobId/complete', wrap(async (req, res) => {
  res.json(completeRenderJob(req.params.id, req.params.jobId, req.body || {}));
}));
app.post('/api/virtual/:id/voiceover', wrap(async (req, res) => {
  res.json(await generateVoiceover(req.params.id, req.body || {}));
}));

app.post('/api/virtual/:id/patch', (req, res) => {
  const p = findVirtual(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  if (!p.virtual?.dsl) return res.status(422).json({ error: '当前项目没有 DSL' });
  const { dsl, results } = applyPatches(p.virtual.dsl, req.body?.patches, p.virtual.ipLocks || []);
  const locked = results.some(r => r.code === 'IP_LOCK');
  const failed = results.some(r => r.severity === 'error');
  if (failed) return res.status(locked ? 409 : 422).json({ error: locked ? '字段被 IP 锁保护' : 'patch 未通过', results });
  const saved = db.update(d => {
    const idx = d.projects.findIndex(x => x.id === req.params.id);
    if (idx < 0) return null;
    const before = d.projects[idx];
    const after = { ...before, virtual: { ...before.virtual, dsl } };
    after.updatedAt = new Date().toISOString();
    after.revision = (before.revision || 1) + 1;
    after.versionHash = stableHash(after);
    try { autoVersionForSave(d, before, after); } catch {}
    d.projects[idx] = after;
    return after;
  });
  if (!saved) return res.status(404).json({ error: 'not found' });
  res.json({ dsl, results, revision: saved.revision });
});

// ---------- AI ----------
app.post('/api/ai/chat', wrap(async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  try {
    await callModel(req.body, (event, payload) => {
      if (event === 'reasoning') res.write(`data: ${JSON.stringify({ reasoning: payload })}\n\n`);
      else if (event === 'usage') res.write(`data: ${JSON.stringify({ usage: payload })}\n\n`);
      else res.write(`data: ${JSON.stringify({ delta: payload })}\n\n`);
    });
    res.write('data: [DONE]\n\n');
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
}));

app.post('/api/ai/complete', wrap(async (req, res) => {
  const r = await callModel(req.body);
  res.json({ text: r.text, reasoning: r.reasoning, usage: r.usage });
}));

// 结构化 AI 动作 / Script Doctor：默认只给提案，显式 apply 才写入项目。
app.post('/api/ai/act', wrap(async (req, res) => res.json(aiAct(req.body || {}))));

// ---------- 作者口味记忆 ----------
app.get('/api/projects/:id/taste', wrap(async (req, res) => res.json(getTaste(req.params.id))));
app.post('/api/projects/:id/taste/feedback', wrap(async (req, res) => res.json(recordFeedback(req.params.id, req.body || {}))));
app.post('/api/projects/:id/taste/rules', wrap(async (req, res) => res.status(201).json(addRule(req.params.id, req.body || {}))));
app.delete('/api/projects/:id/taste/rules/:ruleId', wrap(async (req, res) => res.json(removeRule(req.params.id, req.params.ruleId))));
app.patch('/api/projects/:id/taste', wrap(async (req, res) => res.json(setTasteEnabled(req.params.id, req.body?.enabled))));

// ---------- 草稿级修订说明 + Option 备选 ----------
app.post('/api/projects/:id/revisions/options', wrap(async (req, res) => res.json(proposeOptions({ ...req.body, projectId: req.params.id }))));
app.post('/api/projects/:id/revisions/apply', wrap(async (req, res) => res.json(applyOption({ ...req.body, projectId: req.params.id }))));
app.post('/api/projects/:id/revisions/notes', wrap(async (req, res) => res.json(addRevisionNote({ ...req.body, projectId: req.params.id }))));
app.get('/api/projects/:id/revisions', wrap(async (req, res) => res.json(listRevisions({ projectId: req.params.id, episodeId: req.query.episodeId }))));

// ---------- FDX / Fountain import ----------
app.post('/api/import/fdx', wrap(async (req, res) => {
  const xml = String(req.body?.xml || '');
  if (!xml.trim()) return res.status(400).json({ error: '文件内容为空' });
  const parsed = parseScreenplay(xml);
  if (!parsed.nodes.length) return res.status(400).json({ error: '未能从文件中解析出剧本内容' });
  let project;
  if (req.body.mode === 'merge' && req.body.projectId) {
    const d = db.all();
    const p = d.projects.find(x => x.id === req.body.projectId);
    if (!p) return res.status(404).json({ error: '目标项目不存在' });
    const ep = p.episodes?.[0];
    if (!ep) return res.status(400).json({ error: '目标项目没有可写入的剧集' });
    ep.nodes = [...(ep.nodes || []), ...parsed.nodes];
    p.characters = [...new Set([...(p.characters || []), ...parsed.characters])];
    p.locations = [...new Set([...(p.locations || []), ...parsed.locations])];
    p.updatedAt = new Date().toISOString();
    db.save(d);
    project = p;
  } else {
    project = makeProject('script', req.body.projectName || '导入的剧本');
    project.episodes[0].nodes = parsed.nodes;
    project.characters = parsed.characters;
    project.locations = parsed.locations;
    db.update(d => { d.projects.unshift(project); });
  }
  res.json({ project, stats: parsed.stats });
}));

// ---------- 创意资料附件导入（DOCX / PDF / MD / TXT → 纯文本） ----------
app.get('/api/import/support', (_req, res) => res.json({ extensions: supportedExtensions() }));
app.post('/api/import/attachment', wrap(async (req, res) => {
  const { name, dataBase64, mime } = req.body || {};
  if (!name || !dataBase64) return res.status(400).json({ error: '缺少文件名或内容' });
  if (typeof dataBase64 !== 'string' || dataBase64.length > 24 * 1024 * 1024) {
    return res.status(413).json({ error: '文件过大（上限约 18MB）' });
  }
  let buffer;
  try { buffer = Buffer.from(dataBase64, 'base64'); }
  catch { return res.status(400).json({ error: '文件内容无法解码' }); }
  try {
    const parsed = parseAttachment(buffer, name, mime);
    res.json({ name, size: buffer.length, ...parsed });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || '解析失败' });
  }
}));

// ---------- media generation ----------
app.post('/api/media/image', wrap(async (req, res) => res.json(await generateImage(req.body))));
app.post('/api/media/video', wrap(async (req, res) => res.json(await generateVideo(req.body))));
app.get('/api/media/task/:taskId', wrap(async (req, res) => res.json(await pollTask(req.params.taskId))));
app.post('/api/media/task/:taskId/refund', wrap(async (req, res) => res.json(refundTask(req.params.taskId, req.body?.reason))));
app.get('/api/media/tasks', (req, res) => res.json(listTasks(req.query.limit)));
app.get('/api/media/assets', (req, res) => res.json(listAssets(req.query.type)));
app.post('/api/media/audio', wrap(async (req, res) => res.json(await generateAudio(req.body))));
app.post('/api/projects/:id/audio/plan', wrap(async (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(planAudio(p, req.body || {}));
}));
app.post('/api/media/assets/upload', wrap(async (req, res) => res.status(201).json(uploadAsset(req.body))));
app.put('/api/media/assets/:assetId/binding', wrap(async (req, res) => {
  res.json(bindAsset(req.params.assetId, req.body?.binding || req.body, req.body?.note || ''));
}));
app.delete('/api/media/assets/:assetId/binding', wrap(async (req, res) => {
  res.json(unbindAsset(req.params.assetId, req.body?.binding || req.query));
}));
app.delete('/api/media/assets/:id', (req, res) => res.json(removeAsset(req.params.id)));
app.get('/api/projects/:id/assets', wrap(async (req, res) => res.json(listProjectAssets(req.params.id))));
app.post('/api/projects/:id/generations', wrap(async (req, res) => res.json(await createGeneration(req.params.id, req.body || {}))));
app.use('/media', express.static(ASSETS_DIR, { fallthrough: true, maxAge: '7d' }));

// ---------- sync ----------
app.get('/api/sync/status', (_req, res) => res.json(syncStatus()));
app.put('/api/sync/config', wrap(async (req, res) => res.json(configureSync(req.body))));
app.post('/api/sync/push', wrap(async (req, res) => res.json(pushSync())));
app.post('/api/sync/pull', wrap(async (req, res) => res.json(pullSync())));

// ---------- advisors（方法视角，只读；每项目仅一位） ----------
app.get('/api/advisors', (_req, res) => res.json(ADVISORS));
app.post('/api/projects/:id/advisor', (req, res) => {
  const advisorId = String(req.body?.advisorId || '');
  if (advisorId && !ADVISORS.some(a => a.id === advisorId)) return res.status(400).json({ error: '未知顾问' });
  const p = db.update(d => {
    const p = d.projects.find(x => x.id === req.params.id);
    if (!p) return null;
    p.advisorId = advisorId; // 传空串即解雇，保持单顾问工作流
    p.updatedAt = new Date().toISOString();
    return p;
  });
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({ advisorId: p.advisorId, advisor: ADVISORS.find(a => a.id === p.advisorId) || null });
});

// ---------- 实体与生产管理层 ----------
app.get('/api/projects/:id/entities', (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(deriveEntities(p));
});
app.get('/api/projects/:id/relationships', (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(analyzeRelationships(p));
});
app.get('/api/projects/:id/continuity', (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(auditContinuity(p));
});
app.get('/api/projects/:id/readiness', (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(auditReadiness(p));
});
// Knowledge：先给索引，正文按需读取（对齐官方 index → search → inspect → read）
app.get('/api/projects/:id/knowledge', (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(knowledgeIndex(p.knowledge));
});
app.post('/api/projects/:id/knowledge/search', (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(searchKnowledge(p.knowledge, req.body?.q));
});
app.get('/api/projects/:id/knowledge/:kid', (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  const item = p?.knowledge?.find(k => k.id === req.params.kid);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

// ---------- export ----------
app.post('/api/export/:id', wrap(async (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const { format = 'fountain', kind = 'script', convention, episodeIndexes } = req.body || {};
  // Fountain / Markdown / JSON 保留旧实现，作为自用交付的补充格式。
  if (format === 'fountain' || format === 'markdown' || format === 'json') {
    const ep = p.episodes?.[0];
    let content = '';
    if (format === 'fountain') {
      content = `Title: ${p.name}\n\n` + (ep?.nodes || []).map(n => {
        const t = n.text || '';
        switch (n.type) {
          case 'scene': return `\n${t.toUpperCase()}\n`;
          case 'action': return `${t}\n\n`;
          case 'character': return `${t.toUpperCase()}\n`;
          case 'dialogue': return `${t}\n\n`;
          case 'parenthetical': return `(${t})\n`;
          case 'transition': return `\n${t.toUpperCase()}\n\n`;
          default: return `${t}\n`;
        }
      }).join('');
    } else if (format === 'markdown') {
      content = `# ${p.name}\n\n` + (ep?.nodes || []).map(n => `**${n.type}**  ${n.text}`).join('\n\n');
    } else {
      content = JSON.stringify(p, null, 2);
    }
    const ext = format === 'json' ? 'json' : format === 'markdown' ? 'md' : 'fountain';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(p.name)}.${ext}"`);
    return res.send(content);
  }
  // industry 标准：FDX / PDF / DOCX / TXT，支持多集合并与 Hollywood / Asian 约定。
  const out = exportRender(p, {
    format, kind,
    episodeIndexes: Array.isArray(episodeIndexes) && episodeIndexes.length ? episodeIndexes : [0],
    convention: convention || p.settings?.exportConvention || p.settings?.format || 'hollywood',
  });
  res.setHeader('Content-Type', out.contentType);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`);
  res.send(out.body);
}));

// ---------- static ----------
const dist = path.join(ROOT, 'dist');
// redirect:false 避免 /assets 等前端路由被静态目录 301 抢先
app.use(express.static(dist, { redirect: false, index: false }));
app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html'), err => {
  if (err) res.status(404).send('前端尚未构建，请运行 npm run dev');
}));

const PORT = process.env.PORT || 8787;
const HOST = process.env.GL_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`GreatLens API http://${HOST}:${PORT}`));
