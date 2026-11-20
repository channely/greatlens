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
  imageGenPrice: 0.18,
  imageInputPrice: 0.02,
  videoPrice480P: 0.3,
  videoPrice720P: 0.6,
  videoPrice1080P: 1.2,
  videoDiscount: 0.7,
  audioPriceInput: 6,
  audioPriceOutput: 12,
  workspaceId: '',
  audioModel: 'qwen-audio-3.1-tts-next',
  mediaBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  imageModel: 'qwen-image-3.0',
  videoModel: 'wan3.0-video',
  videoResolution: '480P',
  remoteBase: '',
};

const IMAGE_MODELS = ['qwen-image-3.0', 'qwen-image-3.0-pro', 'qwen-image-2.1-turbo', 'wanx2.1-t2i-plus'];
const VIDEO_MODELS = ['wan3.0-video', 'wan2.7-t2v', 'wan2.7-i2v'];
const RESOLUTIONS = ['480P', '720P', '1080P'];

const DOCS = {
  image: 'https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference',
  video: 'https://docs.bailian.console.aliyun.com/zh/model-studio/wan3-video-generation-api-reference',
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
        for (const k of ['imageGenPrice', 'imageInputPrice', 'videoPrice480P', 'videoPrice720P', 'videoPrice1080P', 'videoDiscount', 'audioPriceInput', 'audioPriceOutput']) {
          next[k] = Number.isFinite(Number(next[k])) ? Number(next[k]) : DEFAULTS[k];
        }
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
          <p className="muted">配置百炼模型与本地估算单价：图像按张、视频按秒（480P / 720P / 1080P 分档，最长 30 秒）。API Key 只保存在本机。</p>
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
            <div className="card-head"><Coins size={18} /><div><h3>计费单价</h3><p>token 按百万计；图像按张；视频按秒、随分辨率分档。</p></div></div>
            <div className="form-stack">
              <div className="billing-group">
                <div className="billing-group-title">文本 · qwen4-max</div>
                <div className="form-two">
                  <label>输入（¥ / 百万 token）
                    <input type="number" min="0" step="0.1" value={cfg.priceInput} onChange={e => set('priceInput', Number(e.target.value))} />
                  </label>
                  <label>输出（¥ / 百万 token）
                    <input type="number" min="0" step="0.1" value={cfg.priceOutput} onChange={e => set('priceOutput', Number(e.target.value))} />
                  </label>
                </div>
              </div>
              <div className="billing-group">
                <div className="billing-group-title">图像 · 按张</div>
                <div className="form-two">
                  <label>生成（¥ / 张）
                    <input type="number" min="0" step="0.01" value={cfg.imageGenPrice} onChange={e => set('imageGenPrice', Number(e.target.value))} />
                  </label>
                  <label>输入图（¥ / 张）
                    <input type="number" min="0" step="0.01" value={cfg.imageInputPrice} onChange={e => set('imageInputPrice', Number(e.target.value))} />
                  </label>
                </div>
                <p className="muted small">1K 与 2K 同价。图生图时输入图按张另计。</p>
              </div>
              <div className="billing-group">
                <div className="billing-group-title">视频 · 按秒（由输出分辨率决定单价）</div>
                <div className="form-three">
                  <label>480P（¥ / 秒）
                    <input type="number" min="0" step="0.01" value={cfg.videoPrice480P} onChange={e => set('videoPrice480P', Number(e.target.value))} />
                  </label>
                  <label>720P（¥ / 秒）
                    <input type="number" min="0" step="0.01" value={cfg.videoPrice720P} onChange={e => set('videoPrice720P', Number(e.target.value))} />
                  </label>
                  <label>1080P（¥ / 秒）
                    <input type="number" min="0" step="0.01" value={cfg.videoPrice1080P} onChange={e => set('videoPrice1080P', Number(e.target.value))} />
                  </label>
                </div>
                <label className="mt-8">折扣系数（限时 7 折填 0.7，无折扣填 1）
                  <input type="number" min="0.01" max="1" step="0.05" value={cfg.videoDiscount} onChange={e => set('videoDiscount', Number(e.target.value))} />
                </label>
                <p className="muted small">输入视频与输出视频均按秒计费，单价取输出分辨率对应档。单条最长 30 秒。折后单价：480P ¥{(cfg.videoPrice480P * cfg.videoDiscount).toFixed(3)}/s · 720P ¥{(cfg.videoPrice720P * cfg.videoDiscount).toFixed(3)}/s · 1080P ¥{(cfg.videoPrice1080P * cfg.videoDiscount).toFixed(3)}/s。</p>
              </div>
              <div className="billing-group">
                <div className="billing-group-title">音频 · 按 Token（北京地域）</div>
                <div className="form-two">
                  <label>输入（¥ / 百万 Token）
                    <input type="number" min="0" step="0.5" value={cfg.audioPriceInput} onChange={e => set('audioPriceInput', Number(e.target.value))} />
                  </label>
                  <label>输出（¥ / 百万 Token）
                    <input type="number" min="0" step="0.5" value={cfg.audioPriceOutput} onChange={e => set('audioPriceOutput', Number(e.target.value))} />
                  </label>
                </div>
                <p className="muted small">只有接口返回可计费 Token 时才精确记账；未返回时标「未知」，不用音频时长冒充 Token。</p>
              </div>
              <p className="muted small">以上为本地估算，实际以阿里云账单为准，可自行修改。</p>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><ImageIcon size={18} /><div><h3>图像与视频</h3><p>默认 qwen-image-3.0 出图、wan3.0-video 出片（最长 30 秒，默认 480P）。</p></div></div>
            <div className="form-stack">
              <label>Media Base URL
                <input value={cfg.mediaBaseUrl || ''} onChange={e => set('mediaBaseUrl', e.target.value)} placeholder={DEFAULTS.mediaBaseUrl} />
              </label>
              <label>图像模型
                <select value={cfg.imageModel || ''} onChange={e => set('imageModel', e.target.value)}>
                  {IMAGE_MODELS.map(m => <option key={m} value={m}>{m}{m === 'qwen-image-3.0' ? '（默认）' : ''}</option>)}
                </select>
              </label>
              <label>视频模型
                <select value={cfg.videoModel || ''} onChange={e => set('videoModel', e.target.value)}>
                  {VIDEO_MODELS.map(m => <option key={m} value={m}>{m}{m === 'wan3.0-video' ? '（默认）' : ''}</option>)}
                </select>
              </label>
              <label>视频默认分辨率
                <select value={cfg.videoResolution || '480P'} onChange={e => set('videoResolution', e.target.value)}>
                  {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label>音频模型
                <select value={cfg.audioModel || 'qwen-audio-3.1-tts-next'} onChange={e => set('audioModel', e.target.value)}>
                  <option value="qwen-audio-3.1-tts-next">qwen-audio-3.1-tts-next（默认）</option>
                </select>
              </label>
              <label>百炼 WorkspaceId（音频同步接口域名）
                <input value={cfg.workspaceId || ''} onChange={e => set('workspaceId', e.target.value)} placeholder="用于 {WorkspaceId}.cn-beijing.maas.aliyuncs.com" />
              </label>
              <div className="model-doc-links">
                <a href={DOCS.image} target="_blank" rel="noreferrer">Qwen-Image-3.0 文档 ↗</a>
                <a href={DOCS.video} target="_blank" rel="noreferrer">wan3.0-video 文档 ↗</a>
              </div>
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
