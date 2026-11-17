import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Sparkles, ArrowRight, FileText, BookOpen, Images,
  FolderOpen, BarChart3, FolderSync as CloudSync, Wand2, Github,
} from 'lucide-react';

const features = [
  {
    icon: FileText,
    label: 'Screenplay',
    title: '剧本创作',
    desc: '按语义节点写场景、对白与动作，AI 在你正在编辑的文稿里接着写，不产生第二份文档。',
    to: '/projects',
  },
  {
    icon: BookOpen,
    label: 'Novel',
    title: '故事与小说',
    desc: '先钉住人物与世界观，再铺陈章节。大纲、角色与剧本共享同一套项目实体。',
    to: '/projects',
  },
  {
    icon: Images,
    label: 'AI Visuals',
    title: '图像与视频',
    desc: '用百炼图像、视频模型把文字分镜变成可看的画面，生成记录自动进入素材库。',
    to: '/assets',
  },
];

export default function Home() {
  const [draft, setDraft] = useState('');
  const nav = useNavigate();

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="hero-eyebrow"><Sparkles size={13} /> GreatLens · 本地优先的短剧创作工作台</div>
          <h1>把一句话，<br /><em>写成一整部戏</em></h1>
          <p className="home-lead">
            从灵感、剧本到分镜与画面，一步接一步。语义节点、显式 AI 上下文、项目实体联动——创作权始终留在你手里。
          </p>

          <div className="prompt-card">
            <textarea
              className="prompt-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="写下你的故事起点：一个场景、一段对白，或一句想拍成画面的一句话…"
            />
            <div className="prompt-card-foot">
              <div className="prompt-chips">
                <Link to="/projects" className="prompt-chip"><FileText size={13} /> Screenplay</Link>
                <Link to="/projects" className="prompt-chip"><BookOpen size={13} /> Novel</Link>
                <Link to="/assets" className="prompt-chip"><Images size={13} /> AI Visuals</Link>
              </div>
              <button className="btn btn-primary" onClick={() => nav('/projects')}><Wand2 size={15} /> 开始创作 <ArrowRight size={15} /></button>
            </div>
          </div>

          <div className="home-shortcuts">
            <Link to="/projects"><FolderOpen size={13} /> 我的项目</Link>
            <Link to="/assets"><Images size={13} /> 素材工作台</Link>
            <Link to="/usage"><BarChart3 size={13} /> 用量看板</Link>
            <Link to="/sync"><CloudSync size={13} /> 异地协作</Link>
          </div>
        </div>
      </section>

      <section className="home-features">
        <div className="home-features-head">
          <span className="eyebrow">ONE PIPELINE</span>
          <h2>从文字到画面，一条链路打通</h2>
          <p>三块能力各管一段，数据互通，互不越界。</p>
        </div>
        <div className="home-feature-grid">
          {features.map(({ icon: Icon, label, title, desc, to }) => (
            <div className="home-feature-card" key={label}>
              <div className="home-feature-icon"><Icon size={20} /></div>
              <span className="muted small" style={{ letterSpacing: '2px', fontWeight: 700 }}>{label}</span>
              <h3>{title}</h3>
              <p>{desc}</p>
              <Link to={to} className="btn btn-ghost sm">进入工作台 <ArrowRight size={14} /></Link>
            </div>
          ))}
        </div>
      </section>

      <section className="home-note">
        <div className="home-note-card">
          <strong>创作留在本机</strong>
          <p>项目数据保存在本地，密钥只写本地设置文件。需要多台电脑协作时，可以连同一个后端，或用 Git 中转同步。</p>
          <Link to="/settings" className="btn btn-ghost sm">配置模型与服务</Link>
        </div>
      </section>

      <footer className="home-footer">
        <span>GreatLens · 自研实现 · 供个人学习与自用</span>
        <div className="home-footer-icons">
          <a href="https://github.com/" target="_blank" rel="noreferrer" title="代码仓库"><Github size={14} /></a>
          <Link to="/usage" title="用量"><BarChart3 size={14} /></Link>
          <Link to="/sync" title="同步"><CloudSync size={14} /></Link>
          <Link to="/settings" title="设置"><Sparkles size={14} /></Link>
        </div>
      </footer>
    </div>
  );
}
