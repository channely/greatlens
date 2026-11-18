import React, { useMemo, useRef, useState } from 'react';
import {
  Ruler, Film, Volume2, Type, Flag, Plus, Trash2,
  ArrowUp, ArrowDown, Sparkles, Download, Clock, GripVertical,
} from 'lucide-react';

// 景别选项（与「分镜」tab 保持一致）
const SHOT_SIZES = ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写'];

// 解析时长："3s" / "3" / "3.5s" → 秒数；非法值回退 3s
function parseDuration(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  const m = String(v ?? '').match(/\d+(\.\d+)?/);
  const n = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 3;
}

// 秒 → mm:ss
function mmss(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// 秒 → "3.5s" 文案
function secLabel(sec) {
  return `${Number((Math.round(sec * 10) / 10).toFixed(1))}s`;
}

const css = `
.tl-root { font-family: var(--font-ui, sans-serif); color: var(--ink); font-size: 13px; }
.tl-root *, .tl-root *::before, .tl-root *::after { box-sizing: border-box; }
.tl-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.tl-toolbar h2 { font-size: 16px; margin: 0 8px 0 0; display: flex; align-items: center; gap: 7px; }
.tl-spacer { flex: 1; }
.tl-target-box { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.tl-target-box input { width: 68px; padding: 5px 7px; border: 1px solid var(--border); border-radius: 6px; background: var(--white); color: var(--ink); }
.tl-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 7px; border: 1px solid var(--border); background: var(--white); color: var(--ink); cursor: pointer; font-size: 12px; line-height: 1; }
.tl-btn:hover { border-color: var(--primary); }
.tl-btn.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.tl-btn.ghost { background: transparent; }
.tl-btn:disabled { opacity: .5; cursor: not-allowed; }

.tl-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.tl-stat { flex: 1 1 120px; border: 1px solid var(--border); border-radius: 9px; background: var(--white); padding: 9px 12px; }
.tl-stat-label { color: var(--muted); font-size: 11px; margin-bottom: 3px; }
.tl-stat-value { font-size: 18px; font-weight: 600; }
.tl-stat.over { border-color: #e5484d; background: rgba(229, 72, 77, .08); }
.tl-stat.over .tl-stat-value { color: #e5484d; }
:root[data-theme="dark"] .tl-stat.over { background: rgba(229, 72, 77, .14); }

.tl-board { display: flex; border: 1px solid var(--border); border-radius: var(--radius, 12px); background: var(--white); overflow: hidden; }
.tl-labels { width: 104px; flex: 0 0 104px; border-right: 1px solid var(--border); background: var(--paper); z-index: 2; }
.tl-label-head { height: 30px; display: flex; align-items: center; gap: 5px; padding: 0 10px; font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--border); }
.tl-label { height: 58px; display: flex; align-items: center; gap: 7px; padding: 0 10px; border-bottom: 1px solid var(--border); font-size: 12px; }
.tl-label:last-child { border-bottom: 0; }
.tl-label .tl-lname { display: flex; flex-direction: column; line-height: 1.3; }
.tl-label .tl-lname small { color: var(--muted); font-size: 10px; }

.tl-scroll { flex: 1; overflow-x: auto; overflow-y: hidden; }
.tl-canvas { position: relative; min-width: 100%; }
.tl-ruler { position: relative; height: 30px; border-bottom: 1px solid var(--border); background-color: var(--paper); background-image: repeating-linear-gradient(90deg, transparent 0 calc(var(--tl-grid) - 1px), var(--border) calc(var(--tl-grid) - 1px) var(--tl-grid)); cursor: crosshair; }
.tl-tick { position: absolute; top: 0; height: 100%; border-left: 1px solid var(--border); }
.tl-tick span { position: absolute; left: 4px; top: 6px; font-size: 10px; color: var(--muted); white-space: nowrap; }
.tl-track { position: relative; height: 58px; border-bottom: 1px solid var(--border); background-color: var(--white); background-image: repeating-linear-gradient(90deg, transparent 0 calc(var(--tl-grid) - 1px), var(--border) calc(var(--tl-grid) - 1px) var(--tl-grid)); }
.tl-track:last-child { border-bottom: 0; }
.tl-target-line { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px dashed #e5484d; z-index: 2; pointer-events: none; }
.tl-target-line span { position: absolute; top: 2px; left: 4px; font-size: 10px; color: #e5484d; white-space: nowrap; }
.tl-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--primary); z-index: 4; pointer-events: none; }
.tl-playhead::before { content: ''; position: absolute; top: 0; left: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--primary); }
.tl-playhead .tl-ph-label { position: absolute; top: 1px; left: 7px; padding: 1px 5px; border-radius: 4px; background: var(--primary); color: #fff; font-size: 10px; white-space: nowrap; }

.tl-block { position: absolute; top: 6px; height: 46px; border-radius: 6px; padding: 4px 7px; overflow: hidden; cursor: pointer; font-size: 11px; line-height: 1.35; border: 1px solid var(--border); background: var(--surface-2, var(--paper)); color: var(--ink); }
.tl-block:hover { filter: brightness(1.04); }
.tl-block.selected { outline: 2px solid var(--primary); outline-offset: 1px; z-index: 3; }
.tl-block.video { border-color: var(--primary); background: rgba(26, 74, 53, .09); }
.tl-block.audio { border-color: var(--sage, var(--primary)); background: rgba(120, 160, 110, .12); }
.tl-block.subtitle { border-color: #6a8fbf; background: rgba(90, 130, 190, .12); }
.tl-block.beat { border-color: #b8863b; background: rgba(200, 150, 60, .12); }
:root[data-theme="dark"] .tl-block.video { background: rgba(67, 196, 122, .16); }
:root[data-theme="dark"] .tl-block.audio { background: rgba(127, 174, 122, .14); }
:root[data-theme="dark"] .tl-block.subtitle { background: rgba(110, 150, 210, .16); }
:root[data-theme="dark"] .tl-block.beat { background: rgba(210, 160, 70, .16); }
.tl-block-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-block-sub { color: var(--muted); font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-resize { position: absolute; top: 0; right: 0; bottom: 0; width: 9px; cursor: ew-resize; display: flex; align-items: center; justify-content: center; color: var(--muted); }
.tl-resize:hover { color: var(--primary); }
.tl-placeholder { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 11px; font-style: italic; }

.tl-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px; text-align: center; color: var(--muted); border: 1px dashed var(--border); border-radius: 9px; margin-bottom: 12px; }
.tl-empty p { margin: 0; font-size: 12px; }

.tl-details { margin-top: 12px; border: 1px solid var(--border); border-radius: var(--radius, 12px); background: var(--white); padding: 12px 14px; }
.tl-details-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tl-details-head strong { font-size: 13px; }
.tl-details-head .tl-spacer { flex: 1; }
.tl-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.tl-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--muted); }
.tl-field input, .tl-field select, .tl-field textarea { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--white); color: var(--ink); font-size: 12px; font-family: inherit; resize: vertical; }
.tl-field textarea { min-height: 46px; }
.tl-span2 { grid-column: span 2; }
.tl-span3 { grid-column: span 3; }
.tl-detail-actions { display: flex; gap: 8px; margin-top: 10px; }
.tl-detail-actions .danger { color: #e5484d; border-color: #e5484d; }
.tl-hint { color: var(--muted); font-size: 11px; }
`;

export default function Timeline({ ep, project, mutate, onAsk }) {
  const shots = ep?.shots || [];
  const nodes = ep?.nodes || [];
  const beats = ep?.beats || [];
  const [selected, setSelected] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [freezeSec, setFreezeSec] = useState(null); // 拖动时锁定时间轴比例，避免抖动
  const dragRef = useRef(null);

  // 目标时长（默认 60s）
  const targetSeconds = Math.max(1, Number(ep?.timeline?.targetSeconds) || 60);

  // 各镜头秒数与总时长
  const durations = useMemo(() => shots.map(s => parseDuration(s.duration)), [shots]);
  const shotsTotal = useMemo(() => durations.reduce((a, b) => a + b, 0), [durations]);

  // 时间轴可见范围：基于画面总时长自适应，最小 10s
  const rawMax = Math.max(shotsTotal, 10);
  const tickStep = rawMax <= 30 ? 5 : rawMax <= 120 ? 10 : 30;
  const timelineSeconds = Math.max(tickStep, Math.ceil(rawMax * 1.1 / tickStep) * tickStep);
  const effectiveMax = freezeSec ?? timelineSeconds;
  // 每秒像素数自适应，让时间轴大致填满可视区；拖动时被冻结保持稳定
  const pps = Math.max(14, Math.min(44, Math.round(880 / effectiveMax)));
  const contentWidth = Math.max(effectiveMax * pps, 1);
  const gridPx = tickStep * pps;

  // 播放头不要超出时间轴
  const ph = Math.min(Math.max(playhead, 0), effectiveMax);

  // 字幕节点：按顺序沿时间轴均匀分布
  const subtitles = useMemo(
    () => nodes.filter(n => n.type === 'subtitle' && n.text && n.text.trim()),
    [nodes]
  );
  // 节拍：按 order（无则按数组顺序）排列
  const beatsSorted = useMemo(
    () => [...beats].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [beats]
  );

  // 累计起点：镜头 i 的起始秒数
  const shotStarts = useMemo(() => {
    const out = [];
    let acc = 0;
    durations.forEach(d => { out.push(acc); acc += d; });
    return out;
  }, [durations]);

  // 选中项越界保护
  const selIdx = selected != null && shots[selected] ? selected : null;

  function setTarget(v) {
    const n = Math.max(1, Math.min(3600, Number(v) || 1));
    mutate(e => { e.timeline = { ...(e.timeline || {}), targetSeconds: n }; });
  }

  function addShot() {
    mutate(e => {
      if (!Array.isArray(e.shots)) e.shots = [];
      e.shots.push({
        id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        scene: '', shotSize: '中景', camera: '固定', motion: '',
        duration: '3s', visual: '', audio: '',
      });
    });
    setSelected(shots.length);
  }

  function updateShot(i, patch) {
    mutate(e => { Object.assign(e.shots[i], patch); });
  }

  function removeShot(i) {
    mutate(e => { e.shots.splice(i, 1); });
    setSelected(prev => prev == null ? null : prev === i ? null : prev > i ? prev - 1 : prev);
  }

  function moveShot(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= shots.length) return;
    mutate(e => { const a = e.shots; [a[i], a[j]] = [a[j], a[i]]; });
    setSelected(j);
  }

  // 从分镜导入：若还没有镜头且剧本有场景，引导去「分镜」tab 生成
  function importFromShots() {
    const hasScene = nodes.some(n => n.type === 'scene');
    if (!shots.length && hasScene) {
      onAsk('剧本里已有场景，但还没有镜头。请到「分镜」tab 用 AI 分镜模式把这些场景拆成镜头；完成后回到「时间轴」即可看到。');
    } else {
      onAsk('请根据当前剧本场景，生成一份标注了每个镜头时长的分镜表');
    }
  }

  // 拖动镜头右侧手柄改时长（最小 1s，最大 60s，实时更新）
  function onResizeDown(e, i, curSec) {
    e.stopPropagation();
    e.preventDefault();
    setFreezeSec(timelineSeconds); // 冻结比例
    dragRef.current = { idx: i, startX: e.clientX, startSec: curSec, last: curSec, pps };
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeUp);
  }
  function onResizeMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const raw = d.startSec + (e.clientX - d.startX) / d.pps;
    const sec = Math.max(1, Math.min(60, Math.round(raw * 10) / 10));
    if (sec !== d.last) {
      d.last = sec;
      const idx = d.idx;
      mutate(ep2 => { ep2.shots[idx].duration = `${sec}s`; });
    }
  }
  function onResizeUp() {
    dragRef.current = null;
    setFreezeSec(null);
    document.removeEventListener('mousemove', onResizeMove);
    document.removeEventListener('mouseup', onResizeUp);
  }

  // 点击标尺移动播放头
  function onRulerClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPlayhead(Math.max(0, Math.min(effectiveMax, (e.clientX - rect.left) / pps)));
  }

  const ticks = [];
  for (let t = 0; t <= effectiveMax; t += tickStep) ticks.push(t);

  return (
    <div className="tl-root">
      <style>{css}</style>

      {/* 工具栏 */}
      <div className="tl-toolbar">
        <h2><Ruler size={17} /> 时间轴</h2>
        <button className="tl-btn primary" onClick={addShot}><Plus size={14} /> 添加镜头</button>
        <button className="tl-btn ghost" onClick={importFromShots}><Download size={14} /> 从分镜导入</button>
        <div className="tl-spacer" />
        <div className="tl-target-box">
          <Clock size={13} /> 目标时长
          <input type="number" min="1" max="3600" value={targetSeconds} onChange={e => setTarget(e.target.value)} title="目标时长（秒）" />
          <span>秒</span>
        </div>
      </div>

      {/* 统计条 */}
      <div className="tl-stats">
        <div className="tl-stat"><div className="tl-stat-label">总时长</div><div className="tl-stat-value">{mmss(shotsTotal)}</div></div>
        <div className="tl-stat"><div className="tl-stat-label">镜头数</div><div className="tl-stat-value">{shots.length}</div></div>
        <div className="tl-stat"><div className="tl-stat-label">平均每镜</div><div className="tl-stat-value">{shots.length ? secLabel(shotsTotal / shots.length) : '—'}</div></div>
        <div className={`tl-stat ${shotsTotal > targetSeconds ? 'over' : ''}`}>
          <div className="tl-stat-label">目标时长</div>
          <div className="tl-stat-value">
            {mmss(targetSeconds)}
            {shotsTotal > targetSeconds && <span style={{ fontSize: 11, marginLeft: 6 }}>超出 {secLabel(shotsTotal - targetSeconds)}</span>}
          </div>
        </div>
      </div>

      {/* 无镜头时的空状态引导 */}
      {shots.length === 0 && (
        <div className="tl-empty">
          <Film size={22} />
          <p>还没有镜头。时间轴需要镜头作为素材——让 AI 把当前场景拆成镜头，或到「分镜」tab 手动添加。</p>
          <button className="tl-btn primary" onClick={() => onAsk('把当前场景拆成可拍摄的镜头列表，标注每个镜头的时长')}>
            <Sparkles size={14} /> 让 AI 拆镜头
          </button>
        </div>
      )}

      {/* 多轨时间轴 */}
      <div className="tl-board" style={{ '--tl-grid': `${gridPx}px` }}>
        {/* 左侧固定标签列 */}
        <div className="tl-labels">
          <div className="tl-label-head"><Ruler size={12} /> 秒</div>
          <div className="tl-label"><Film size={14} color="var(--primary)" /><span className="tl-lname">画面轨<small>{shots.length} 个镜头</small></span></div>
          <div className="tl-label"><Volume2 size={14} color="var(--sage, var(--primary))" /><span className="tl-lname">声音轨<small>音效 / 对白</small></span></div>
          <div className="tl-label"><Type size={14} color="#6a8fbf" /><span className="tl-lname">字幕轨<small>{subtitles.length} 条字幕</small></span></div>
          <div className="tl-label"><Flag size={14} color="#b8863b" /><span className="tl-lname">节拍轨<small>{beatsSorted.length} 个节拍</small></span></div>
        </div>

        {/* 右侧横向滚动的时间网格 */}
        <div className="tl-scroll">
          <div className="tl-canvas" style={{ width: contentWidth }}>
            {/* 标尺 */}
            <div className="tl-ruler" onClick={onRulerClick} title="点击移动播放头">
              {ticks.map(t => <div key={t} className="tl-tick" style={{ left: t * pps }}><span>{t}s</span></div>)}
            </div>

            {/* 画面轨 */}
            <div className="tl-track">
              {shots.map((s, i) => (
                <div
                  key={s.id || i}
                  className={`tl-block video ${selIdx === i ? 'selected' : ''}`}
                  style={{ left: shotStarts[i] * pps, width: Math.max(durations[i] * pps, 26) }}
                  onClick={() => setSelected(i)}
                  title={`#${i + 1} ${s.shotSize || ''} · ${durations[i]}s`}
                >
                  <div className="tl-block-title">#{i + 1} {s.shotSize || '镜头'}</div>
                  <div className="tl-block-sub">{s.visual || s.scene || '（无画面摘要）'}</div>
                  <div className="tl-resize" title="拖动改时长" onMouseDown={e => onResizeDown(e, i, durations[i])} onClick={e => e.stopPropagation()}>
                    <GripVertical size={10} />
                  </div>
                </div>
              ))}
            </div>

            {/* 声音轨：与镜头一一对应 */}
            <div className="tl-track">
              {shots.map((s, i) => (
                <div
                  key={s.id || i}
                  className={`tl-block audio ${selIdx === i ? 'selected' : ''}`}
                  style={{ left: shotStarts[i] * pps, width: Math.max(durations[i] * pps, 26) }}
                  onClick={() => setSelected(i)}
                  title={s.audio || '（无声音）'}
                >
                  <div className="tl-block-title">#{i + 1} 声音</div>
                  <div className="tl-block-sub">{s.audio || '（无音效 / 对白）'}</div>
                </div>
              ))}
            </div>

            {/* 字幕轨 */}
            <div className="tl-track">
              {subtitles.length === 0 ? (
                <div className="tl-placeholder">剧本中暂无字幕节点（type: subtitle）</div>
              ) : (() => {
                const step = effectiveMax / subtitles.length;
                return subtitles.map((n, i) => (
                  <div key={n.id || i} className="tl-block subtitle" style={{ left: i * step * pps, width: Math.max(step * 0.92 * pps, 40) }} title={n.text}>
                    <div className="tl-block-sub">{n.text}</div>
                  </div>
                ));
              })()}
            </div>

            {/* 节拍轨 */}
            <div className="tl-track">
              {beatsSorted.length === 0 ? (
                <div className="tl-placeholder">还没有节拍（ep.beats）</div>
              ) : beatsSorted.map((b, i) => {
                const start = typeof b.time === 'number' ? b.time : i * effectiveMax / beatsSorted.length;
                const width = typeof b.duration === 'number' ? b.duration : Math.max(2, effectiveMax / beatsSorted.length);
                return (
                  <div key={b.id || i} className="tl-block beat" style={{ left: start * pps, width: Math.max(width * pps, 34) }} title={b.name || `节拍 ${i + 1}`}>
                    <div className="tl-block-title">{b.name || `节拍 ${i + 1}`}</div>
                  </div>
                );
              })}
            </div>

            {/* 目标时长参考线（在时间轴范围内时显示） */}
            {targetSeconds <= effectiveMax && (
              <div className="tl-target-line" style={{ left: targetSeconds * pps }}><span>目标 {mmss(targetSeconds)}</span></div>
            )}

            {/* 当前播放头（覆盖标尺与所有轨道） */}
            <div className="tl-playhead" style={{ left: ph * pps }}>
              <span className="tl-ph-label">{ph.toFixed(1)}s</span>
            </div>
          </div>
        </div>
      </div>

      {/* 选中镜头的详情编辑面板 */}
      {selIdx != null && (
        <div className="tl-details">
          <div className="tl-details-head">
            <strong>镜头 #{selIdx + 1} · 编辑</strong>
            <span className="tl-hint">拖动时间轴上镜头右缘的手柄可直接改时长</span>
            <div className="tl-spacer" />
            <button className="tl-btn" disabled={selIdx === 0} onClick={() => moveShot(selIdx, -1)}><ArrowUp size={13} /> 上移</button>
            <button className="tl-btn" disabled={selIdx === shots.length - 1} onClick={() => moveShot(selIdx, 1)}><ArrowDown size={13} /> 下移</button>
            <button className="tl-btn danger" onClick={() => removeShot(selIdx)}><Trash2 size={13} /> 删除</button>
          </div>
          <div className="tl-grid">
            <label className="tl-field">时长
              <input value={shots[selIdx].duration ?? ''} onChange={e => updateShot(selIdx, { duration: e.target.value })} placeholder="3s" />
            </label>
            <label className="tl-field">景别
              <select value={shots[selIdx].shotSize || ''} onChange={e => updateShot(selIdx, { shotSize: e.target.value })}>
                {SHOT_SIZES.map(x => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className="tl-field">机位
              <input value={shots[selIdx].camera ?? ''} onChange={e => updateShot(selIdx, { camera: e.target.value })} placeholder="固定 / 手持…" />
            </label>
            <label className="tl-field">运动
              <input value={shots[selIdx].motion ?? ''} onChange={e => updateShot(selIdx, { motion: e.target.value })} placeholder="推 / 拉 / 摇…" />
            </label>
            <label className="tl-field tl-span2">场景
              <input value={shots[selIdx].scene ?? ''} onChange={e => updateShot(selIdx, { scene: e.target.value })} placeholder="INT. / EXT. …" />
            </label>
            <label className="tl-field tl-span3">画面摘要
              <textarea value={shots[selIdx].visual ?? ''} onChange={e => updateShot(selIdx, { visual: e.target.value })} placeholder="观众看到什么？" />
            </label>
            <label className="tl-field tl-span3">声音 / 对白
              <textarea value={shots[selIdx].audio ?? ''} onChange={e => updateShot(selIdx, { audio: e.target.value })} placeholder="音效、环境声或对白" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
