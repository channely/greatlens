import React, { useState } from 'react';
import {
  Camera, Users, Film, Lock, Unlock, ChevronRight, SlidersHorizontal,
  Sparkles, Boxes, Eye,
} from 'lucide-react';

const EXPRESSION_LABELS = {
  neutral: '平静', happy: '开心', curious: '好奇', surprised: '惊讶', serious: '严肃',
};
const MOTION_LABELS = {
  static: '固定', 'dolly-in': '推近', 'dolly-out': '拉远', pan: '平移', orbit: '环绕',
};

function clampColor(hex) { return /^#[0-9a-fA-F]{3,8}$/.test(String(hex)) ? hex : '#8b5cf6'; }

export default function DirectorConsole({ dsl, compiled, currentShot, onPatch, busy, onSelectShot }) {
  const [panel, setPanel] = useState('shots');
  if (!dsl) return <div className="card vp-console-empty"><Boxes size={18} /> 生成 DSL 后可在此实时调整机位、角色与镜头。</div>;

  const shots = compiled?.timeline?.shots || [];
  const characters = dsl.characters || [];
  const assets = Object.fromEntries((dsl.assets || []).map(a => [a.id, a]));

  return (
    <div className="card vp-console">
      <div className="vp-console-tabs">
        <button className={panel === 'shots' ? 'active' : ''} onClick={() => setPanel('shots')}><Film size={14} /> 镜头</button>
        <button className={panel === 'chars' ? 'active' : ''} onClick={() => setPanel('chars')}><Users size={14} /> 角色</button>
        <button className={panel === 'tree' ? 'active' : ''} onClick={() => setPanel('tree')}><Eye size={14} /> 场景树</button>
      </div>

      {panel === 'shots' && (
        <div className="vp-console-body">
          <h4>镜头列表 <span className="muted small">{shots.length} 镜</span></h4>
          <div className="vp-shot-list">
            {shots.map((s, i) => {
              const src = dsl.shots.find(x => x.id === s.id) || {};
              const active = currentShot?.id === s.id;
              return (
                <button key={s.id} className={`vp-shot-item ${active ? 'active' : ''}`} onClick={() => onSelectShot(s)}>
                  <span className="vp-shot-num">{i + 1}</span>
                  <span className="vp-shot-main">
                    <strong>镜头 {i + 1}</strong>
                    <span className="muted small">{MOTION_LABELS[src.camera?.motion?.type] || src.camera?.motion?.type || '固定'} · fov {src.camera?.fov ?? '—'} · {s.durationSec}s</span>
                  </span>
                  <span className="vp-shot-time">{s.startSec.toFixed(0)}–{s.endSec.toFixed(0)}s</span>
                </button>
              );
            })}
          </div>
          {currentShot && (() => {
            const src = dsl.shots.find(x => x.id === currentShot.id);
            if (!src) return null;
            return (
              <div className="vp-inspector">
                <h4><SlidersHorizontal size={14} /> 镜头参数 · {currentShot.id}</h4>
                <label className="vp-field"><span>视场角 fov</span>
                  <input type="range" min="10" max="120" value={src.camera?.fov ?? 45}
                    onChange={e => onPatch([{ op: 'set', targetId: src.id, path: 'camera.fov', value: Number(e.target.value) }])} />
                  <b>{src.camera?.fov ?? 45}°</b>
                </label>
                <label className="vp-field"><span>镜头运动</span>
                  <select value={src.camera?.motion?.type || 'static'}
                    onChange={e => onPatch([{ op: 'set', targetId: src.id, path: 'camera.motion.type', value: e.target.value }])}>
                    {Object.entries(MOTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="vp-field"><span>时长（秒）</span>
                  <input type="number" min="0.1" max="60" step="0.5" value={src.durationSec}
                    onChange={e => onPatch([{ op: 'set', targetId: src.id, path: 'durationSec', value: Number(e.target.value) }])} />
                </label>
                <p className="muted small">提示：修改镜头时长需保持总时长与 DSL meta.durationSec 一致，否则校验会拦下。</p>
              </div>
            );
          })()}
        </div>
      )}

      {panel === 'chars' && (
        <div className="vp-console-body">
          <h4>角色与表演</h4>
          {characters.map(c => {
            const a = assets[c.assetId] || {};
            return (
              <div key={c.id} className="vp-char-card">
                <div className="vp-char-head"><strong>{c.name}</strong>
                  <span className="vp-badge">{a.source || 'model'}</span>
                  {a.license && <span className="muted small">{a.license}</span>}
                </div>
                <div className="vp-char-grid">
                  <label className="vp-field"><span>表情</span>
                    <select value={c.expression || 'neutral'}
                      onChange={e => onPatch([{ op: 'set', targetId: c.id, path: 'expression', value: e.target.value }])}>
                      {Object.entries(EXPRESSION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                  <label className="vp-field"><span>缩放</span>
                    <input type="range" min="0.2" max="3" step="0.05" value={c.scale ?? 1}
                      onChange={e => onPatch([{ op: 'set', targetId: c.id, path: 'scale', value: Number(e.target.value) }])} />
                  </label>
                  <label className="vp-field"><span>X 位置</span>
                    <input type="range" min="-4" max="4" step="0.1" value={c.position?.[0] ?? 0}
                      onChange={e => onPatch([{ op: 'set', targetId: c.id, path: 'position.0', value: Number(e.target.value) }])} />
                  </label>
                  <label className="vp-field"><span>主色</span>
                    <input type="color" value={clampColor(a.controls?.color)}
                      onChange={e => onPatch([{ op: 'set', targetId: a.id, path: 'controls.color', value: e.target.value }])} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {panel === 'tree' && (
        <div className="vp-console-body">
          <h4>场景树（来自编译产物）</h4>
          <div className="vp-tree">
            {(compiled?.sceneGraph?.nodes || []).map(n => (
              <div key={n.id} className={`vp-tree-node ${n.kind}`}>
                <ChevronRight size={13} />
                <strong>{n.name || n.id}</strong>
                <span className="vp-badge">{n.kind}</span>
                {n.assetUrl && <span className="muted small">{n.assetUrl}</span>}
              </div>
            ))}
          </div>
          <p className="muted small">场景树由确定性解释器从 DSL 编译而来，不直接编辑；改 DSL 即可重建。</p>
        </div>
      )}
    </div>
  );
}
