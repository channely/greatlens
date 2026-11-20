import React, { useEffect, useState } from 'react';
import { Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import { api, resolveAssetUrl } from '../api.js';
import CanvasBoard from './CanvasBoard.jsx';
import { useMediaTasks } from '../hooks/useMediaTasks.js';

export default function SpaceView({ project, mutate }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { tasks, reload: reloadTasks } = useMediaTasks(project.id, 60);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const a = await api.projects.assets(project.id);
      setAssets(Array.isArray(a) ? a : []);
      reloadTasks();
    } catch (e) { setError(e.message || '载入 Space 失败'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id]);

  function commitLayout(assetId, pos) {
    mutate((_, p) => {
      p.viewLayouts = p.viewLayouts || {};
      p.viewLayouts.space = { ...(p.viewLayouts.space || {}), [assetId]: pos };
    });
  }

  const items = assets.map(a => ({ id: a.id, title: a.name || a.prompt || a.model || a.type, type: a.type, url: a.url }));
  return (
    <div className="simple-view space-view">
      <div className="view-head">
        <div><h2>Space</h2><p className="muted">只显示本项目生成 / 上传的资产与任务，不是通用实体关系图。</p></div>
        <button className="btn btn-ghost sm" onClick={load}><RefreshCw size={13} /> 刷新</button>
      </div>
      {error && <div className="alert error sm">{error}</div>}
      {loading && <div className="loading"><Loader2 className="spin" size={15} /> 载入资产…</div>}
      {!loading && <>
        <div className="section-head"><h3>资产画布</h3><span className="muted small">{assets.length} 项</span></div>
        <CanvasBoard
          items={items}
          layout={project.viewLayouts?.space || {}}
          onCommit={commitLayout}
          empty="还没有绑定到此项目的资产"
          renderItem={item => (
            <>
              <div className="loc-node-head"><span className="loc-node-title">{item.title.slice(0, 28)}</span></div>
              <div className="loc-node-sub">
                <span className="tag mini">{item.type}</span>
                <a href={resolveAssetUrl(item.url)} target="_blank" rel="noreferrer" title="打开资产"><ExternalLink size={12} /></a>
              </div>
            </>
          )}
        />
        <div className="section-head mt-16"><h3>任务列表</h3><span className="muted small">{tasks.length} 项</span></div>
        {tasks.length === 0 ? <div className="empty small">还没有生成任务。</div> : (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>类型</th><th>模型</th><th>状态</th><th>创建时间</th><th>任务 ID</th></tr></thead>
            <tbody>{tasks.map(t => <tr key={t.taskId || t.id}>
              <td>{t.type}</td><td>{t.model || '—'}</td><td>{t.status}</td>
              <td>{t.createdAt ? new Date(t.createdAt).toLocaleString('zh-CN') : '—'}</td>
              <td><code>{String(t.taskId || t.id).slice(0, 16)}</code></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </>}
    </div>
  );
}
