import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  Clapperboard, Home as HomeIcon, FolderOpen, Settings as SettingsIcon,
  BarChart3, Images, FolderSync as CloudSync, Play, Github, BookOpen,
  MessageCircle, CircleHelp, Sun, Moon,
} from 'lucide-react';
import { currentBackendBase } from './api.js';
import { useTheme } from './theme.js';
import Home from './pages/Home.jsx';
import Projects from './pages/Projects.jsx';
import Editor from './pages/Editor.jsx';
import Cinema from './pages/Cinema.jsx';
import Settings from './pages/Settings.jsx';
import Usage from './pages/Usage.jsx';
import Assets from './pages/Assets.jsx';
import Sync from './pages/Sync.jsx';

// 侧栏按工作动线分组；首页与全部装饰入口保留，形态不变。
const NAV_GROUPS = [
  { label: '工作台', links: [
    { to: '/', label: '首页', icon: HomeIcon },
    { to: '/projects', label: '项目', icon: FolderOpen },
    { to: '/assets', label: '素材', icon: Images },
  ] },
  { label: '运营', links: [
    { to: '/usage', label: '用量', icon: BarChart3 },
    { to: '/sync', label: '同步', icon: CloudSync },
  ] },
  { label: '系统', links: [
    { to: '/settings', label: '设置', icon: SettingsIcon },
  ] },
];

function backendLabel() {
  const base = currentBackendBase();
  if (!base || base === '/api') return '本机运行';
  try { return new URL(base).hostname; } catch { return '远程后端'; }
}

function Shell() {
  const { pathname } = useLocation();
  const source = backendLabel();
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="side-brand">
          <span className="side-brand-mark"><Clapperboard size={18} /></span>
          <span>GreatLens</span>
        </Link>

        <nav className="side-nav">
          {NAV_GROUPS.map((g, gi) => (
            <React.Fragment key={g.label}>
              {gi > 0 && <span className="side-group-divider" aria-hidden="true" />}
              <span className="side-group-label">{g.label}</span>
              {g.links.map(({ to, label, icon: Icon }) => (
                <Link key={to} to={to} className={pathname === to || (to !== '/' && pathname.startsWith(to)) ? 'active' : ''}>
                  <Icon size={16} /> {label}
                </Link>
              ))}
            </React.Fragment>
          ))}
        </nav>

        <div className="side-foot">
          <div className="side-foot-section">
            <div className="side-video" title="创作灵感">
              <span className="play"><Play size={15} fill="currentColor" /></span>
              <span>灵感片段 · 00:15</span>
            </div>
            <div className="side-backend" title={currentBackendBase()}><span className="status-dot" /> 后端：{source}</div>
          </div>
          <div className="side-foot-section side-foot-actions">
            <div className="side-lang">
              <button className="icon-btn theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}>
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
            </div>
            <Link to="/projects" className="btn btn-primary full side-login">Login</Link>
            <div className="side-icons">
              <a href="https://github.com/" target="_blank" rel="noreferrer" title="代码仓库"><Github size={15} /></a>
              <Link to="/settings" title="使用说明"><BookOpen size={15} /></Link>
              <Link to="/sync" title="协作反馈"><MessageCircle size={15} /></Link>
              <Link to="/settings" title="设置"><CircleHelp size={15} /></Link>
            </div>
          </div>
        </div>
      </aside>

      <div className="main-area">
        <div className="news-bar">
          <span className="news-tag">News</span>
          <span className="news-text">百炼 qwen4-max 已接入 · 图像 / 视频生成与用量看板上线 · 支持 FDX / Fountain 导入</span>
          <span className="news-right">{source} · 本地优先</span>
        </div>
        <div className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/edit/:id" element={<Editor />} />
            <Route path="/cinema/:id" element={<Cinema />} />
            <Route path="/usage" element={<Usage />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/sync" element={<Sync />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <Shell />;
}
