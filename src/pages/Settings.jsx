import React, { useEffect, useRef, useState } from 'react';
import {
  Save, KeyRound, Check, Server, Cpu, ShieldCheck, ExternalLink,
  Coins, Image as ImageIcon, FolderSync as CloudSync, FlaskConical,
} from 'lucide-react';
import { api } from '../api.js';

const DEFAULTS = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen4-max',
  temperature: 0.8,
  enableThinking: true,
  priceInput: 10,
  priceOutput: 30,
  imageUnitPrice: 0.2,
  videoUnitPrice: 0.5,
  mediaBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  imageModel: 'qwen-image-3.0-pro',
  videoModel: 'wan2.7-t2v',
  remoteBase: '',
};

export default function Settings() {
  const [cfg, setCfg] = useState(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [error, setError] = useState('');
  const initialRef = useRef(null);

  useEffect(() => {
    api.settings.get()
      .then(s => {
        const next = { ...DEFAULTS, ...s };
        // 数字 / 布尔字段做一次兜底，避免后端缺省时控件异常。
        next.temperature = Number.isFinite(Number(next.temperature)) ? Number(next.temperature) : 0.8;
        next.priceInput = Number.isFinite(Number(next.priceInput)) ? Number(next.priceInput) : 10;
        next.priceOutput = Number.isFinite(Number(next.priceOutput)) ? Number(next.priceOutput) : 30;
        next.imageUnitPrice = Number.isFinite(Number(next.imageUnitPrice)) ? Number(next.imageUnitPrice) : 0.2;
        next.videoUnitPrice = Number.isFinite(Number(next.videoUnitPrice)) ? Number(next.videoUnitPrice) : 0.5;
        next.enableThinking = Boolean(next.enableThinking);
        next.remoteBase = next.remoteBase || '';
        initialRef.current = next;
        setCfg(next);
      })
      .catch(e => { setError(e.message); initialRef.current = { ...DEFAULTS }; });
  }, []);

  const set = (key, value) => setCfg(c => ({ ...c, [key]: value }));

  async function save() {
    try {
      const payload = { ...cfg };
      // 掩码值未改动时传 '***' 告诉后端保持不变，避免把掩码当新密钥写入。
      const init = initialRef.current;
      if (!init || payload.apiKey === init.apiKey) payload.apiKey = '***';
      if (!init || payload.syncToken === init.syncToken) payload.syncToken = '***';
      await api.settings.save(payload);
      // 远程后端根地址写入 localStorage，api.js 每次请求都会读取。
      localStorage.setItem('gl:remoteBase', (cfg.remoteBase || '').trim());
      initialRef.current = { ...cfg, apiKey: payload.apiKey === '***' ? init?.apiKey : cfg.apiKey };
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setTestResult('');
    } catch (e) { setError(e.message); }
  }

  async function test() {
    setTesting(true); setTestResult('');
    try {
      const r = await api.ai.complete({ prompt: '只回复两个字：可用', scope: 'test', context: '' });
      setTestResult(`✓ 连接成功：${String(r.text || '').slice(0, 60)}`);
    } catch (e) { setTestResult(`✗ ${e.message}`); }
    finally { setTesting(false); }
  }

  return (
    <main className="container page settings-page">
      <div className="page-head">
        <div>
          <h1>模型与计费</h1>
          <p className="muted">配置阿里百炼模型与本地估算单价。API Key 只保存在本机，前端只显示掩码。</p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="settings-grid">
        <section className="card">
          <div className="card-head"><KeyRound size={18} /><div><h3>百炼 LLM</h3><p>兼容 OpenAI 协议的百炼模型服务，由后端代理调用。</p></div></div>
          <div className="form-stack">
            <label>Base URL
              <input value={cfg.baseUrl || ''} onChange={e => set('baseUrl', e.target.value)} placeholder={DEFAULTS.baseUrl} />
            </label>
            <label>API Key
              <input type="password" value={cfg.apiKey || ''} onChange={e => set('apiKey', e.target.value)} placeholder={cfg.apiKey ? '已配置（留空保持不变）' : 'sk-...'} />
            </label>
            <label>模型
              <input list="gl-model-list" value={cfg.model || ''} onChange={e => set('model', e.target.value)} placeholder="qwen4-max" />
              <datalist id="gl-model-list">
                {['qwen4-max', 'qwen3-max', 'qwen-plus', 'qwen-flash'].map(m => <option key={m} value={m} />)}
              </datalist>
            </label>
            <label>Temperature <span className="muted small">{cfg.temperature}</span>
              <input type="range" min="0" max="2" step="0.1" value={cfg.temperature} onChange={e => set('temperature', Number(e.target.value))} />
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={cfg.enableThinking} onChange={e => set('enableThinking', e.target.checked)} />
              <span>显示思考过程<small className="muted small">开启后模型输出推理链，会消耗更多 token，计入用量与费用。</small></span>
            </label>
            <div className="form-row">
              <button className="btn btn-primary" onClick={save}>{saved ? <><Check size={15} /> 已保存</> : <><Save size={15} /> 保存配置</>}</button>
              <button className="btn btn-ghost" onClick={test} disabled={testing}><FlaskConical size={15} /> {testing ? '测试中…' : '测试连接'}</button>
            </div>
            {testResult && <div className={`alert ${testResult.startsWith('✓') ? 'success' : 'error'}`}>{testResult}</div>}
          </div>
        </section>

        <div className="settings-side">
          <section className="card">
            <div className="card-head"><Coins size={18} /><div><h3>计费单价</h3><p>每百万 token 的人民币价格。</p></div></div>
            <div className="form-stack">
              <label>输入单价（¥ / 百万 token）
                <input type="number" min="0" step="0.1" value={cfg.priceInput} onChange={e => set('priceInput', Number(e.target.value))} />
              </label>
              <label>输出单价（¥ / 百万 token）
                <input type="number" min="0" step="0.1" value={cfg.priceOutput} onChange={e => set('priceOutput', Number(e.target.value))} />
              </label>
              <label>图像生成（¥ / 张）
                <input type="number" min="0" step="0.01" value={cfg.imageUnitPrice} onChange={e => set('imageUnitPrice', Number(e.target.value))} />
              </label>
              <label>视频生成（¥ / 次）
                <input type="number" min="0" step="0.01" value={cfg.videoUnitPrice} onChange={e => set('videoUnitPrice', Number(e.target.value))} />
              </label>
              <p className="muted small">输入 / 输出单价为 qwen4-max 北京区参考值（思维链与回答均计入输出）。图像 / 视频按次估算。仅用于本地估算，实际以阿里云账单为准，可自行修改。</p>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><ImageIcon size={18} /><div><h3>图像与视频</h3><p>百炼 Wanx / Wan 系列多模态模型。</p></div></div>
            <div className="form-stack">
              <label>Media Base URL
                <input value={cfg.mediaBaseUrl || ''} onChange={e => set('mediaBaseUrl', e.target.value)} placeholder={DEFAULTS.mediaBaseUrl} />
              </label>
              <label>图像模型
                <input list="gl-image-model-list" value={cfg.imageModel || ''} onChange={e => set('imageModel', e.target.value)} placeholder="qwen-image-3.0-pro" />
                <datalist id="gl-image-model-list">
                  {['qwen-image-3.0-pro', 'qwen-image-2.1-turbo', 'wanx2.1-t2i-plus'].map(m => <option key={m} value={m} />)}
                </datalist>
              </label>
              <label>视频模型
                <input list="gl-video-model-list" value={cfg.videoModel || ''} onChange={e => set('videoModel', e.target.value)} placeholder="wan2.7-t2v" />
                <datalist id="gl-video-model-list">
                  {['wan2.7-t2v', 'wan2.6-t2v-flash', 'wan2.7-i2v'].map(m => <option key={m} value={m} />)}
                </datalist>
              </label>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><CloudSync size={18} /><div><h3>异地协作</h3><p>让多台电脑访问同一个后端。</p></div></div>
            <div className="form-stack">
              <label>远程后端 API 根地址
                <input value={cfg.remoteBase || ''} onChange={e => set('remoteBase', e.target.value)} placeholder="留空用本机，如 https://xxx.trycloudflare.com/api" />
              </label>
              <p className="muted small">两台电脑连同一个常开的后端即实时共享；或用「同步」页做 Git 中转。保存后写本地存储，无需重启。</p>
            </div>
          </section>
        </div>

        <section className="card">
          <div className="card-head"><ShieldCheck size={18} /><div><h3>本地与隐私</h3><p>这台机器上发生了什么。</p></div></div>
          <div className="info-list">
            <div><Server size={15} /><span>数据文件</span><code>data/db.json</code></div>
            <div><KeyRound size={15} /><span>密钥文件</span><code>data/settings.json</code></div>
            <div><Cpu size={15} /><span>API 代理</span><code>127.0.0.1:8787</code></div>
            <div><ShieldCheck size={15} /><span>外部上传</span><strong>仅调用所选服务</strong></div>
          </div>
          <p className="muted small">API Key 只写本地 <code>data/settings.json</code>，前端仅显示掩码，不会进入协作同步内容。不要把它提交到公开仓库。</p>
        </section>

        <section className="card">
          <div className="card-head"><ExternalLink size={18} /><div><h3>获取 Key</h3><p>阿里云百炼控制台。</p></div></div>
          <p>在阿里云百炼控制台开通模型服务并创建 API Key，填到左侧。支持兼容 OpenAI 协议的自定义端点，可自行修改 Base URL 与模型名。</p>
          <a className="btn btn-ghost" href="https://bailian.console.aliyun.com/" target="_blank" rel="noreferrer">打开百炼控制台 <ExternalLink size={14} /></a>
        </section>
      </div>
    </main>
  );
}
