// 后端 API 根地址：优先读 localStorage 中用户配置的远程后端，留空则用本机 /api。
// 每次请求都重新读取，保证「设置页保存后立即生效」，也兼容多标签页。
function getBase() {
  let remote = '';
  try { remote = localStorage.getItem('gl:remoteBase') || ''; } catch { remote = ''; }
  remote = String(remote).trim().replace(/\/+$/, '');
  if (!remote) return '/api';
  // 用户可能填的是带 /api 结尾的地址，也可能只填了域名；统一保证以 /api 结尾。
  return /\/api$/.test(remote) ? remote : remote + '/api';
}

// 供顶栏展示当前后端来源使用。
export function currentBackendBase() {
  return getBase();
}

// 素材 URL 可能是 /media/xxx 相对路径。远程后端模式下需拼到后端 origin，
// 否则会错误地请求到「前端所在域」，导致图片/视频 404。
export function resolveAssetUrl(url) {
  if (!url) return '';
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url;
  const base = getBase();
  if (!base || base === '/api' || typeof location === 'undefined') return url;
  try { return new URL(url, new URL(base, location.href)).href; }
  catch { return url; }
}

async function req(path, options = {}) {
  const res = await fetch(getBase() + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

function jsonBody(data) {
  return { method: 'POST', body: JSON.stringify(data) };
}

export const api = {
  settings: {
    get: () => req('/settings'),
    save: (data) => req('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },

  // 模型目录与计费口径（单一事实来源）
  models: () => req('/models'),
  projectTemplates: () => req('/project-templates'),

  projects: {
    list: () => req('/projects'),
    get: (id) => req(`/projects/${id}`),
    create: (type, name, template) => req('/projects', jsonBody({ type, name, template: template || 'blank' })),
    saveSettings: (id, data, baseRevision) => req(`/projects/${id}/settings`, {
      method: 'PATCH', body: JSON.stringify({ ...data, baseRevision }),
    }),
    fromIdea: (draft) => req('/projects/from-idea', jsonBody(draft)),
    save: (id, data, baseRevision) => req(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: baseRevision === undefined || baseRevision === null ? {} : { 'If-Match': String(baseRevision) },
    }),
    remove: (id) => req(`/projects/${id}`, { method: 'DELETE' }),
    addEpisode: (id, title) => req(`/projects/${id}/episodes`, jsonBody({ title })),
    toCinema: (id, name) => req(`/projects/${id}/to-cinema`, jsonBody({ name })),
    export: (id, format) => req(`/export/${id}`, jsonBody({ format })),

    // 实体与生产管理层
    entities: (id) => req(`/projects/${id}/entities`),
    relationships: (id) => req(`/projects/${id}/relationships`),
    continuity: (id) => req(`/projects/${id}/continuity`),
    readiness: (id) => req(`/projects/${id}/readiness`),
    knowledgeIndex: (id) => req(`/projects/${id}/knowledge`),
    knowledgeSearch: (id, q) => req(`/projects/${id}/knowledge/search`, jsonBody({ q })),
    knowledgeRead: (id, kid) => req(`/projects/${id}/knowledge/${encodeURIComponent(kid)}`),
    setAdvisor: (id, advisorId) => req(`/projects/${id}/advisor`, jsonBody({ advisorId })),
    assets: (id) => req(`/projects/${id}/assets`),
    generate: (id, payload) => req(`/projects/${id}/generations`, jsonBody(payload)),
    planAudio: (id, payload) => req(`/projects/${id}/audio/plan`, jsonBody(payload)),

    // 作者口味记忆：把采纳/弃用的输出沉淀为长期偏好
    taste: {
      get: (id) => req(`/projects/${id}/taste`),
      feedback: (id, payload) => req(`/projects/${id}/taste/feedback`, jsonBody(payload)),
      addRule: (id, payload) => req(`/projects/${id}/taste/rules`, jsonBody(payload)),
      removeRule: (id, ruleId) => req(`/projects/${id}/taste/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' }),
      setEnabled: (id, enabled) => req(`/projects/${id}/taste`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
    },

    // 草稿级修订说明 + Option 备选（节拍/节点粒度，区别于项目版本历史）
    revisions: {
      list: (id, episodeId) => req(`/projects/${id}/revisions?episodeId=${encodeURIComponent(episodeId || '')}`),
      propose: (id, payload) => req(`/projects/${id}/revisions/options`, jsonBody(payload)),
      apply: (id, payload) => req(`/projects/${id}/revisions/apply`, jsonBody(payload)),
      addNote: (id, payload) => req(`/projects/${id}/revisions/notes`, jsonBody(payload)),
    },

    // 版本历史：完整快照由服务端独立落盘，这里只读元数据与显式恢复。
    versions: {
      list: (id) => req(`/projects/${id}/versions`),
      get: (id, versionId) => req(`/projects/${id}/versions/${encodeURIComponent(versionId)}`),
      create: (id, data) => req(`/projects/${id}/versions`, jsonBody(data || {})),
      update: (id, versionId, data) => req(`/projects/${id}/versions/${encodeURIComponent(versionId)}`, {
        method: 'PATCH', body: JSON.stringify(data || {}),
      }),
      remove: (id, versionId) => req(`/projects/${id}/versions/${encodeURIComponent(versionId)}`, { method: 'DELETE' }),
      restore: (id, versionId, baseRevision) => req(`/projects/${id}/versions/${encodeURIComponent(versionId)}/restore`, jsonBody({ baseRevision })),
    },
  },

  ai: {
    complete: (payload) => req('/ai/complete', jsonBody(payload)),
    idea: (payload) => req('/ai/idea', jsonBody(payload)),
    analyzeBrief: (seed, brief) => req('/ai/idea/brief', jsonBody({ seed, brief })),
    act: (payload) => req('/ai/act', jsonBody(payload)),
    advisors: () => req('/advisors'),

    // stream(payload, handlers)
    //   handlers: { onDelta(text), onReasoning(text), onUsage(usage) }
    //   兼容旧签名：第二个参数为函数时当作 onDelta。
    stream: async (payload, handlers = {}) => {
      let h;
      if (typeof handlers === 'function') h = { onDelta: handlers };
      else h = handlers || {};
      const onDelta = typeof h.onDelta === 'function' ? h.onDelta : () => {};
      const onReasoning = typeof h.onReasoning === 'function' ? h.onReasoning : () => {};
      const onUsage = typeof h.onUsage === 'function' ? h.onUsage : () => {};

      const res = await fetch(getBase() + '/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: h.signal, // 可选 AbortSignal：组件卸载/重新生成时取消，停止烧 token
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `AI 请求失败 ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 以 \n\n 分包，按行解析，保留最后一行到下一批。
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const raw = trimmed.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          let d;
          try { d = JSON.parse(raw); } catch { continue; } // 容错：忽略无法解析的片段
          if (!d || typeof d !== 'object') continue;
          if (d.error) throw new Error(String(d.error));
          if (d.delta) onDelta(d.delta);
          if (d.reasoning) onReasoning(d.reasoning);
          if (d.usage) onUsage(d.usage);
        }
      }
      // 处理缓冲区里可能残留的最后一段。
      if (buffer.trim().startsWith('data:')) {
        const raw = buffer.trim().slice(5).trim();
        if (raw && raw !== '[DONE]') {
          let d;
          try { d = JSON.parse(raw); } catch { d = null; }
          if (d) {
            if (d.error) throw new Error(String(d.error));
            if (d.delta) onDelta(d.delta);
            if (d.reasoning) onReasoning(d.reasoning);
            if (d.usage) onUsage(d.usage);
          }
        }
      }
    },
  },

  usage: {
    get: (days = 30) => req(`/usage?days=${encodeURIComponent(days)}`),
    refunds: () => req('/usage/refunds'),
    clear: () => req('/usage/clear', jsonBody({})),
  },

  media: {
    generateImage: (payload) => req('/media/image', jsonBody(payload)),
    generateVideo: (payload) => req('/media/video', jsonBody(payload)),
    task: (taskId) => req(`/media/task/${encodeURIComponent(taskId)}`),
    refundTask: (taskId, reason = '') => req(`/media/task/${encodeURIComponent(taskId)}/refund`, jsonBody({ reason })),
    tasks: (limit = 40) => req(`/media/tasks?limit=${Number(limit) || 40}`),
    assets: (type) => req(`/media/assets${type ? `?type=${encodeURIComponent(type)}` : ''}`),
    audio: (payload) => req('/media/audio', jsonBody(payload)),
    upload: (payload) => req('/media/assets/upload', jsonBody(payload)),
    bindAsset: (id, binding, note = '') => req(`/media/assets/${encodeURIComponent(id)}/binding`, {
      method: 'PUT', body: JSON.stringify({ binding, note }),
    }),
    unbindAsset: (id, binding) => req(`/media/assets/${encodeURIComponent(id)}/binding`, {
      method: 'DELETE', body: JSON.stringify({ binding }),
    }),
    removeAsset: (id) => req(`/media/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  import: {
    fdx: (payload) => req('/import/fdx', jsonBody(payload)),
    support: () => req('/import/support'),
    attachment: (payload) => req('/import/attachment', jsonBody(payload)),
  },

  sync: {
    status: () => req('/sync/status'),
    config: (data) => req('/sync/config', { method: 'PUT', body: JSON.stringify(data) }),
    push: () => req('/sync/push', jsonBody({})),
    pull: () => req('/sync/pull', jsonBody({})),
  },
};
