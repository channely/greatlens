import React, { useEffect, useState, useMemo } from 'react';
import {
  Plus, Trash2, Search, BookOpen, Network, MapPin, Package,
  AlertTriangle, RefreshCw, Users, Clapperboard, FileText, Loader2,
} from 'lucide-react';
import { api } from '../api.js';
import LocationCanvas from '../components/LocationCanvas.jsx';

const uid = () => `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// ---------------------------------------------------------------------------
// 选角表：项目级角色的制作视图，与剧本/关系图共享同一身份
// ---------------------------------------------------------------------------
export function CastingView({ project, mutate, derived }) {
  const chars = project.characters || [];
  const cueMap = useMemo(() => new Map((derived?.characters || []).map(c => [c.name.toUpperCase(), c])), [derived]);
  return (
    <div className="simple-view">
      <div className="view-head">
        <div><h2>选角表</h2><p className="muted">全项目一份名单，与剧本角色提示共用身份。改名会影响所有剧集，改前先命名版本。</p></div>
        <button className="btn btn-primary sm" onClick={() => mutate((_, p) => p.characters.push({ id: uid(), name: '', actor: '', age: '', gender: '', look: '', voice: '', arc: '', notes: '' }))}>
          <Plus size={14} /> 新增角色
        </button>
      </div>
      {chars.length === 0 ? <div className="empty small">还没有角色。先写剧本里的角色提示，或在角色档案里新增。</div> : (
        <div className="table-wrap">
          <table className="data-table casting-table">
            <thead><tr><th>角色</th><th>演员</th><th>年龄</th><th>性别</th><th>外形 / 造型</th><th>声音</th><th>戏份（场/集）</th><th>备注</th><th></th></tr></thead>
            <tbody>
              {chars.map((c, i) => {
                const d = cueMap.get(String(c.name || '').toUpperCase());
                return <tr key={c.id}>
                  <td><input value={c.name} placeholder="角色名" onChange={e => mutate((_, p) => { p.characters[i].name = e.target.value; })} /></td>
                  <td><input value={c.actor || ''} placeholder="候选演员" onChange={e => mutate((_, p) => { p.characters[i].actor = e.target.value; })} /></td>
                  <td><input value={c.age || ''} onChange={e => mutate((_, p) => { p.characters[i].age = e.target.value; })} /></td>
                  <td><select value={c.gender || ''} onChange={e => mutate((_, p) => { p.characters[i].gender = e.target.value; })}><option value="">—</option><option>男</option><option>女</option><option>其他</option></select></td>
                  <td><textarea rows={1} value={c.look || ''} onChange={e => mutate((_, p) => { p.characters[i].look = e.target.value; })} /></td>
                  <td><textarea rows={1} value={c.voice || ''} onChange={e => mutate((_, p) => { p.characters[i].voice = e.target.value; })} /></td>
                  <td className="muted">{d ? `${d.scenes.length} 场 / ${d.episodes.length} 集` : '—'}</td>
                  <td><textarea rows={1} value={c.notes || ''} onChange={e => mutate((_, p) => { p.characters[i].notes = e.target.value; })} /></td>
                  <td><button className="icon-btn danger" title="删除" onClick={() => mutate((_, p) => p.characters.splice(i, 1))}><Trash2 size={13} /></button></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="callout"><Users size={14} /> 角色是项目级身份。生成的人物图只是参考，不代表选角或授权已落实。</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 关系图谱：SVG 网络 + 结构性弱点提示（对齐 laper.ai 的 network 视图）
// ---------------------------------------------------------------------------
export function RelationshipsView({ project, mutate }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const chars = project.characters || [];
  const rels = project.relationships || [];

  const load = () => {
    setLoading(true);
    api.projects.relationships(project.id)
      .then(setAnalysis).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id, rels.length, chars.length]);

  const nodes = analysis?.nodes?.length ? analysis.nodes : chars.map(c => ({ id: c.id, name: c.name, degree: 0, cues: 0 }));
  // 用实时 rels 作为边来源，保证改名/改label立即反映；testedOnScreen 等派生标记来自服务端分析。
  const testMap = new Map((analysis?.edges || []).map(e => [e.id, e.testedOnScreen]));
  const edges = rels.map(r => ({ ...r, testedOnScreen: testMap.has(r.id) ? testMap.get(r.id) : r.testedOnScreen }));

  const graph = useMemo(() => {
    const N = nodes.length;
    return nodes.map((n, i) => {
      const angle = (Math.PI * 2 * i) / Math.max(N, 1) - Math.PI / 2;
      return { ...n, x: 300 + 220 * Math.cos(angle), y: 200 + 150 * Math.sin(angle) };
    });
  }, [nodes]);
  const posOf = id => graph.find(g => g.id === id);

  return (
    <div className="simple-view">
      <div className="view-head">
        <div><h2>关系图谱</h2><p className="muted">关系描述压力，不替代把它演出来的场次。绿色=剧中已同场，橙色=数据声明但从未被检验。</p></div>
        <button className="btn btn-ghost sm" onClick={load}><RefreshCw size={13} /> 重新分析</button>
      </div>
      {chars.length < 2 ? <div className="empty small">至少需要两个角色。先到「选角表」新增角色。</div> : (
        <div className="graph-layout">
          <div className="graph-canvas">
            <svg viewBox="0 0 600 400" className="rel-graph" role="img" aria-label="角色关系网络">
              {edges.map((e, i) => {
                const a = posOf(e.from), b = posOf(e.to);
                if (!a || !b) return null;
                return <g key={e.id || i}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.testedOnScreen ? 'var(--sage)' : '#d99b3c'} strokeWidth={e.testedOnScreen ? 2 : 1.5} strokeDasharray={e.testedOnScreen ? '' : '5 4'} />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 5} className="edge-label">{e.label || '关系'}</text>
                </g>;
              })}
              {graph.map(n => <g key={n.id}>
                <circle cx={n.x} cy={n.y} r={Math.max(20, 16 + (n.degree || 0) * 4)} fill="var(--primary)" opacity={n.inScript === false ? 0.4 : 0.92} />
                <text x={n.x} y={n.y + 4} className="node-label">{n.name}</text>
              </g>)}
            </svg>
            {loading && <div className="graph-loading"><Loader2 className="spin" size={16} /> 分析中…</div>}
          </div>
          <div className="graph-side">
            <div className="side-card">
              <h3>连接关系</h3>
              {rels.length === 0 && <p className="muted">还没有关系。添加一条，让网络告诉你结构问题。</p>}
              {rels.map((r, i) => <div className="rel-row" key={r.id}>
                <select value={r.from} onChange={e => mutate((_, p) => { p.relationships[i].from = e.target.value; })}>
                  {chars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input value={r.label || ''} placeholder="关系（写出压力）" onChange={e => mutate((_, p) => { p.relationships[i].label = e.target.value; })} />
                <select value={r.to} onChange={e => mutate((_, p) => { p.relationships[i].to = e.target.value; })}>
                  {chars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="icon-btn danger" onClick={() => mutate((_, p) => p.relationships.splice(i, 1))}><Trash2 size={13} /></button>
              </div>)}
              <button className="btn btn-ghost sm" disabled={chars.length < 2} onClick={() => mutate((_, p) => p.relationships.push({ id: uid(), from: chars[0]?.id, to: chars[1]?.id, label: '' }))}><Plus size={13} /> 添加关系</button>
            </div>
            {analysis?.warnings?.length > 0 && <div className="side-card warn-card">
              <h3><AlertTriangle size={14} /> 结构弱点（{analysis.warnings.length}）</h3>
              {analysis.warnings.slice(0, 8).map((w, i) => <p key={i} className="warn-line">· {w.text}</p>)}
            </div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 地点 / 勘景 + 道具：从剧本派生 + 制作信息补充 + 连续性审计
// ---------------------------------------------------------------------------
export function LocationsPropsView({ project, mutate, derived }) {
  const [audit, setAudit] = useState(null);
  const [locView, setLocView] = useState('table'); // table | canvas
  const locations = project.locations || [];
  const props = project.props || [];
  const derivedLocs = derived?.locations || [];

  const load = () => api.projects.continuity(project.id).then(setAudit).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id, locations.length, props.length]);

  return (
    <div className="simple-view">
      <div className="view-head"><div><h2>地点与道具</h2><p className="muted">地点由场景标题派生，道具是项目级实体。下面会提示剧本与制作表之间的不一致。</p></div></div>

      <div className="section-block">
        <div className="section-head"><h3><MapPin size={15} /> 地点 / 勘景</h3>
          <div className="loc-view-switch">
            <button className={locView === 'table' ? 'active' : ''} onClick={() => setLocView('table')}>表格</button>
            <button className={locView === 'canvas' ? 'active' : ''} onClick={() => setLocView('canvas')}>画布 / 分组</button>
          </div>
        </div>
        {derivedLocs.length > 0 && <div className="derived-hint"><span>剧本派生：</span>{derivedLocs.map((l, i) => <span className="tag mini" key={i}>{l.name}（{l.scenes.length} 场）</span>)}</div>}
        {locView === 'canvas' ? <LocationCanvas project={project} mutate={mutate} derived={derived} /> : <div className="table-wrap"><table className="data-table">
          <thead><tr><th>故事地点</th><th>实拍地点 / 棚</th><th>可达性</th><th>时间</th><th>天气</th><th>光线</th><th>声音</th><th>备注</th><th></th></tr></thead>
          <tbody>{locations.map((l, i) => <tr key={l.id}>
            <td><input value={l.name} placeholder="地点名" onChange={e => mutate((_, p) => { p.locations[i].name = e.target.value; })} /></td>
            <td><input value={l.shooting || ''} onChange={e => mutate((_, p) => { p.locations[i].shooting = e.target.value; })} /></td>
            <td><input value={l.access || ''} onChange={e => mutate((_, p) => { p.locations[i].access = e.target.value; })} /></td>
            <td><input value={l.time || ''} onChange={e => mutate((_, p) => { p.locations[i].time = e.target.value; })} /></td>
            <td><input value={l.weather || ''} onChange={e => mutate((_, p) => { p.locations[i].weather = e.target.value; })} /></td>
            <td><input value={l.light || ''} onChange={e => mutate((_, p) => { p.locations[i].light = e.target.value; })} /></td>
            <td><input value={l.sound || ''} onChange={e => mutate((_, p) => { p.locations[i].sound = e.target.value; })} /></td>
            <td><textarea rows={1} value={l.notes || ''} onChange={e => mutate((_, p) => { p.locations[i].notes = e.target.value; })} /></td>
            <td><button className="icon-btn danger" onClick={() => mutate((_, p) => p.locations.splice(i, 1))}><Trash2 size={13} /></button></td>
          </tr>)}</tbody>
        </table></div>}
      </div>

      <div className="section-block">
        <div className="section-head"><h3><Package size={15} /> 道具与服装相关物件</h3>
          <button className="btn btn-ghost sm" onClick={() => mutate((_, p) => p.props.push({ id: uid(), name: '', purpose: '', introduced: '', carrier: '', states: '', continuity: '', constraint: '' }))}><Plus size={13} /> 添加道具</button>
        </div>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>物件</th><th>戏剧作用</th><th>首次出现</th><th>持有人</th><th>可见状态</th><th>连续性要求</th><th>制作约束</th><th></th></tr></thead>
          <tbody>{props.map((p0, i) => <tr key={p0.id}>
            <td><input value={p0.name} placeholder="道具名" onChange={e => mutate((_, p) => { p.props[i].name = e.target.value; })} /></td>
            <td><textarea rows={1} value={p0.purpose || ''} onChange={e => mutate((_, p) => { p.props[i].purpose = e.target.value; })} /></td>
            <td><input value={p0.introduced || ''} onChange={e => mutate((_, p) => { p.props[i].introduced = e.target.value; })} /></td>
            <td><input value={p0.carrier || ''} onChange={e => mutate((_, p) => { p.props[i].carrier = e.target.value; })} /></td>
            <td><textarea rows={1} value={p0.states || ''} onChange={e => mutate((_, p) => { p.props[i].states = e.target.value; })} /></td>
            <td><textarea rows={1} value={p0.continuity || ''} onChange={e => mutate((_, p) => { p.props[i].continuity = e.target.value; })} /></td>
            <td><textarea rows={1} value={p0.constraint || ''} onChange={e => mutate((_, p) => { p.props[i].constraint = e.target.value; })} /></td>
            <td><button className="icon-btn danger" onClick={() => mutate((_, p) => p.props.splice(i, 1))}><Trash2 size={13} /></button></td>
          </tr>)}</tbody>
        </table></div>
      </div>

      <div className="section-block">
        <div className="section-head"><h3><AlertTriangle size={15} /> 连续性审计</h3>
          <button className="btn btn-ghost sm" onClick={load}><RefreshCw size={13} /> 重新审计</button>
        </div>
        {!audit ? <p className="muted">审计中…</p> : audit.issues.length === 0
          ? <div className="callout ok">未发现明显的不一致（已检查 {audit.checked.props} 个道具、{audit.checked.locations} 个地点、{audit.checked.characters} 个角色）。</div>
          : <div className="audit-list">{audit.issues.map((it, i) => <div className="audit-row" key={i}><span className={`audit-kind ${it.kind}`}>{it.kind === 'prop' ? '道具' : it.kind === 'location' ? '地点' : '角色'}</span><span>{it.text}</span></div>)}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Knowledge：先索引、再检索、按需读正文（AI 只拿到索引，不整库塞入）
// ---------------------------------------------------------------------------
export function KnowledgeView({ project, mutate }) {
  const [index, setIndex] = useState([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [body, setBody] = useState('');
  const items = project.knowledge || [];

  const load = () => api.projects.knowledgeIndex(project.id).then(setIndex).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [project.id, items.length]);

  const search = () => {
    if (!q.trim()) { setResults(null); return; }
    api.projects.knowledgeSearch(project.id, q).then(setResults).catch(() => {});
  };
  const open = (id) => { setOpenId(id); api.projects.knowledgeRead(project.id, id).then(k => setBody(k.body || '')).catch(() => {}); };

  return (
    <div className="simple-view">
      <div className="view-head">
        <div><h2>知识库</h2><p className="muted">资料是证据，不是复制指令。助手先看到索引，需要时再检索读取正文——不会把整库塞进每次对话。</p></div>
        <button className="btn btn-primary sm" onClick={() => mutate((_, p) => p.knowledge.push({ id: uid(), name: '新资料', type: 'reference', summary: '', tags: [], body: '' }))}><Plus size={14} /> 添加资料</button>
      </div>
      <div className="knowledge-search">
        <input value={q} placeholder="检索资料名 / 摘要 / 正文关键词…" onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search(); }} />
        <button className="btn btn-ghost sm" onClick={search}><Search size={13} /> 检索预览</button>
      </div>
      {results && <div className="knowledge-results"><strong>命中 {results.length} 份（预览）</strong>{results.map(r => <div key={r.id} className="ksearch-row"><code>{r.name}</code><span>{r.summary}</span>{r.body && <em>{r.body.slice(0, 80)}…</em>}</div>)}</div>}
      <div className="knowledge-grid">
        {items.map((k, i) => <div className="know-card" key={k.id}>
          <div className="know-head">
            <input value={k.name} onChange={e => mutate((_, p) => { p.knowledge[i].name = e.target.value; })} />
            <button className="icon-btn danger" onClick={() => mutate((_, p) => p.knowledge.splice(i, 1))}><Trash2 size={13} /></button>
          </div>
          <div className="know-meta">
            <select value={k.type || 'reference'} onChange={e => mutate((_, p) => { p.knowledge[i].type = e.target.value; })}>
              <option value="reference">参考资料</option><option value="research">研究</option><option value="voice">声音样本</option><option value="legal">法律/安全</option>
            </select>
            <span className="muted">{k.body?.length || 0} 字</span>
          </div>
          <textarea rows={2} value={k.summary || ''} placeholder="一句话摘要（进索引）" onChange={e => mutate((_, p) => { p.knowledge[i].summary = e.target.value; })} />
          <input value={(k.tags || []).join('、')} placeholder="标签，用、分隔" onChange={e => mutate((_, p) => { p.knowledge[i].tags = e.target.value.split(/[、,，]/).map(s => s.trim()).filter(Boolean); })} />
          <button className="btn btn-ghost sm" onClick={() => open(k.id)}><BookOpen size={13} /> {openId === k.id ? '收起正文' : '查看 / 编辑正文'}</button>
          {openId === k.id && <textarea className="know-body" rows={8} value={body} placeholder="资料正文…" onChange={e => setBody(e.target.value)} onBlur={() => mutate((_, p) => { p.knowledge[i].body = body; })} />}
        </div>)}
        {items.length === 0 && <div className="empty small">还没有资料。研究结果、设定参考、声音样本都可以放这里。</div>}
      </div>
      <div className="callout"><FileText size={14} /> 世界观(Worldview)是少量确定的规则；长资料放这里。助手不能把资料悄悄提升为设定。</div>
    </div>
  );
}
