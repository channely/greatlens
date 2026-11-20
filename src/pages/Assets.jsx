import React, { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon, Video, Sparkles, Loader2, Copy, Trash2,
  RefreshCw, Check, Film, Wand2, Upload,
} from 'lucide-react';
import { api, resolveAssetUrl } from '../api.js';
import { videoRate, clampSeconds, MAX_VIDEO_SECONDS, RESOLUTIONS } from '../pricing.js';

// 百炼要求 '<宽>*<高>'（星号），不是字母 x。
const IMAGE_SIZES = ['1024*1024', '1536*1024', '1024*1536'];
const IMAGE_MODELS = ['qwen-image-3.0', 'qwen-image-3.0-pro', 'qwen-image-2.1-turbo', 'wanx2.1-t2i-plus'];
const VIDEO_MODELS = ['wan3.0-video', 'wan2.7-t2v', 'wan2.7-i2v'];

const MAX_POLLS = 60;
const POLL_INTERVAL = 2000;
const MAX_NET_RETRIES = 20; // 网络抖动最多重试次数（退避上限 10s）

export default function Assets() {
  const [tab, setTab] = useState('image');
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [cfg, setCfg] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const timers = useRef({});
  const inflight = useRef(new Set());
  const knownTasks = useRef(new Set());
  const uploadRef = useRef(null);

  // 图像表单
  const [img, setImg] = useState({ prompt: '', size: '1024*1024', model: '', negativePrompt: '', inputImages: '', projectId: '' });
  // 视频表单：默认 480P，单条最长 30 秒
  const [vid, setVid] = useState({ prompt: '', imageUrl: '', model: '', duration: 5, resolution: '480P', inputSeconds: 0, negativePrompt: '', projectId: '' });

  useEffect(() => { api.projects.list().then(setProjects).catch(() => {}); }, []);
  useEffect(() => { loadAssets(); }, []);
  useEffect(() => {
    api.settings.get().then(setCfg).catch(() => {});
    api.models().then(setCatalog).catch(() => {});
  }, []);
  // 刷新后恢复：后端仍 pending 的任务重新挂上轮询，避免"UI 显示失败但视频其实生成成功"。
  useEffect(() => {
    let alive = true;
    api.media.tasks().then(list => {
      if (!alive || !Array.isArray(list)) return;
      const pending = list.filter(t => t.status === 'pending');
      if (!pending.length) return;
      const restored = pending
        .filter(t => t.taskId && !knownTasks.current.has(t.taskId))
        .map(t => {
          knownTasks.current.add(t.taskId);
          return { taskId: t.taskId, type: t.type, model: t.model, status: 'pending', restored: true };
        });
      if (restored.length) {
        setTasks(ts => [...restored, ...ts]);
        restored.forEach(t => schedulePoll(t.taskId, 0));
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => () => {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    inflight.current.clear();
  }, []);

  async function loadAssets() {
    setLoadingAssets(true);
    try {
      const [images, videos, audios] = await Promise.all([
        api.media.assets('image').catch(() => []),
        api.media.assets('video').catch(() => []),
        api.media.assets('audio').catch(() => []),
      ]);
      setAssets([...(images || []), ...(videos || []), ...(audios || [])]);
    } catch (e) { setError(e.message); }
    finally { setLoadingAssets(false); }
  }

  function updateTask(id, patch) {
    setTasks(ts => ts.map(t => t.taskId === id ? { ...t, ...patch } : t));
  }

  async function refundTask(t) {
    try {
      const r = await api.media.refundTask(t.taskId, '资产作废/误生成冲销');
      updateTask(t.taskId, { refunded: r.created !== false });
      setError(r.created === false ? '该任务已冲销过，未重复记账。' : '已冲销该任务费用，净额可在用量看板查看。');
    } catch (e) { setError(`冲销失败：${e.message}`); }
  }

  // 瞬时断连（如后端重启、网络抖动）是可恢复的，不应把任务判死。
  function isNetworkError(e) {
    const msg = String(e?.message || '').toLowerCase();
    return e?.name === 'TypeError' || /failed to fetch|network|load failed|econn/i.test(msg);
  }

  function schedulePoll(taskId, delay = POLL_INTERVAL, tries = 0, netFails = 0) {
    if (timers.current[taskId] || inflight.current.has(taskId)) return;
    timers.current[taskId] = setTimeout(() => {
      delete timers.current[taskId];
      inflight.current.add(taskId);
      poll(taskId, tries, netFails);
    }, Math.max(0, delay));
  }

  function startTask(meta) {
    knownTasks.current.add(meta.taskId);
    setTasks(ts => [meta, ...ts]);
    schedulePoll(meta.taskId, 0);
  }

  function poll(taskId, tries = 0, netFails = 0) {
    if (tries >= MAX_POLLS) {
      inflight.current.delete(taskId);
      updateTask(taskId, { status: 'failed', error: '任务超时，请到素材库查看或稍后重试。' });
      return;
    }
    api.media.task(taskId)
      .then(t => {
        inflight.current.delete(taskId);
        updateTask(taskId, { status: t.status, url: t.url, assets: t.assets, error: t.error, connError: '' });
        if (t.status === 'pending') {
          schedulePoll(taskId, POLL_INTERVAL, tries + 1, 0);
        } else {
          delete timers.current[taskId];
          loadAssets();
        }
      })
      .catch(e => {
        inflight.current.delete(taskId);
        if (isNetworkError(e) && netFails < MAX_NET_RETRIES) {
          // 网络层失败：后端与百炼任务大概率仍在跑，保留 pending 并退避重试。
          updateTask(taskId, { status: 'pending', connError: `连接中断，正在重试（${netFails + 1}/${MAX_NET_RETRIES}）…` });
          schedulePoll(taskId, Math.min(10000, POLL_INTERVAL * (netFails + 1)), tries, netFails + 1);
        } else {
          updateTask(taskId, { status: 'failed', error: e.message || '查询失败' });
          delete timers.current[taskId];
        }
      });
  }

  async function generateImage(e) {
    e.preventDefault();
    if (!img.prompt.trim()) return;
    setError('');
    try {
      const payload = { prompt: img.prompt.trim(), size: img.size };
      if (img.model.trim()) payload.model = img.model.trim();
      if (img.negativePrompt.trim()) payload.negativePrompt = img.negativePrompt.trim();
      const inputImages = img.inputImages.split(/[\n,，]+/).map(s => s.trim()).filter(Boolean);
      if (inputImages.length) payload.inputImages = inputImages;
      if (img.projectId) payload.projectId = img.projectId;
      const r = await api.media.generateImage(payload);
      startTask({ taskId: r.taskId, type: 'image', model: r.model, status: r.status || 'pending', assets: r.assets || [] });
      setImg(i => ({ ...i, prompt: '' }));
    } catch (err) { setError(err.message); }
  }

  async function generateVideo(e) {
    e.preventDefault();
    if (!vid.prompt.trim()) return;
    setError('');
    try {
      const seconds = clampSeconds(vid.duration, 5);
      const payload = {
        prompt: vid.prompt.trim(),
        duration: seconds,
        resolution: vid.resolution,
      };
      if (Number(vid.inputSeconds) > 0) payload.inputSeconds = Number(vid.inputSeconds);
      if (vid.model.trim()) payload.model = vid.model.trim();
      if (vid.imageUrl.trim()) payload.imageUrl = vid.imageUrl.trim();
      if (vid.negativePrompt.trim()) payload.negativePrompt = vid.negativePrompt.trim();
      if (vid.projectId) payload.projectId = vid.projectId;
      const r = await api.media.generateVideo(payload);
      startTask({ taskId: r.taskId, type: 'video', model: r.model, status: r.status || 'pending' });
      setVid(v => ({ ...v, prompt: '' }));
    } catch (err) { setError(err.message); }
  }

  async function copyUrl(url) {
    try { await navigator.clipboard.writeText(url); }
    catch { /* 剪贴板不可用（非 HTTPS）时静默 */ }
    setCopied(url);
    setTimeout(() => setCopied(c => (c === url ? '' : c)), 1500);
  }

  async function removeAsset(id) {
    if (!confirm('删除这个素材？')) return;
    try { await api.media.removeAsset(id); setAssets(a => a.filter(x => x.id !== id)); }
    catch (e) { setError(e.message); }
  }

  async function uploadFile(file) {
    if (!file) return;
    setError('');
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
      await api.media.upload({ name: file.name, mime: file.type, dataBase64 });
      await loadAssets();
    } catch (e) { setError(e.message); }
  }

  function taskAssetId(t) {
    return t.assets?.[0]?.id || t.assetId || assets.find(a => a.url === t.url)?.id || '';
  }

  async function bindTask(t, projectId) {
    const assetId = taskAssetId(t);
    if (!assetId) { setError('结果还在写入素材库，请刷新后再关联。'); return; }
    setError('');
    try {
      if (!projectId) {
        await api.media.unbindAsset(assetId, { kind: 'project', projectId: t.projectId || '', entityId: t.projectId || '', slot: 'asset' });
      } else {
        await api.media.bindAsset(assetId, { kind: 'project', projectId, entityId: projectId, slot: 'asset' });
      }
      updateTask(t.taskId, { projectId });
      await loadAssets();
    } catch (e) { setError(e.message); }
  }

  return (
    <main className="container page assets-page">
      <div className="page-head">
        <div>
          <h1>素材工作台</h1>
          <p className="muted">用百炼图像 / 视频模型生成素材，任务完成后自动进入素材库。</p>
        </div>
        <div className="page-actions">
          <input ref={uploadRef} type="file" accept="image/*,video/*,audio/*" hidden onChange={e => { uploadFile(e.target.files?.[0]); e.target.value = ''; }} />
          <button className="btn btn-ghost" onClick={() => uploadRef.current?.click()}><Upload size={15} /> 上传本地素材</button>
          <button className="btn btn-ghost" onClick={loadAssets}><RefreshCw size={15} /> 刷新素材库</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="tab-bar">
        <button className={tab === 'image' ? 'active' : ''} onClick={() => setTab('image')}><ImageIcon size={15} /> 图像生成</button>
        <button className={tab === 'video' ? 'active' : ''} onClick={() => setTab('video')}><Video size={15} /> 视频生成</button>
      </div>

      <div className="media-layout">
        <section className="card media-generator">
          <div className="card-head">
            {tab === 'image' ? <ImageIcon size={18} /> : <Video size={18} />}
            <div>
              <h3>{tab === 'image' ? '图像生成' : '视频生成'}</h3>
              <p>详细描述画面内容、风格与镜头语言，效果更好。</p>
            </div>
          </div>

          {tab === 'image' ? (
            <form className="form-stack" onSubmit={generateImage}>
              <label>画面描述
                <textarea rows={4} value={img.prompt} onChange={e => setImg({ ...img, prompt: e.target.value })} placeholder="例如：雨夜霓虹街角，女主角撑黑色雨伞回眸，电影感光影，浅景深" />
              </label>
              <div className="form-two">
                <label>尺寸
                  <select value={img.size} onChange={e => setImg({ ...img, size: e.target.value })}>
                    {IMAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label>模型
                  <select value={img.model} onChange={e => setImg({ ...img, model: e.target.value })}>
                    <option value="">默认（跟随设置）</option>
                    {(catalog?.image || IMAGE_MODELS).map(m => typeof m === 'string' ? m : m.id).map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
              <label>参考图 URL（可选，图生图；每行或逗号分隔，按张计费）
                <textarea rows={2} value={img.inputImages} onChange={e => setImg({ ...img, inputImages: e.target.value })} placeholder="https://... 留空则纯文本生成" />
              </label>
              <label>负面提示词（可选）
                <input value={img.negativePrompt} onChange={e => setImg({ ...img, negativePrompt: e.target.value })} placeholder="低清晰度、畸形手指、水印" />
              </label>
              <ProjectSelect value={img.projectId} onChange={v => setImg({ ...img, projectId: v })} projects={projects} />
              <button className="btn btn-primary full" type="submit" disabled={!img.prompt.trim()}><Wand2 size={15} /> 生成图像</button>
            </form>
          ) : (
            <form className="form-stack" onSubmit={generateVideo}>
              <label>画面描述
                <textarea rows={4} value={vid.prompt} onChange={e => setVid({ ...vid, prompt: e.target.value })} placeholder="例如：镜头缓缓推进，樱花在风中飘落，少女转身微笑，柔和自然光" />
              </label>
              <label>首帧图片 URL（可选，图生视频）
                <input value={vid.imageUrl} onChange={e => setVid({ ...vid, imageUrl: e.target.value })} placeholder="https://... 留空则纯文本生成" />
              </label>
              <div className="form-two">
                <label>模型
                  <select value={vid.model} onChange={e => setVid({ ...vid, model: e.target.value })}>
                    <option value="">默认（跟随设置）</option>
                    {(catalog?.video || VIDEO_MODELS).map(m => typeof m === 'string' ? m : m.id).map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label>分辨率
                  <select value={vid.resolution} onChange={e => setVid({ ...vid, resolution: e.target.value })}>
                    {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              </div>
              <div className="form-two">
                <label>输出时长（秒，最长 30）
                  <input type="number" min="1" max={MAX_VIDEO_SECONDS} value={vid.duration} onChange={e => setVid({ ...vid, duration: Number(e.target.value) })} />
                </label>
                <label>输入视频时长（秒，可选）
                  <input type="number" min="0" max={MAX_VIDEO_SECONDS} value={vid.inputSeconds} onChange={e => setVid({ ...vid, inputSeconds: Number(e.target.value) })} />
                </label>
              </div>
              <label>负面提示词（可选）
                <input value={vid.negativePrompt} onChange={e => setVid({ ...vid, negativePrompt: e.target.value })} placeholder="抖动、变形、水印" />
              </label>
              <div className="cost-estimate muted small">
                估算费用：¥{((Math.min(MAX_VIDEO_SECONDS, Math.max(1, Number(vid.duration) || 5)) + Math.max(0, Number(vid.inputSeconds) || 0)) * videoRate(cfg, vid.resolution)).toFixed(3)}
                <span className="ml-8">（{vid.resolution} · ¥{videoRate(cfg, vid.resolution).toFixed(3)}/秒 · 含限时折扣）</span>
              </div>
              <ProjectSelect value={vid.projectId} onChange={v => setVid({ ...vid, projectId: v })} projects={projects} />
              <button className="btn btn-primary full" type="submit" disabled={!vid.prompt.trim()}><Wand2 size={15} /> 生成视频</button>
            </form>
          )}
        </section>

        <section className="media-tasks">
          <div className="section-title"><h3>生成任务</h3><span className="muted small">最多轮询 2 分钟</span></div>
          {tasks.length === 0 ? (
            <div className="empty small"><div className="empty-icon"><Sparkles size={22} /></div><p>还没有任务。填写左侧表单开始生成。</p></div>
          ) : (
            <div className="task-grid">
              {tasks.map(t => <div className="task-card" key={t.taskId}>
                <div className="task-card-top">
                  <span className="tag mini">{t.type === 'image' ? '图像' : '视频'}</span>
                  <span className={`task-status ${t.status}`}>{statusLabel(t.status)}</span>
                </div>
                <div className="task-id">任务 {String(t.taskId).slice(0, 24)}</div>
                {t.model && <div className="muted small">模型：{t.model}</div>}
                {t.status === 'pending' && (
                  <div className="task-pending"><Loader2 className="spin" size={18} /> {t.connError || '生成中，请稍候…'}</div>
                )}
                {t.status === 'succeeded' && t.url && (
                  <div className="task-result">
                    {t.type === 'image' ? <img src={resolveAssetUrl(t.url)} alt="生成结果" /> : <video controls src={resolveAssetUrl(t.url)} />}
                    <div className="task-actions">
                      <ProjectSelect value={t.projectId || ''} onChange={v => bindTask(t, v)} projects={projects} label="关联到项目" />
                      <button className="btn btn-ghost sm" onClick={() => copyUrl(t.url)}>{copied === t.url ? <><Check size={13} /> 已复制</> : <><Copy size={13} /> 复制 URL</>}</button>
                      <button className="btn btn-ghost sm" disabled={t.refunded} title="冲销该任务已计费用的净额（幂等）" onClick={() => refundTask(t)}>
                        <RefreshCw size={13} /> {t.refunded ? '已冲销' : '冲销计费'}
                      </button>
                    </div>
                  </div>
                )}
                {t.status === 'failed' && (
                  <div className="alert error sm">{t.error || '生成失败'}</div>
                )}
                {(t.status === 'failed' || t.status === 'pending') && (
                  <button className="btn btn-ghost sm mt-8" onClick={() => {
                    updateTask(t.taskId, { status: 'pending', error: '', connError: '' });
                    schedulePoll(t.taskId, 0);
                  }}>重新查询</button>
                )}
              </div>)}
            </div>
          )}
        </section>
      </div>

      <section className="card usage-section">
        <div className="card-head"><Film size={18} /><div><h3>素材库</h3><p>所有生成成功的历史素材，可复制 URL 或删除。</p></div></div>
        {loadingAssets ? <div className="loading"><Loader2 className="spin" size={18} /> 加载素材…</div> : (
          assets.length === 0 ? <div className="empty small">素材库还是空的。</div> : (
            <div className="asset-grid">
              {assets.map(a => <div className="asset-card" key={a.id}>
                <div className="asset-thumb">
                  {a.type === 'image'
                    ? <img src={resolveAssetUrl(a.url)} alt={a.prompt || '素材'} />
                    : a.type === 'audio'
                      ? <audio controls src={resolveAssetUrl(a.url)} />
                      : <video controls src={resolveAssetUrl(a.url)} />}
                </div>
                <div className="asset-body">
                  <div className="asset-type tag mini">{a.type === 'image' ? '图像' : a.type === 'audio' ? '音频' : '视频'}</div>
                  <p className="asset-prompt" title={a.prompt}>{a.prompt || '—'}</p>
                  <div className="muted small asset-date">{a.createdAt ? new Date(a.createdAt).toLocaleString('zh-CN') : ''}</div>
                  <div className="asset-actions">
                    <button className="btn btn-ghost sm" onClick={() => copyUrl(a.url)}>{copied === a.url ? <Check size={13} /> : <Copy size={13} />} 复制</button>
                    <button className="icon-btn danger" title="删除" onClick={() => removeAsset(a.id)}><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>)}
            </div>
          )
        )}
      </section>
    </main>
  );
}

function ProjectSelect({ value, onChange, projects, label = '保存到项目（可选）' }) {
  return (
    <label>{label}
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">不关联</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}

function statusLabel(s) {
  return ({ pending: '生成中', succeeded: '已完成', failed: '失败' })[s] || s || '排队中';
}
