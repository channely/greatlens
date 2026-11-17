import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderSync as CloudSync, Link2, GitBranch, Save, ArrowUp, ArrowDown,
  RefreshCw, ShieldCheck, Server, AlertTriangle, Loader2, Settings2,
} from 'lucide-react';
import { api, currentBackendBase } from '../api.js';

export default function Sync() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ remote: '', token: '', device: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const backendBase = currentBackendBase();

  async function loadStatus() {
    try {
      const s = await api.sync.status();
      setStatus(s);
      setForm(f => ({ ...f, remote: f.remote || s.remote || '', device: f.device || s.device || '' }));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { loadStatus(); }, []);

  async function saveConfig() {
    setBusy('save'); setError(''); setMessage('');
    try {
      const payload = { remote: form.remote.trim(), device: form.device.trim() };
      if (form.token) payload.token = form.token; // 留空表示沿用已保存的 token
      await api.sync.config(payload);
      setForm(f => ({ ...f, token: '' }));
      setMessage('✓ 同步配置已保存。');
      await loadStatus();
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function push() {
    if (!confirm('推送将用本机快照覆盖远端同名文件，确定继续？')) return;
    setBusy('push'); setError(''); setMessage('');
    try { const r = await api.sync.push(); setMessage(`✓ 推送成功：${r.message || r.hash || '完成'}`); await loadStatus(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  async function pull() {
    if (!confirm('拉取会先在本地做备份，再应用远端快照，确定继续？')) return;
    setBusy('pull'); setError(''); setMessage('');
    try { const r = await api.sync.pull(); setMessage(`✓ 拉取成功：${r.message || (r.applied ? '已应用远端更改' : '已是最新')}`); await loadStatus(); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  const backendLabel = backendBase === '/api' ? '本机（/api）' : backendBase;
  const remoteBaseLabel = (() => {
    try { return new URL(backendBase).hostname; } catch { return '本机'; }
  })();

  return (
    <main className="container page sync-page">
      <div className="page-head">
        <div>
          <h1>异地协作</h1>
          <p className="muted">让公司电脑和家里电脑接着同一份创作往下写。</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <div className="mode-intro">
        <div className="mode-card recommended">
          <div className="mode-head"><span className="mode-badge">模式 A · 推荐</span><Server size={18} /></div>
          <h3>共享同一个后端</h3>
          <p>两台电脑连到同一个常开的后端，数据实时共享，无需手动同步。例如把本地服务通过内网穿透暴露成一个固定地址。</p>
          <div className="mode-current"><span>当前后端</span><code>{backendLabel}</code></div>
          <Link className="btn btn-ghost" to="/settings"><Settings2 size={15} /> 去设置远程地址</Link>
        </div>
        <div className="mode-card">
          <div className="mode-head"><span className="mode-badge">模式 B</span><GitBranch size={18} /></div>
          <h3>Git 中转同步</h3>
          <p>两台电脑各跑本地服务，用同一个 Git 仓库做中转，手动推送 / 拉取快照。适合没有常开公网地址的场景。</p>
          <div className="mode-current"><span>中转节点</span><code>{status?.remote || '未配置'}</code></div>
          <a className="btn btn-ghost" href="#sync-config" onClick={e => { e.preventDefault(); document.getElementById('sync-config')?.scrollIntoView({ behavior: 'smooth' }); }}>
            <Link2 size={15} /> 配置 Git 中转
          </a>
        </div>
      </div>

      <div id="sync-config" className="sync-layout">
        <section className="card">
          <div className="card-head"><GitBranch size={18} /><div><h3>Git 中转配置</h3><p>推送会覆盖远端同名快照，拉取会先本地备份。</p></div></div>
          <div className="form-stack">
            <label>Git 仓库地址（HTTPS）
              <input value={form.remote} onChange={e => setForm({ ...form, remote: e.target.value })} placeholder="https://github.com/you/greatlens-sync.git" />
            </label>
            <label>访问 Token（密码）
              <input type="password" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} placeholder={status?.configured ? '已配置（留空保持不变）' : '用于推送的仓库令牌'} />
            </label>
            <label>设备名
              <input value={form.device} onChange={e => setForm({ ...form, device: e.target.value })} placeholder="例如：公司Mac / 家里Mac" />
            </label>
            <button className="btn btn-primary" onClick={saveConfig} disabled={busy === 'save'}>
              {busy === 'save' ? <><Loader2 className="spin" size={15} /> 保存中…</> : <><Save size={15} /> 保存配置</>}
            </button>
          </div>
        </section>

        <section className="card sync-status">
          <div className="card-head"><CloudSync size={18} /><div><h3>同步状态</h3><p>当前设备与最近一次同步情况。</p></div></div>
          {!status ? <div className="loading"><Loader2 className="spin" size={18} /> 读取状态…</div> : (
            <>
              <div className={`sync-badge ${status.configured ? 'ok' : ''}`}>
                {status.configured ? '已配置' : '未配置'}
              </div>
              <div className="sync-kv">
                <div><span>设备</span><strong>{status.device || '—'}</strong></div>
                <div><span>远端</span><code>{status.remote || '—'}</code></div>
                <div><span>最近同步</span><strong>{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('zh-CN') : '从未'}</strong></div>
                <div><span>本地更改</span><strong className={status.dirty ? 'warn' : ''}>{status.dirty ? '有未推送更改' : '无'}</strong></div>
              </div>
              {status.lastError && <div className="alert error sm">{status.lastError}</div>}
              <div className="commits">
                <div className="muted small">最近提交</div>
                {(status.commits || []).length === 0 ? <div className="muted small">暂无提交记录。</div> : (
                  <ul>
                    {status.commits.slice(0, 8).map((c, i) => <li key={i}>
                      <code>{String(c.hash || '').slice(0, 7)}</code>
                      <span>{c.message || '—'}</span>
                      <small className="muted">{c.date ? new Date(c.date).toLocaleDateString('zh-CN') : ''}</small>
                    </li>)}
                  </ul>
                )}
              </div>
              <div className="form-row sync-buttons">
                <button className="btn btn-primary" onClick={push} disabled={!status.configured || busy === 'push'}>
                  {busy === 'push' ? <><Loader2 className="spin" size={15} /> 推送中…</> : <><ArrowUp size={15} /> 推送本地更改</>}
                </button>
                <button className="btn btn-ghost" onClick={pull} disabled={!status.configured || busy === 'pull'}>
                  {busy === 'pull' ? <><Loader2 className="spin" size={15} /> 拉取中…</> : <><ArrowDown size={15} /> 拉取远端更改</>}
                </button>
                <button className="icon-btn" title="刷新状态" onClick={loadStatus}><RefreshCw size={15} /></button>
              </div>
            </>
          )}
        </section>
      </div>

      <div className="alert warning sync-note">
        <AlertTriangle size={16} />
        <div>
          <strong>关于同步内容</strong>
          <p>同步只搬运项目数据；API Key 与 Token 凭据只保存在各自电脑的本地设置中，不会进入同步内容。当前后端来源：<code>{remoteBaseLabel}</code>。</p>
        </div>
      </div>
    </main>
  );
}
