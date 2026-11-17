import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Coins, Hash, Activity, Trash2, RefreshCw, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { api } from '../api.js';

const num = (v) => Number(v || 0).toLocaleString('zh-CN');
const money = (v) => `¥${Number(v || 0).toFixed(4)}`;

function shortDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function dayLabel(date) {
  const s = String(date || '');
  const parts = s.split('-');
  return parts.length >= 3 ? `${parts[1]}-${parts[2]}` : s;
}

export default function Usage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const load = () => {
    setLoading(true);
    api.usage.get(30)
      .then(d => { setData(d); setError(''); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function clearRecords() {
    if (!confirm('确定清除全部用量记录？此操作不可恢复。')) return;
    setClearing(true);
    try {
      await api.usage.clear();
      await api.usage.get(30).then(setData);
    } catch (e) { setError(e.message); }
    finally { setClearing(false); }
  }

  const total = data?.total || {};
  const daily = data?.daily || [];
  const byModel = data?.byModel || [];
  const recent = data?.recent || [];
  const maxTokens = useMemo(() => Math.max(1, ...daily.map(d => Number(d.totalTokens) || 0)), [daily]);
  const hasData = (Number(total.calls) || 0) > 0 || daily.length > 0 || recent.length > 0;

  if (loading && !data) return <main className="container page"><div className="loading"><BarChart3 size={20} /> 加载用量数据…</div></main>;

  return (
    <main className="container page usage-page">
      <div className="page-head">
        <div>
          <h1>用量与计费</h1>
          <p className="muted">本地估算，实际费用以阿里云账单为准。价格可在「设置」中修改。</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={load}><RefreshCw size={15} /> 刷新</button>
          <button className="btn btn-ghost danger-outline" onClick={clearRecords} disabled={clearing || !hasData}>
            <Trash2 size={15} /> {clearing ? '清除中…' : '清除记录'}
          </button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      {!hasData ? (
        <div className="empty">
          <div className="empty-icon"><BarChart3 size={28} /></div>
          <h3>还没有用量记录</h3>
          <p>调用一次 AI 助手或生成任务后，用量与估算费用会显示在这里。</p>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label"><Activity size={15} /> 总调用次数</div>
              <div className="stat-value">{num(total.calls)}</div>
              <div className="stat-sub">次请求</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Hash size={15} /> 总 Token</div>
              <div className="stat-value">{num(total.totalTokens)}</div>
              <div className="stat-sub">输入 {num(total.promptTokens)} · 输出 {num(total.completionTokens)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Coins size={15} /> 估算费用</div>
              <div className="stat-value accent">{money(total.cost)}</div>
              <div className="stat-sub">按本地单价估算</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><ArrowUpRight size={15} /> 输入 / 输出对比</div>
              <div className="ratio-bars">
                <div className="ratio-row"><span>输入</span><div className="ratio-track"><i className="ratio-in" style={{ width: `${ratioPct(total.promptTokens, total.completionTokens)}%` }} /></div><b>{num(total.promptTokens)}</b></div>
                <div className="ratio-row"><span>输出</span><div className="ratio-track"><i className="ratio-out" style={{ width: `${ratioPct(total.completionTokens, total.promptTokens)}%` }} /></div><b>{num(total.completionTokens)}</b></div>
              </div>
            </div>
          </div>

          <section className="card usage-section">
            <div className="card-head"><BarChart3 size={18} /><div><h3>近 30 天 Token 用量</h3><p>每日 Token 总量，鼠标悬停查看调用次数与费用。</p></div></div>
            {daily.length === 0 ? <div className="empty small">暂无按日统计。</div> : (
              <div className="chart-wrap">
                <div className="chart-bars">
                  {daily.map((d, i) => {
                    const h = Math.max(3, Math.round((Number(d.totalTokens) || 0) / maxTokens * 100));
                    return (
                      <div className="bar-col" key={i} title={`${d.date} · ${num(d.totalTokens)} tokens · ${num(d.calls)} 次 · ${money(d.cost)}`}>
                        <div className="bar" style={{ height: `${h}%` }} />
                        <span className="bar-label">{dayLabel(d.date)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="card usage-section">
            <div className="card-head"><Coins size={18} /><div><h3>按模型明细</h3><p>各模型的调用次数、Token 与估算费用。</p></div></div>
            {byModel.length === 0 ? <div className="empty small">暂无模型明细。</div> : (
              <div className="table-wrap"><table className="data-table">
                <thead><tr><th>模型</th><th>调用次数</th><th>Token</th><th>估算费用</th></tr></thead>
                <tbody>
                  {byModel.map((m, i) => <tr key={i}>
                    <td><code>{m.model || '—'}</code></td>
                    <td>{num(m.calls)}</td>
                    <td>{num(m.totalTokens)}</td>
                    <td className="accent">{money(m.cost)}</td>
                  </tr>)}
                </tbody>
              </table></div>
            )}
          </section>

          <section className="card usage-section">
            <div className="card-head"><ArrowDownRight size={18} /><div><h3>最近调用</h3><p>最近的请求明细，包含推理 Token 与费用。</p></div></div>
            {recent.length === 0 ? <div className="empty small">暂无调用明细。</div> : (
              <div className="table-wrap"><table className="data-table recent-table">
                <thead><tr><th>时间</th><th>类型</th><th>模型</th><th>模式</th><th>范围</th><th>输入</th><th>输出</th><th>费用</th></tr></thead>
                <tbody>
                  {recent.map((r, i) => <tr key={r.id || i}>
                    <td className="nowrap">{shortDate(r.ts)}</td>
                    <td><span className="tag mini">{r.type || '—'}</span></td>
                    <td><code>{r.model || '—'}</code></td>
                    <td>{r.mode || '—'}</td>
                    <td>{r.scope || '—'}</td>
                    <td>{num(r.promptTokens)}</td>
                    <td>{num(r.completionTokens)}</td>
                    <td className="accent">{money(r.cost)}</td>
                  </tr>)}
                </tbody>
              </table></div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function ratioPct(a, b) {
  const x = Number(a) || 0, y = Number(b) || 0;
  const sum = x + y;
  return sum ? Math.round(x / sum * 100) : 0;
}
