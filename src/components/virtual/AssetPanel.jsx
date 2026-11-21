import React, { useEffect, useState } from 'react';
import { Layers, Box, Image as ImageIcon, Sparkles, Check, Loader2, ShieldCheck } from 'lucide-react';
import { api, resolveAssetUrl } from '../../api.js';

export default function AssetPanel({ project, dsl, catalog, onRefresh, setError, setNotice }) {
  const [assets, setAssets] = useState(null);
  const [genBg, setGenBg] = useState(false);
  const [bgNote, setBgNote] = useState('');

  useEffect(() => {
    if (project) api.virtual.assets(project.id).then(setAssets).catch(e => setError(e.message));
  }, [project?.id]);

  async function generateBackground() {
    if (!project) return;
    setGenBg(true); setError(''); setNotice('');
    try {
      const r = await api.projects.generate(project.id, {
        purpose: 'virtual-background', targetKind: 'project', targetId: project.id,
        extraPrompt: bgNote, size: '1280*720',
      });
      setNotice(`背景生成任务已提交（${r.taskId || 'task'}）。完成后请在素材页绑定到项目。`);
      if (r.assets?.[0]?.id) {
        await api.virtual.bindBackground(project.id, r.assets[0].id);
        setNotice('静态背景已生成并绑定到项目。');
        await onRefresh();
      }
    } catch (e) { setError(e.message); } finally { setGenBg(false); }
  }

  const models = catalog?.models || [];
  const generated = assets?.generated || [];

  return (
    <div className="vp-assets-grid">
      <div className="card">
        <div className="vp-panel-head"><h3><Box size={16} /> 3D 模型库</h3>
          <p className="muted small">Polyspoon 开源 recipe 模型，GLB 可参数化调整。NVIDIA 通道预留（须带兼容许可证）。</p></div>
        <div className="vp-model-list">
          {models.map(m => (
            <div key={m.id} className="vp-model-row">
              <Box size={16} />
              <div><strong>{m.name || m.id}</strong><span className="muted small"> {m.source} · {m.license}</span></div>
              <span className="vp-badge">GLB</span>
            </div>
          ))}
          {models.length === 0 && <p className="muted small">模型清单加载中或不可用。</p>}
        </div>
      </div>

      <div className="card">
        <div className="vp-panel-head"><h3><ImageIcon size={16} /> 环境基底（静态背景）</h3>
          <p className="muted small">世界模型延后；MVP 用现有图像生成静态背景，DSL environment 节点占位。</p></div>
        <label className="vp-field"><span>背景补充要求</span>
          <input value={bgNote} onChange={e => setBgNote(e.target.value)} placeholder="例如：柔和蓝紫、中心留白、扁平科普风" /></label>
        <button className="btn btn-primary btn-sm" onClick={generateBackground} disabled={genBg || !project}>
          {genBg ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} 生成并绑定背景
        </button>
        {dsl?.environment?.backgroundAssetRef && <p className="vp-chip ok"><Check size={12} /> 环境引用：{dsl.environment.backgroundAssetRef}</p>}
        <div className="vp-generated-list">
          {generated.map(g => (
            <div key={g.id} className="vp-gen-row">
              <span className="muted small">{g.type} · {g.name}</span>
              {g.url && <a href={resolveAssetUrl(g.url)} target="_blank" rel="noreferrer">查看</a>}
            </div>
          ))}
        </div>
      </div>

      <div className="card vp-ip-card">
        <h3><ShieldCheck size={16} /> IP 资产锁定</h3>
        <p className="muted small">主角形象、材质主色与配音音色默认高优先级锁定，避免系列视频风格漂移。锁定字段在导演台只读。</p>
        <p className="muted small">当前 DSL 角色：{(dsl?.characters || []).map(c => c.name).join('、') || '无'}</p>
      </div>
    </div>
  );
}
