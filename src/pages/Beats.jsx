import React, { useMemo, useState } from 'react';
import {
  Sparkles, Plus, Trash2, ArrowUp, ArrowDown, Activity,
  ListOrdered, Lightbulb, Link2, Info, WandSparkles, BarChart3,
} from 'lucide-react';

// 生成唯一 id，沿用项目里其它页面的写法（时间戳 + 随机串）
const uid = () => `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------------------
// Save the Cat（救猫咪）经典 15 节拍模板
// 中文名 + 英文小字，写进 ep.beats 时英文存到 en 字段，便于列表里显示小字
// ---------------------------------------------------------------------------
const TEMPLATE_15 = [
  { name: '开场画面', en: 'Opening Image', tension: 2 },
  { name: '铺垫', en: 'Set-Up', tension: 2 },
  { name: '主题呈现', en: 'Theme Stated', tension: 2 },
  { name: '催化剂', en: 'Catalyst', tension: 4 },
  { name: '争执', en: 'Debate', tension: 3 },
  { name: '第二幕转折', en: 'Break into Two', tension: 4 },
  { name: 'B 故事', en: 'B Story', tension: 3 },
  { name: '好玩的部分', en: 'Fun and Games', tension: 3 },
  { name: '中点转折', en: 'Midpoint', tension: 5 },
  { name: '坏人逼近', en: 'Bad Guys Close In', tension: 4 },
  { name: '一切皆失', en: 'All is Lost', tension: 5 },
  { name: '灵魂黑夜', en: 'Dark Night of the Soul', tension: 4 },
  { name: '第三幕转折', en: 'Break into Three', tension: 4 },
  { name: '结局', en: 'Finale', tension: 5 },
  { name: '终场画面', en: 'Final Image', tension: 2 },
];

// 节拍强度条：tension 1-5 映射为 5 格
const TENSION_LEVELS = [1, 2, 3, 4, 5];

// 结构变动后，统一把 order 字段重写为数组下标，保证与外部数据一致
function renumber(arr) {
  arr.forEach((b, i) => { b.order = i; });
}


// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------
export default function Beats({ ep, mutate, onAsk }) {
  // beats 可能为空；用 useMemo 只为统计数据缓存，避免每次渲染重复计算
  const beats = ep?.beats || [];
  const outline = ep?.outline || [];
  const [activeId, setActiveId] = useState(null);

  const stats = useMemo(() => {
    const count = beats.length;
    if (!count) return { count: 0, avg: '—', top: '—' };
    const tensions = beats.map(b => Number(b.tension) || 1);
    const avg = (tensions.reduce((a, b) => a + b, 0) / count).toFixed(1);
    let topIdx = 0;
    tensions.forEach((t, i) => { if (t > tensions[topIdx]) topIdx = i; });
    const rawName = String(beats[topIdx].name || '').trim();
    const top = rawName || `第 ${topIdx + 1} 拍`;
    return { count, avg, top };
  }, [beats]);

  // ---- 结构操作：全部走 mutate，由父级负责克隆与自动保存 ----

  // 载入模板：若已有节拍，先 confirm 确认覆盖
  function loadTemplate() {
    if (beats.length && !window.confirm(`已有 ${beats.length} 个节拍，载入模板将覆盖它们。确定继续吗？`)) return;
    mutate(e => {
      // 每一拍都按规格写入 {id, name, summary, scene, tension, order}，en 仅用于英文小字显示
      e.beats = TEMPLATE_15.map((t, i) => ({
        id: uid(),
        name: t.name,
        en: t.en,
        summary: '',
        scene: '',
        tension: t.tension,
        order: i,
      }));
    });
    setActiveId(null);
  }

  // 修改单拍的某个字段
  function updateBeat(index, patch) {
    mutate(e => { Object.assign(e.beats[index], patch); });
  }

  // 上移 / 下移：交换位置后重排 order
  function moveBeat(index, delta) {
    mutate(e => {
      const arr = e.beats;
      const j = index + delta;
      if (j < 0 || j >= arr.length) return;
      const [moved] = arr.splice(index, 1);
      arr.splice(j, 0, moved);
      renumber(arr);
    });
  }

  // 删除一拍
  function removeBeat(index) {
    mutate(e => { e.beats.splice(index, 1); renumber(e.beats); });
  }

  // 在指定位置插入自定义空节拍
  function insertBeat(index) {
    const id = uid();
    mutate(e => {
      e.beats.splice(index, 0, {
        id, name: '', en: '', summary: '', scene: '', tension: 3, order: index,
      });
      renumber(e.beats);
    });
    setActiveId(id);
  }

  // 点击曲线节点：高亮并滚动到对应节拍
  function focusBeat(id) {
    setActiveId(id);
    const el = document.getElementById(`beat-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---- AI 协作 ----
  const askForSuggestions = () => onAsk(
    '基于当前大纲和剧本，给出分集节拍建议：标出每一拍的戏剧功能、催化剂与转折，先只给建议不要改剧本'
  );
  const askForDetail = (name) => onAsk(
    `请细化节拍「${name}」：给出可见行为、冲突和这一拍结束时的状态变化，不要改剧本`
  );

  return (
    <div className="beat-wrap">

      {/* 顶部标题与操作 */}
      <div className="beat-head">
        <div>
          <div className="beat-title">
            <Activity size={19} className="beat-title-icon" />
            <h2>节拍板 Beats</h2>
          </div>
          <p className="beat-sub">载入「救猫咪」15 节拍，用曲线检查起伏；曲线过平，说明某一拍缺少状态变化。</p>
        </div>
        <div className="beat-actions">
          <button className="beat-btn ghost sm" onClick={loadTemplate}><ListOrdered size={13} /> 载入 15 节拍模板</button>
          <button className="beat-btn primary sm" onClick={askForSuggestions}><Sparkles size={13} /> 让 AI 生成节拍建议</button>
        </div>
      </div>

      {/* 统计 */}
      <div className="beat-stats">
        <div className="beat-stat"><div className="beat-stat-label">节拍数</div><div className="beat-stat-num">{stats.count}</div></div>
        <div className="beat-stat"><div className="beat-stat-label">平均强度</div><div className="beat-stat-num">{stats.avg}<span style={{ fontSize: 12, color: 'var(--muted)' }}> / 5</span></div></div>
        <div className="beat-stat"><div className="beat-stat-label">最高强度节拍</div><div className="beat-stat-num small" title={stats.top}>{stats.top}</div></div>
      </div>

      <div className="beat-grid">
        {/* 左栏：曲线 + 列表 */}
        <div>
          <div className="beat-card">
            <h3 className="beat-section-title"><BarChart3 size={15} className="beat-stitle-icon" /> 强度曲线<span className="beat-count">纵轴 1–5 · 点击节点定位节拍</span></h3>
            {beats.length ? <StrengthCurve beats={beats} activeId={activeId} onPick={focusBeat} /> : (
              <div className="beat-curve-empty">载入模板或添加节拍后，这里会显示节奏起伏曲线。</div>
            )}
          </div>

          <div className="beat-card">
            <h3 className="beat-section-title"><ListOrdered size={15} className="beat-stitle-icon" /> 节拍列表<span className="beat-count">{beats.length} 拍</span></h3>
            {beats.length === 0 ? (
              <div className="beat-empty">
                <div className="beat-empty-icon"><ListOrdered size={26} /></div>
                <p>还没有节拍。先载入 15 节拍模板，或手动添加第一拍。</p>
                <div className="beat-actions" style={{ justifyContent: 'center' }}>
                  <button className="beat-btn primary sm" onClick={loadTemplate}><ListOrdered size={13} /> 载入 15 节拍模板</button>
                  <button className="beat-btn sm" onClick={() => insertBeat(0)}><Plus size={13} /> 新增节拍</button>
                </div>
              </div>
            ) : (
              <div className="beat-list">
                {beats.map((b, i) => (
                  <React.Fragment key={b.id}>
                    {/* 每一拍前都有一个插入点，支持在任意位置插入 */}
                    <div className="beat-insert">
                      <button className="beat-insert-btn" title="在此插入节拍" onClick={() => insertBeat(i)}><Plus size={11} /></button>
                    </div>
                    <div id={`beat-${b.id}`} className={`beat-row${activeId === b.id ? ' active' : ''}`}>
                      <div className="beat-row-head">
                        <span className="beat-num">{String(i + 1).padStart(2, '0')}</span>
                        <input
                          className="beat-name"
                          value={b.name || ''}
                          placeholder={`第 ${i + 1} 拍名称`}
                          onChange={e => updateBeat(i, { name: e.target.value })}
                        />
                        {b.en && <span className="beat-en">{b.en}</span>}
                        <div className="beat-row-tools">
                          <button className="beat-icon-btn" title="上移" disabled={i === 0} onClick={() => moveBeat(i, -1)}><ArrowUp size={13} /></button>
                          <button className="beat-icon-btn" title="下移" disabled={i === beats.length - 1} onClick={() => moveBeat(i, 1)}><ArrowDown size={13} /></button>
                          <button className="beat-icon-btn danger" title="删除" onClick={() => removeBeat(i)}><Trash2 size={13} /></button>
                        </div>
                      </div>

                      <div className="beat-fields">
                        <label className="beat-field full">
                          <span className="beat-field-label">这一拍发生了什么（summary）</span>
                          <textarea className="beat-textarea" rows={2} value={b.summary || ''} placeholder="用一句话写清可见的行为与结果" onChange={e => updateBeat(i, { summary: e.target.value })} />
                        </label>
                        <label className="beat-field">
                          <span className="beat-field-label"><Link2 size={11} /> 关联场次（scene）</span>
                          <input className="beat-input" value={b.scene || ''} placeholder="场次标题，如 INT. 公寓 - 夜" onChange={e => updateBeat(i, { scene: e.target.value })} />
                        </label>
                        <div className="beat-field">
                          <span className="beat-field-label">戏剧强度（tension）</span>
                          <div className="beat-tension-row">
                            <input
                              className="beat-range" type="range" min={1} max={5} step={1}
                              value={Number(b.tension) || 1}
                              onChange={e => updateBeat(i, { tension: Number(e.target.value) })}
                            />
                            <span className="beat-tension-num">{Number(b.tension) || 1} / 5</span>
                          </div>
                          <div className="beat-bar" title={`强度 ${Number(b.tension) || 1} / 5`}>
                            {TENSION_LEVELS.map(lv => <span key={lv} className={`beat-bar-seg${lv <= (Number(b.tension) || 1) ? ' on' : ''}`} />)}
                          </div>
                        </div>
                      </div>

                      <button className="beat-refine" onClick={() => askForDetail(String(b.name || '').trim() || `第 ${i + 1} 拍`)}>
                        <WandSparkles size={12} /> 让 AI 细化这一拍
                      </button>
                    </div>
                  </React.Fragment>
                ))}
                {/* 末尾插入点 */}
                <div className="beat-insert">
                  <button className="beat-insert-btn" title="在末尾新增节拍" onClick={() => insertBeat(beats.length)}><Plus size={11} /></button>
                </div>
                <button className="beat-btn ghost sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => insertBeat(beats.length)}><Plus size={13} /> 新增节拍</button>
              </div>
            )}
          </div>
        </div>

        {/* 右栏：大纲对照 + 提示 */}
        <div>
          <div className="beat-side-card">
            <h3 className="beat-section-title"><Link2 size={15} className="beat-stitle-icon" /> 大纲对照<span className="beat-count">只读 · {outline.length} 条</span></h3>
            {outline.length === 0 ? (
              <div className="beat-curve-empty">大纲还是空的。先到「大纲」tab 写几条，再回来对齐节拍的因果关系。</div>
            ) : (
              <div className="beat-outline-list">
                {outline.map((o, i) => {
                  const text = typeof o === 'string' ? o : (o?.text || '');
                  return (
                    <div className="beat-outline-item" key={o?.id ?? i}>
                      <span className="beat-outline-num">{String(i + 1).padStart(2, '0')}</span>
                      <span className="beat-outline-text">{text || '（空条目）'}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="beat-hint"><Info size={13} className="beat-hint-icon" /><span>曲线过平，通常是某一拍缺少状态变化；先对照大纲检查催化剂与转折的因果。</span></div>
          </div>

          <div className="beat-side-card">
            <h3 className="beat-section-title"><Lightbulb size={15} className="beat-stitle-icon" /> 使用提示</h3>
            <div className="beat-hint" style={{ marginTop: 0 }}><Sparkles size={13} className="beat-hint-icon" /><span>顶部按钮让 AI 给节拍建议；每拍右侧的细化按钮会带入该拍问题，均不改剧本。</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 强度曲线：按 tension 画折线 + 面积，节点可点击定位到对应节拍
// ---------------------------------------------------------------------------
function StrengthCurve({ beats, activeId, onPick }) {
  const W = 620, H = 150;
  const padL = 32, padR = 14, padT = 12, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = beats.length;
  const x = i => (n === 1 ? padL + plotW / 2 : padL + (i * plotW) / (n - 1));
  const y = t => padT + plotH - ((Math.min(5, Math.max(1, Number(t) || 1)) - 1) / 4) * plotH;

  const points = beats.map((b, i) => ({ x: x(i), y: y(b.tension), b, i }));
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const areaPath = points.length
    ? `M ${points[0].x} ${padT + plotH} L ${points.map(p => `${p.x} ${p.y}`).join(' L ')} L ${points[points.length - 1].x} ${padT + plotH} Z`
    : '';

  return (
    <div className="beat-curve-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="beat-curve" role="img" aria-label="节拍强度曲线">
        {/* 纵轴 1-5 网格与刻度 */}
        {TENSION_LEVELS.map(lv => (
          <g key={lv}>
            <line className="beat-curve-grid" x1={padL} y1={y(lv)} x2={W - padR} y2={y(lv)} />
            <text className="beat-curve-label" x={padL - 8} y={y(lv) + 3} textAnchor="end">{lv}</text>
          </g>
        ))}
        {/* 面积与折线 */}
        {areaPath && <path className="beat-curve-area" d={areaPath} />}
        {polyline && <polyline className="beat-curve-line" points={polyline} />}
        {/* 节点与横轴序号 */}
        {points.map(p => (
          <g key={p.b.id}>
            <circle
              className={`beat-curve-dot${activeId === p.b.id ? ' active' : ''}`}
              cx={p.x} cy={p.y} r={5}
              onClick={() => onPick(p.b.id)}
            >
              <title>{`${String(p.b.name || '').trim() || `第 ${p.i + 1} 拍`} · 强度 ${Number(p.b.tension) || 1}/5`}</title>
            </circle>
            <text className="beat-curve-xlabel" x={p.x} y={H - 8} textAnchor="middle">{p.i + 1}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
