import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, settings, usage, uid, makeProject, ASSETS_DIR, ROOT, ADVISORS, knowledgeIndex, searchKnowledge } from './store.js';
import { callModel } from './ai.js';
import { parseScreenplay } from './fdx.js';
import { deriveEntities, analyzeRelationships, auditContinuity, auditReadiness } from './entities.js';
import {
  generateImage, generateVideo, pollTask, listAssets, removeAsset,
} from './media.js';
import { syncStatus, configureSync, pushSync, pullSync } from './sync.js';
import { exportRender } from './export.js';
import { parseAttachment, supportedExtensions } from './attachments.js';

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
app.put('/api/settings', (req, res) => {
  const allowed = [
    'baseUrl', 'apiKey', 'model', 'temperature', 'enableThinking',
    'priceInput', 'priceOutput', 'imageUnitPrice', 'videoUnitPrice', 'mediaBaseUrl', 'imageModel', 'videoModel',
    'syncRemote', 'syncToken', 'syncDevice', 'remoteBase',
  ];
  const patch = {};
  for (const k of allowed) {
    const v = req.body?.[k];
    // 前端回传的掩码（***abcd）不能覆盖真实密钥
    if (v === undefined || (typeof v === 'string' && /^\*{2,}/.test(v))) continue;
    patch[k] = k === 'enableThinking' ? (v === true || v === 'true' || v === 1)
      : ['temperature', 'priceInput', 'priceOutput', 'imageUnitPrice', 'videoUnitPrice'].includes(k) ? Number(v)
      : String(v);
  }
  if (Object.keys(patch).length) settings.set(patch);
  res.json(settings.public());
});

// ---------- usage & billing ----------
app.get('/api/usage', (req, res) => res.json(usage.report(Number(req.query.days) || 30)));
app.post('/api/usage/clear', (_req, res) => { usage.clear(); res.json({ ok: true }); });

// ---------- projects ----------
app.get('/api/projects', (_req, res) => {
  const d = db.all();
  res.json(d.projects.map(({ episodes, ...p }) => ({ ...p, episodeCount: episodes?.length || 0 })));
});

app.post('/api/projects', (req, res) => {
  const { type = 'script', name = '未命名项目' } = req.body || {};
  if (!['script', 'cinema'].includes(type)) return res.status(400).json({ error: 'invalid type' });
  const p = makeProject(type, name);
  db.update(d => { d.projects.unshift(p); });
  res.status(201).json(p);
});

app.get('/api/projects/:id', (req, res) => {
  const p = db.all().projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

app.put('/api/projects/:id', (req, res) => {
  const d = db.all();
  const idx = d.projects.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  const patch = { ...req.body, id: d.projects[idx].id, updatedAt: new Date().toISOString() };
  delete patch.createdAt;
  d.projects[idx] = { ...d.projects[idx], ...patch };
  db.save(d);
  res.json(d.projects[idx]);
});

app.delete('/api/projects/:id', (req, res) => {
  db.update(d => { d.projects = d.projects.filter(x => x.id !== req.params.id); });
  res.json({ ok: true });
});

app.post('/api/projects/:id/episodes', (req, res) => {
  const ep = db.update(d => {
    const p = d.projects.find(x => x.id === req.params.id);
    if (!p) return null;
    const item = p.type === 'cinema'
      ? { id: uid(), title: req.body.title || `第 ${p.episodes.length + 1} 集`, reels: [] }
      : { id: uid(), title: req.body.title || `第 ${p.episodes.length + 1} 集`, nodes: [], outline: [], beats: [], scenes: [], shots: [] };
    p.episodes.push(item);
    p.updatedAt = new Date().toISOString();
    return item;
  });
  if (!ep) return res.status(404).json({ error: 'not found' });
  res.status(201).json(ep);
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
app.get('/api/media/assets', (req, res) => res.json(listAssets(req.query.type)));
app.delete('/api/media/assets/:id', (req, res) => res.json(removeAsset(req.params.id)));
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
