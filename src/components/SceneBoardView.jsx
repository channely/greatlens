import React, { useState } from 'react';
import { MapPin, LayoutGrid, Table2 } from 'lucide-react';
import CanvasBoard from './CanvasBoard.jsx';
import { EntityAssetField } from './AssetPicker.jsx';

export default function SceneBoardView({ project, ep, scenes = [], mutate }) {
  const [view, setView] = useState('table');

  function findMeta(nodeId) {
    return (ep?.scenes || []).find(s => s.nodeId === nodeId || s.id === nodeId);
  }

  function patchMeta(nodeId, patch) {
    mutate((e, p) => {
      e.scenes = e.scenes || [];
      let meta = e.scenes.find(s => s.nodeId === nodeId || s.id === nodeId);
      if (!meta) { meta = { id: nodeId, nodeId }; e.scenes.push(meta); }
      Object.assign(meta, patch);
      void p;
    });
  }

  function commitLayout(nodeId, pos) {
    mutate((_, p) => {
      p.viewLayouts = p.viewLayouts || {};
      p.viewLayouts.scenes = p.viewLayouts.scenes || {};
      p.viewLayouts.scenes[ep.id] = { ...(p.viewLayouts.scenes[ep.id] || {}), [nodeId]: pos };
    });
  }

  const layout = project.viewLayouts?.scenes?.[ep?.id] || {};
  const items = scenes.map(s => ({ id: s.nodeId || `scene-${s.no}`, title: s.text, no: s.no }));

  return (
    <div className="simple-view">
      <div className="view-head">
        <div><h2>场景</h2><p className="muted">场景身份来自剧本 scene heading 节点；这里只放制作元数据与视觉锚点。</p></div>
        <div className="loc-view-switch">
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}><Table2 size={13} /> 表格</button>
          <button className={view === 'canvas' ? 'active' : ''} onClick={() => setView('canvas')}><LayoutGrid size={13} /> 画布</button>
        </div>
      </div>
      {scenes.length === 0 ? <div className="empty small">剧本里还没有场景标题。</div> : view === 'table' ? (
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>#</th><th>场景标题</th><th>背景 / 视觉</th><th>制作备注</th></tr></thead>
          <tbody>{scenes.map(s => {
            const nodeId = s.nodeId || `scene-${s.no}`;
            const meta = findMeta(nodeId) || {};
            return <tr key={nodeId}>
              <td>{s.no}</td>
              <td>{s.text}</td>
              <td><EntityAssetField
                label="背景"
                project={project}
                generation={{ purpose: 'scene', targetKind: 'scene', targetId: nodeId, episodeId: ep.id, slot: 'backgroundImage' }}
                binding={{ kind: 'scene', projectId: project.id, episodeId: ep.id, entityId: nodeId, slot: 'backgroundImage' }}
                value={meta.backgroundImage}
                onChange={ref => patchMeta(nodeId, { backgroundImage: ref })}
              /></td>
              <td><input value={meta.notes || ''} placeholder="拍摄 / 连续性备注" onChange={e => patchMeta(nodeId, { notes: e.target.value })} /></td>
            </tr>;
          })}</tbody>
        </table></div>
      ) : (
        <CanvasBoard items={items} layout={layout} onCommit={commitLayout} empty="暂无场景" renderItem={(item) => (
          <>
            <div className="loc-node-head"><MapPin size={12} className="loc-grip" /><span className="loc-node-title">S{item.no}</span></div>
            <div className="loc-node-sub"><span>{item.title.slice(0, 42)}</span></div>
          </>
        )} />
      )}
    </div>
  );
}
