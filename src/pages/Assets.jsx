import React, { useEffect, useRef, useState } from 'react';
import {
  Image as ImageIcon, Video, Sparkles, Loader2, Copy, Trash2,
  RefreshCw, Check, Film, Wand2,
} from 'lucide-react';
import { api, resolveAssetUrl } from '../api.js';

const IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'];
const IMAGE_MODELS = ['qwen-image-3.0-pro', 'qwen-image-2.1-turbo', 'wanx2.1-t2i-plus'];
const VIDEO_MODELS = ['wan2.7-t2v', 'wan2.6-t2v-flash', 'wan2.7-i2v'];
const RESOLUTIONS = ['480P', '720P', '1080P'];

const MAX_POLLS = 60;
const POLL_INTERVAL = 2000;

export default function Assets() {
  const [tab, setTab] = useState('image');
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [assets, setAssets] = useState([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const timers = useRef({});

  // 图像表单
  const [img, setImg] = useState({ prompt: '', size: '1024x1024', model: '', negativePrompt: '', projectId: '' });
  // 视频表单
  const [vid, setVid] = useState({ prompt: '', imageUrl: '', model: '', duration: 5, resolution: '720P', negativePrompt: '', projectId: '' });

  useEffect(() => { api.projects.list().then(setProjects).catch(() => {}); }, []);
  useEffect(() => { loadAssets(); }, []);
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  async function loadAssets() {
    setLoadingAssets(true);
    try {
      const [images, videos] = await Promise.all([
        api.media.assets('image').catch(() => []),
        api.media.assets('video').catch(() => []),
      ]);
      setAssets([...(images || []), ...(videos || [])]);
    } catch (e) { setError(e.message); }
    finally { setLoadingAssets(false); }
  }

  function updateTask(id, patch) {
    setTasks(ts => ts.map(t => t.taskId === id ? { ...t, ...patch } : t));
  }

  function poll(taskId, tries = 0) {
    if (tries >= MAX_POLLS) { updateTask(taskId, { status: 'failed', error: '任务超时，请到素材库或稍后重试。' }); return; }
    api.media.task(taskId)
      .then(t => {
        updateTask(taskId, {
          status: t.status,
          url: t.url,
          assets: t.assets,
          error: t.error,
        });
        if (t.status === 'pending') {
          timers.current[taskId] = setTimeout(() => poll(taskId, tries + 1), POLL_INTERVAL);
        } else {
          delete timers.current[taskId];
          loadAssets();
        }
      })
      .catch(e => { updateTask(taskId, { status: 'failed', error: e.message }); delete timers.current[taskId]; });
  }

  async function generateImage(e) {
    e.preventDefault();
    if (!img.prompt.trim()) return;
    setError('');
    try {
      const payload = { prompt: img.prompt.trim(), size: img.size };
      if (img.model.trim()) payload.model = img.model.trim();
      if (img.negativePrompt.trim()) payload.negativePrompt = img.negativePrompt.trim();
      if (img.projectId) payload.projectId = img.projectId;
      const r = await api.media.generateImage(payload);
      setTasks(ts => [{ taskId: r.taskId, type: 'image', model: r.model, status: r.status || 'pending' }, ...ts]);
      setImg(i => ({ ...i, prompt: '' }));
      poll(r.taskId, 0);
    } catch (err) { setError(err.message); }
  }

  async function generateVideo(e) {
    e.preventDefault();
    if (!vid.prompt.trim()) return;
    setError('');
    try {
      const payload = {
        prompt: vid.prompt.trim(),
        duration: Number(vid.duration) || 5,
        resolution: vid.resolution,
      };
      if (vid.model.trim()) payload.model = vid.model.trim();
      if (vid.imageUrl.trim()) payload.imageUrl = vid.imageUrl.trim();
      if (vid.negativePrompt.trim()) payload.negativePrompt = vid.negativePrompt.trim();
      if (vid.projectId) payload.projectId = vid.projectId;
      const r = await api.media.generateVideo(payload);
      setTasks(ts => [{ taskId: r.taskId, type: 'video', model: r.model, status: r.status || 'pending' }, ...ts]);
      setVid(v => ({ ...v, prompt: '' }));
      poll(r.taskId, 0);
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

  return (
    <main className="container page assets-page">
      <div className="page-head">
        <div>
          <h1>素材工作台</h1>
          <p className="muted">用百炼图像 / 视频模型生成素材，任务完成后自动进入素材库。</p>
        </div>
        <button className="btn btn-ghost" onClick={loadAssets}><RefreshCw size={15} /> 刷新素材库</button>
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
                    {IMAGE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
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
                    {VIDEO_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label>分辨率
                  <select value={vid.resolution} onChange={e => setVid({ ...vid, resolution: e.target.value })}>
                    {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              </div>
              <label>时长（秒）
                <input type="number" min="1" max="30" value={vid.duration} onChange={e => setVid({ ...vid, duration: Number(e.target.value) })} />
              </label>
              <label>负面提示词（可选）
                <input value={vid.negativePrompt} onChange={e => setVid({ ...vid, negativePrompt: e.target.value })} placeholder="抖动、变形、水印" />
              </label>
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
                  <div className="task-pending"><Loader2 className="spin" size={18} /> 生成中，请稍候…</div>
                )}
                {t.status === 'succeeded' && t.url && (
                  <div className="task-result">
                    {t.type === 'image' ? <img src={resolveAssetUrl(t.url)} alt="生成结果" /> : <video controls src={resolveAssetUrl(t.url)} />}
                    <div className="task-actions">
                      <ProjectSelect value={t.projectId || ''} onChange={v => { updateTask(t.taskId, { projectId: v }); loadAssets(); }} projects={projects} label="保存到项目" />
                      <button className="btn btn-ghost sm" onClick={() => copyUrl(t.url)}>{copied === t.url ? <><Check size={13} /> 已复制</> : <><Copy size={13} /> 复制 URL</>}</button>
                    </div>
                  </div>
                )}
                {t.status === 'failed' && <div className="alert error sm">{t.error || '生成失败'}</div>}
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
                    : <video controls src={resolveAssetUrl(a.url)} />}
                </div>
                <div className="asset-body">
                  <div className="asset-type tag mini">{a.type === 'image' ? '图像' : '视频'}</div>
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
