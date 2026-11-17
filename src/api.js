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
    headers: { 'Content-Type': 'application/json' },
    ...options,
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

  projects: {
    list: () => req('/projects'),
    get: (id) => req(`/projects/${id}`),
    create: (type, name) => req('/projects', jsonBody({ type, name })),
    save: (id, data) => req(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => req(`/projects/${id}`, { method: 'DELETE' }),
    addEpisode: (id, title) => req(`/projects/${id}/episodes`, jsonBody({ title })),
    export: (id, format) => req(`/export/${id}`, jsonBody({ format })),
  },

  ai: {
    complete: (payload) => req('/ai/complete', jsonBody(payload)),

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
    clear: () => req('/usage/clear', jsonBody({})),
  },

  media: {
    generateImage: (payload) => req('/media/image', jsonBody(payload)),
    generateVideo: (payload) => req('/media/video', jsonBody(payload)),
    task: (taskId) => req(`/media/task/${encodeURIComponent(taskId)}`),
    assets: (type) => req(`/media/assets${type ? `?type=${encodeURIComponent(type)}` : ''}`),
    removeAsset: (id) => req(`/media/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  import: {
    fdx: (payload) => req('/import/fdx', jsonBody(payload)),
  },

  sync: {
    status: () => req('/sync/status'),
    config: (data) => req('/sync/config', { method: 'PUT', body: JSON.stringify(data) }),
    push: () => req('/sync/push', jsonBody({})),
    pull: () => req('/sync/pull', jsonBody({})),
  },
};
