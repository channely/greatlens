import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2, Upload, X, Wand2 } from 'lucide-react';
import { api, resolveAssetUrl } from '../api.js';
import GenerateAssetDialog from './GenerateAssetDialog.jsx';

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export function AssetPicker({ binding, onPick, onClose, accept = 'image/*' }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const all = await api.media.assets();
      const wanted = String(binding?.slot || '').includes('voice') ? 'audio' : 'image';
      setAssets((Array.isArray(all) ? all : []).filter(a => a.type === wanted));
    } catch (e) { setError(e.message || '载入素材失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [binding?.projectId, binding?.slot]);

  async function pick(asset) {
    setBusy(true);
    setError('');
    try {
      const result = await api.media.bindAsset(asset.id, binding, '');
      onPick?.(result.ref, asset);
    } catch (e) { setError(e.message || '绑定失败'); }
    finally { setBusy(false); }
  }

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const dataBase64 = await readFile(file);
      const asset = await api.media.upload({
        name: file.name, mime: file.type, dataBase64, binding,
      });
      await load();
      onPick?.({
        assetId: asset.id, url: asset.url, name: asset.name, note: '',
      }, asset);
    } catch (e) { setError(e.message || '上传失败'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal asset-picker-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><h3>选择项目素材</h3><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="asset-picker-body">
          {error && <div className="alert error sm">{error}</div>}
          <button className="btn btn-ghost sm" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={13} /> 上传本地素材</button>
          <input ref={fileRef} type="file" accept={accept} hidden onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          {loading && <div className="loading"><Loader2 className="spin" size={16} /> 载入素材…</div>}
          {!loading && assets.length === 0 && <div className="empty small">素材库还没有可用素材。可以先上传，或到素材工作台生成。</div>}
          <div className="ref-grid">
            {assets.map(a => (
              <button key={a.id} className="ref-tile" disabled={busy} title={a.name || a.prompt} onClick={() => pick(a)}>
                {a.type === 'audio' ? <span className="asset-audio-mark">音频</span> : <img src={resolveAssetUrl(a.url)} alt={a.name || '素材'} />}
              </button>
            ))}
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>取消</button></div>
      </div>
    </div>
  );
}

export function EntityAssetField({ binding, value, onChange, label = '视觉参考', accept = 'image/*', project, generation }) {
  const [open, setOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function clear() {
    if (!value?.assetId) { onChange?.(null); return; }
    setBusy(true);
    setError('');
    try {
      await api.media.unbindAsset(value.assetId, binding);
      onChange?.(null);
    } catch (e) { setError(e.message || '清除失败'); }
    finally { setBusy(false); }
  }

  return (
    <div className="entity-asset-field">
      <span className="muted small">{label}</span>
      <div className="entity-asset-row">
        <button className="asset-slot-btn" title={value?.name || '选择素材'} disabled={busy} onClick={() => setOpen(true)}>
          {value?.url ? (
            String(value.url).match(/\.(mp3|m4a|wav|webm)$/i)
              ? <span className="asset-audio-mark">音频</span>
              : <img src={resolveAssetUrl(value.url)} alt={value.name || '视觉参考'} />
          ) : <ImagePlus size={16} />}
        </button>
        <span className="muted small entity-asset-name" title={value?.name || ''}>{value?.name || '未绑定'}</span>
        {project && generation && <button className="icon-btn" title="上下文生成" onClick={() => setGenOpen(true)}><Wand2 size={13} /></button>}
        {value?.assetId && <button className="icon-btn danger" title="清除绑定" disabled={busy} onClick={clear}><Trash2 size={13} /></button>}
      </div>
      {error && <div className="alert error sm">{error}</div>}
      {open && <AssetPicker
        binding={binding}
        accept={accept}
        onClose={() => setOpen(false)}
        onPick={ref => { onChange?.(ref); setOpen(false); }}
      />}
      {genOpen && <GenerateAssetDialog
        project={project}
        generation={generation}
        onClose={() => setGenOpen(false)}
        onGenerated={ref => { onChange?.(ref); setGenOpen(false); }}
      />}
    </div>
  );
}
