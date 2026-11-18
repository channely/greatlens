import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, MapPin, Network, Layers, GripVertical, Check } from 'lucide-react';

// 生成稳定 id，与项目里其它实体的写法保持一致
const uid = () => `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// 名称归一化：用于把「剧本派生地点」与「制作表地点」对齐
const norm = (s) => String(s ?? '').trim().toUpperCase();

// 分组柔和配色：浅 / 深主题下都能看清
const GROUP_COLORS = ['#6b8f71', '#b0835f', '#6f83a8', '#9a6f91', '#6f9099', '#a08a5c', '#806fa8', '#6f9a7d'];
const colorOf = (g) => {
  const k = g || '';
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
};

// 画布默认网格位置：仅用于显示，不写回 project
const COLS = 5, CW = 150, CH = 96;
const defaultPos = (i) => ({ x: 16 + (i % COLS) * CW, y: 16 + Math.floor(i / COLS) * CH });

// 自包含样式，全部 .loc- 前缀，颜色走主题变量以兼容浅 / 深主题
const css = `
.loc-root { font-family: var(--font-ui, inherit); color: var(--ink, #171a19); }
.loc-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; flex-wrap:wrap; }
.loc-tabs { display:inline-flex; border:1px solid var(--border, #e3eae5); border-radius:10px; overflow:hidden; background:var(--surface-2, #f4f8f5); }
.loc-tab { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border:0; background:transparent; color:var(--muted, #717b74); font-size:13px; cursor:pointer; }
.loc-tab.active { background:var(--primary, #1a4a35); color:#fff; }
:root[data-theme="dark"] .loc-tab.active { background:var(--primary-dark, #1a4a35); }
.loc-add { display:inline-flex; align-items:center; gap:6px; padding:7px 13px; border:1px solid var(--border, #e3eae5); border-radius:9px; background:var(--surface, #fff); color:var(--ink, #171a19); font-size:13px; cursor:pointer; }
.loc-add:hover { border-color:var(--primary, #1a4a35); color:var(--primary, #1a4a35); }
.loc-derived { display:flex; align-items:flex-start; gap:8px; flex-wrap:wrap; font-size:12px; color:var(--muted, #717b74); margin-bottom:12px; }
.loc-derived strong { color:var(--ink, #171a19); }
.loc-derived-list { display:flex; flex-wrap:wrap; gap:6px; }
.loc-dchip { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; border:1px solid var(--border, #e3eae5); background:var(--surface-2, #f4f8f5); }
.loc-dchip.reg { color:var(--sage, #4a6d47); }
.loc-reg-btn { border:0; background:var(--primary, #1a4a35); color:#fff; border-radius:999px; padding:1px 7px; font-size:11px; cursor:pointer; }

/* 画布：点阵网格 + 可横向滚动 */
.loc-canvas-wrap { overflow:auto; border:1px solid var(--border, #e3eae5); border-radius:12px; background:var(--paper, #fafcf9); }
.loc-canvas { position:relative; width:820px; background-color:var(--paper, #fafcf9); background-image:radial-gradient(var(--line, rgba(26,74,53,.09)) 1px, transparent 1px); background-size:20px 20px; }
.loc-node { position:absolute; width:138px; min-height:56px; box-sizing:border-box; padding:8px 9px; border:1px solid var(--border, #e3eae5); border-left:3px solid var(--line, #e3eae5); border-radius:9px; background:var(--white, #fff); box-shadow:var(--shadow, 0 3px 14px rgba(0,0,0,.06)); cursor:grab; user-select:none; }
.loc-node.dragging { cursor:grabbing; box-shadow:var(--shadow-lg, 0 20px 48px rgba(0,0,0,.13)); z-index:5; }
.loc-node.open { cursor:default; }
.loc-node-head { display:flex; align-items:center; gap:4px; }
.loc-grip { color:var(--muted, #717b74); flex:none; }
.loc-node-title { font-size:13px; font-weight:600; color:var(--ink, #171a19); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.loc-node-sub { display:flex; justify-content:space-between; gap:6px; font-size:11px; color:var(--muted, #717b74); margin-top:4px; }
.loc-node-grp { color:var(--primary, #1a4a35); }

/* 卡片内联编辑区 */
.loc-editor { margin-top:8px; padding-top:8px; border-top:1px dashed var(--border, #e3eae5); display:flex; flex-direction:column; gap:6px; cursor:default; }
.loc-field { display:flex; flex-direction:column; gap:2px; font-size:11px; color:var(--muted, #717b74); }
.loc-field input, .loc-field textarea { width:100%; box-sizing:border-box; padding:5px 7px; font-size:12px; border:1px solid var(--border, #e3eae5); border-radius:6px; background:var(--surface-2, #f4f8f5); color:var(--ink, #171a19); font-family:inherit; resize:vertical; }
.loc-del { display:inline-flex; align-items:center; gap:5px; align-self:flex-start; border:0; background:transparent; color:#c0453b; font-size:11px; cursor:pointer; padding:2px 0; }
.loc-del:hover { text-decoration:underline; }

/* 分组视图 */
.loc-group-view { display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:14px; }
.loc-group-panel { border:1px solid var(--border, #e3eae5); border-radius:12px; background:var(--white, #fff); overflow:hidden; }
.loc-group-head { display:flex; align-items:center; gap:8px; padding:10px 12px; background:var(--surface-2, #f4f8f5); border-bottom:1px solid var(--border, #e3eae5); font-size:13px; color:var(--ink, #171a19); }
.loc-group-dot { width:10px; height:10px; border-radius:50%; flex:none; }
.loc-group-count { margin-left:auto; font-size:11px; color:var(--muted, #717b74); background:var(--surface-3, #eaf5ee); border-radius:999px; padding:1px 8px; }
.loc-group-items { padding:8px; display:flex; flex-direction:column; gap:8px; }
.loc-group-item { border:1px solid var(--border, #e3eae5); border-radius:9px; padding:8px; background:var(--surface, #fff); }
.loc-gi-head { display:flex; justify-content:space-between; align-items:center; gap:8px; cursor:pointer; }
.loc-gi-name { font-size:13px; font-weight:600; color:var(--ink, #171a19); }
.loc-gi-move { display:flex; gap:6px; margin-top:6px; }
.loc-gi-move select, .loc-gi-move input { flex:1; min-width:0; font-size:11px; padding:4px 6px; border:1px solid var(--border, #e3eae5); border-radius:6px; background:var(--surface-2, #f4f8f5); color:var(--ink, #171a19); }

/* 关系视图：SVG 共现网络 */
.loc-graph-wrap { border:1px solid var(--border, #e3eae5); border-radius:12px; overflow:auto; background:var(--paper, #fafcf9); }
.loc-graph { display:block; width:820px; height:460px; }
.loc-edge-label { fill:var(--primary, #1a4a35); font-size:11px; text-anchor:middle; paint-order:stroke; stroke:var(--paper, #fafcf9); stroke-width:3px; }
.loc-node-label { fill:#fff; font-size:12px; font-weight:600; text-anchor:middle; paint-order:stroke; }

/* 空状态 */
.loc-empty { padding:36px 16px; text-align:center; color:var(--muted, #717b74); border:1px dashed var(--border, #e3eae5); border-radius:12px; font-size:13px; }
`;

// 内联编辑区：名称 / 分组 / 实拍地点 / 备注 + 删除（改动直接 mutate）
function LocEditor({ l, groups, onChange, onDelete }) {
  return (
    <div className="loc-editor" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <label className="loc-field">名称
        <input value={l.name || ''} placeholder="地点名" onChange={e => onChange({ name: e.target.value })} />
      </label>
      <label className="loc-field">分组
        <input value={l.group || ''} placeholder="未分组" list="loc-group-options" onChange={e => onChange({ group: e.target.value })} />
      </label>
      <datalist id="loc-group-options">{groups.map(g => <option key={g} value={g} />)}</datalist>
      <label className="loc-field">实拍地点
        <input value={l.shooting || ''} placeholder="实拍地点 / 棚" onChange={e => onChange({ shooting: e.target.value })} />
      </label>
      <label className="loc-field">备注
        <textarea rows={2} value={l.notes || ''} placeholder="可达性 / 连续性…" onChange={e => onChange({ notes: e.target.value })} />
      </label>
      <button className="loc-del" onClick={onDelete}><Trash2 size={12} /> 删除地点</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 地点画布：地点表的「画布 / 分组 / 关系」三种视图，作为同一份数据的不同呈现
// ---------------------------------------------------------------------------
export default function LocationCanvas({ project, mutate, derived }) {
  const [view, setView] = useState('canvas');        // 当前视图：canvas / group / rel
  const [expanded, setExpanded] = useState(null);    // 当前展开编辑区的地点 id
  const [drag, setDrag] = useState(null);            // 正在拖动时暂存坐标 {id,x,y}

  const dragRef = useRef(null);                      // 拖动起点（避免闭包取到旧值）
  const suppressClickRef = useRef(false);            // 拖动结束后抑制一次 click，避免误展开
  const mutateRef = useRef(mutate);                  // 始终指向最新 mutate
  mutateRef.current = mutate;

  const locations = useMemo(() => project?.locations || [], [project]);
  const derivedLocs = useMemo(() => derived?.locations || [], [derived]);

  // 剧本地点按名称建索引，用于统计「派生场次数」和判断登记状态
  const derivedByNorm = useMemo(() => {
    const m = new Map();
    derivedLocs.forEach(d => m.set(norm(d.name), d));
    return m;
  }, [derivedLocs]);
  const registeredNorms = useMemo(() => new Set(locations.map(l => norm(l.name))), [locations]);
  const unregistered = useMemo(
    () => derivedLocs.filter(d => !registeredNorms.has(norm(d.name))),
    [derivedLocs, registeredNorms]
  );

  // 分组视图数据：空分组归入「未分组」
  const groups = useMemo(
    () => Array.from(new Set(locations.map(l => (l.group || '').trim()).filter(Boolean))),
    [locations]
  );
  const grouped = useMemo(() => {
    const m = new Map();
    locations.forEach(l => {
      const g = (l.group || '').trim() || '未分组';
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(l);
    });
    return Array.from(m.entries());
  }, [locations]);

  // 统一的字段修改入口：按 id 定位，拿到最新的 project 对象
  const updateLoc = (id, patch) => mutateRef.current((_, p) => {
    const it = p.locations.find(x => x.id === id);
    if (it) Object.assign(it, patch);
  });
  const deleteLoc = (id) => {
    mutateRef.current((_, p) => {
      const i = p.locations.findIndex(x => x.id === id);
      if (i >= 0) p.locations.splice(i, 1);
    });
    setExpanded(null);
  };

  // 新增地点 / 一键登记剧本地点：放到网格末尾
  const addLoc = () => {
    const pos = defaultPos(locations.length);
    const id = uid();
    mutateRef.current((_, p) => { p.locations.push({ id, name: '新地点', x: pos.x, y: pos.y, group: '' }); });
    setView('canvas');
    setExpanded(id);
  };
  const registerDerived = (d) => {
    const pos = defaultPos(locations.length);
    mutateRef.current((_, p) => { p.locations.push({ id: uid(), name: d.name, x: pos.x, y: pos.y, group: '' }); });
  };

  // ---- 拖动：mousedown 记起点 -> 本地 state 跟随鼠标 -> mouseup 才 mutate（节流，避免每帧保存）----
  const onCardDown = (e, l, pos) => {
    if (e.button !== 0) return;                 // 仅响应左键
    e.preventDefault();                         // 防止拖动时选中文字
    suppressClickRef.current = false;
    dragRef.current = { id: l.id, px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    setDrag({ id: l.id, x: pos.x, y: pos.y });
  };

  const isDragging = drag !== null;
  useEffect(() => {
    if (!isDragging) return;
    // 鼠标移动只更新本地 state，卡片实时跟随，但不写回项目
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const nx = Math.max(0, d.ox + e.clientX - d.px);
      const ny = Math.max(0, d.oy + e.clientY - d.py);
      if (Math.abs(nx - d.ox) > 2 || Math.abs(ny - d.oy) > 2) d.moved = true;
      setDrag(cur => cur ? { ...cur, x: nx, y: ny } : cur);
    };
    // 松手时才把最终坐标写回，并清理监听器
    const onUp = (e) => {
      const d = dragRef.current;
      if (d) {
        const nx = Math.max(0, d.ox + e.clientX - d.px);
        const ny = Math.max(0, d.oy + e.clientY - d.py);
        if (d.moved) {
          suppressClickRef.current = true;
          mutateRef.current((_, p) => {
            const it = p.locations.find(x => x.id === d.id);
            if (it) { it.x = nx; it.y = ny; }
          });
        }
      }
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  // 优先使用拖动中的临时坐标；否则用项目坐标；都没有则用默认网格位置（不写回）
  const posOf = (l, i) => (drag && drag.id === l.id
    ? { x: drag.x, y: drag.y }
    : (Number.isFinite(l.x) && Number.isFinite(l.y) ? { x: l.x, y: l.y } : defaultPos(i)));
  const derivedCount = (l) => derivedByNorm.get(norm(l.name))?.scenes?.length || 0;

  // 关系图：把「出现在同一场号」的两个剧本地点两两连线，边上标共同场次数
  const graph = useMemo(() => {
    const N = derivedLocs.length;
    const nodes = derivedLocs.map((d, i) => {
      const a = (Math.PI * 2 * i) / Math.max(N, 1) - Math.PI / 2;
      return { ...d, cx: 410 + 300 * Math.cos(a), cy: 230 + 180 * Math.sin(a) };
    });
    const edges = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const scenesA = derivedLocs[i].scenes || [];
        const common = scenesA.filter(s => (derivedLocs[j].scenes || []).includes(s));
        if (common.length) edges.push({ a: i, b: j, count: common.length });
      }
    }
    return { nodes, edges };
  }, [derivedLocs]);

  // 画布高度随地点数量增长，避免默认位置重叠
  const canvasH = Math.max(460, Math.ceil(Math.max(locations.length, 1) / COLS) * CH + 16);

  return (
    <div className="loc-root">
      <style>{css}</style>

      {/* 工具栏：视图切换 + 新增地点 */}
      <div className="loc-toolbar">
        <div className="loc-tabs">
          <button className={`loc-tab ${view === 'canvas' ? 'active' : ''}`} onClick={() => setView('canvas')}><MapPin size={14} /> 画布</button>
          <button className={`loc-tab ${view === 'group' ? 'active' : ''}`} onClick={() => setView('group')}><Layers size={14} /> 分组</button>
          <button className={`loc-tab ${view === 'rel' ? 'active' : ''}`} onClick={() => setView('rel')}><Network size={14} /> 关系</button>
        </div>
        <button className="loc-add" onClick={addLoc}><Plus size={14} /> 新增地点</button>
      </div>

      {/* 派生对照：未登记的剧本地点可一键加入制作表 */}
      <div className="loc-derived">
        <span>剧本派生 <strong>{derivedLocs.length}</strong> 个地点</span>
        {derivedLocs.length > 0 && (
          <span className="loc-derived-list">
            {derivedLocs.map((d, i) => {
              const reg = registeredNorms.has(norm(d.name));
              return (
                <span className={`loc-dchip ${reg ? 'reg' : ''}`} key={i}>
                  {d.name}
                  {reg
                    ? <Check size={11} />
                    : <button className="loc-reg-btn" onClick={() => registerDerived(d)}>+ 登记</button>}
                </span>
              );
            })}
          </span>
        )}
        {unregistered.length > 0 && <span>（{unregistered.length} 个未登记）</span>}
      </div>

      {/* 画布视图 */}
      {view === 'canvas' && (locations.length === 0
        ? <div className="loc-empty">还没有地点。点「新增地点」，或把上方剧本派生的地点登记进来。</div>
        : <div className="loc-canvas-wrap"><div className="loc-canvas" style={{ height: canvasH }}>
          {locations.map((l, i) => {
            const pos = posOf(l, i);
            const cnt = derivedCount(l);
            return (
              <div
                key={l.id}
                className={`loc-node ${drag && drag.id === l.id ? 'dragging' : ''} ${expanded === l.id ? 'open' : ''}`}
                style={{ left: pos.x, top: pos.y, borderLeftColor: l.group ? colorOf(l.group) : 'var(--line, #e3eae5)' }}
                onMouseDown={e => onCardDown(e, l, pos)}
                onClick={() => {
                  if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                  setExpanded(expanded === l.id ? null : l.id);
                }}
              >
                <div className="loc-node-head"><GripVertical size={13} className="loc-grip" /><span className="loc-node-title">{l.name || '未命名地点'}</span></div>
                <div className="loc-node-sub">
                  <span>{cnt ? `派生 ${cnt} 场` : '未派生'}</span>
                  {l.group && <span className="loc-node-grp">{l.group}</span>}
                </div>
                {expanded === l.id && (
                  <LocEditor l={l} groups={groups} onChange={patch => updateLoc(l.id, patch)} onDelete={() => deleteLoc(l.id)} />
                )}
              </div>
            );
          })}
        </div></div>
      )}

      {/* 分组视图 */}
      {view === 'group' && (locations.length === 0
        ? <div className="loc-empty">还没有地点可以分组。</div>
        : <div className="loc-group-view">
          {grouped.map(([g, items]) => {
            const isUn = g === '未分组';
            return (
              <div className="loc-group-panel" key={g}>
                <div className="loc-group-head">
                  <span className="loc-group-dot" style={{ background: isUn ? 'var(--muted, #717b74)' : colorOf(g) }} />
                  <strong>{g}</strong>
                  <span className="loc-group-count">{items.length}</span>
                </div>
                <div className="loc-group-items">
                  {items.map(l => {
                    const cnt = derivedCount(l);
                    return (
                      <div className="loc-group-item" key={l.id}>
                        <div className="loc-gi-head" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                          <span className="loc-gi-name">{l.name || '未命名地点'}</span>
                          <span className="loc-node-sub">{cnt ? `派生 ${cnt} 场` : '未派生'}</span>
                        </div>
                        {/* 两种改组方式：下拉选已有分组，或直接输入新分组名 */}
                        <div className="loc-gi-move">
                          <select value={l.group || ''} onChange={e => updateLoc(l.id, { group: e.target.value })}>
                            <option value="">未分组</option>
                            {groups.map(x => <option key={x} value={x}>{x}</option>)}
                          </select>
                          <input value={l.group || ''} placeholder="新分组名" onChange={e => updateLoc(l.id, { group: e.target.value })} />
                        </div>
                        {expanded === l.id && (
                          <LocEditor l={l} groups={groups} onChange={patch => updateLoc(l.id, patch)} onDelete={() => deleteLoc(l.id)} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 关系视图：剧本派生地点按同一场次共现连线 */}
      {view === 'rel' && (derivedLocs.length === 0
        ? <div className="loc-empty">剧本尚未派生地点，暂时无法绘制共现关系。</div>
        : <div className="loc-graph-wrap">
          <svg viewBox="0 0 820 460" className="loc-graph" role="img" aria-label="地点共现关系">
            {graph.edges.map((e, i) => {
              const a = graph.nodes[e.a], b = graph.nodes[e.b];
              const w = 1 + Math.min(e.count, 5) * 0.6;
              return (
                <g key={i}>
                  <line x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy} stroke="var(--primary, #1a4a35)" strokeWidth={w} opacity={0.5} />
                  <text x={(a.cx + b.cx) / 2} y={(a.cy + b.cy) / 2 - 4} className="loc-edge-label">{e.count}</text>
                </g>
              );
            })}
            {graph.nodes.map((n, i) => (
              <g key={i}>
                <circle cx={n.cx} cy={n.cy} r={20} fill="var(--primary-bright, #22c55e)" opacity={0.92} />
                <text x={n.cx} y={n.cy + 4} className="loc-node-label">{String(n.name || '').slice(0, 7)}</text>
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
