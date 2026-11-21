import React from 'react';
import { Sparkles, Braces, Check, AlertTriangle, Loader2, Wand2, Copy } from 'lucide-react';

export default function DslInput({
  seed, setSeed, dslText, setDslText, diagnostics, busy,
  onGenerate, onValidate, onSave, onCompile,
}) {
  const errors = (diagnostics || []).filter(d => d.severity === 'error');
  const warnings = (diagnostics || []).filter(d => d.severity !== 'error');
  const [copied, setCopied] = React.useState(false);

  function copyDsl() {
    try { navigator.clipboard.writeText(dslText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }

  return (
    <div className="vp-input-grid">
      <div className="card vp-input-left">
        <h3><Sparkles size={16} /> 从创意开始</h3>
        <label className="vp-field">
          <span>一句话创意（自然语言入口）</span>
          <textarea rows={4} value={seed} onChange={e => setSeed(e.target.value)}
            placeholder="30 秒科普：细胞核和线粒体的对话……" />
        </label>
        <div className="vp-actions">
          <button className="btn btn-primary" onClick={onGenerate} disabled={busy === 'generate' || !seed.trim()}>
            {busy === 'generate' ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} AI 编译为 DSL
          </button>
        </div>
        <p className="muted small">LLM 只输出受限的结构化 DSL，之后由确定性解释器驱动 3D 场景；模型幻觉会在保存前被校验拦截。</p>

        <div className="vp-diag">
          <h4><Braces size={14} /> 校验诊断</h4>
          {(!diagnostics || diagnostics.length === 0) && <p className="muted small">尚无诊断。生成或校验 DSL 后显示。</p>}
          {errors.map((d, i) => <div key={`e${i}`} className="vp-diag-row error"><AlertTriangle size={13} />
            <span><strong>{d.code}</strong> {d.message}{d.path ? ` · ${d.path}` : ''}</span></div>)}
          {warnings.map((d, i) => <div key={`w${i}`} className="vp-diag-row warn"><AlertTriangle size={13} />
            <span><strong>{d.code}</strong> {d.message}</span></div>)}
        </div>
      </div>

      <div className="card vp-input-right">
        <div className="vp-editor-head">
          <h3><Braces size={16} /> 科普叙事 DSL <span className="vp-badge">v1</span></h3>
          <button className="icon-btn" onClick={copyDsl} title="复制 DSL" disabled={!dslText}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        </div>
        <textarea className="vp-dsl-editor" spellCheck={false} value={dslText} onChange={e => setDslText(e.target.value)}
          placeholder="点击左侧「AI 编译为 DSL」生成草稿，或直接粘贴 virtual-scene-dsl/v1 JSON。" />
        <div className="vp-actions">
          <button className="btn btn-ghost" onClick={onValidate} disabled={busy === 'validate' || !dslText.trim()}>
            {busy === 'validate' ? <Loader2 size={15} className="spin" /> : <Check size={15} />} 校验
          </button>
          <button className="btn btn-ghost" onClick={onSave} disabled={busy === 'save' || !dslText.trim()}>
            {busy === 'save' ? <Loader2 size={15} className="spin" /> : <Braces size={15} />} 保存
          </button>
          <button className="btn btn-primary" onClick={onCompile} disabled={busy === 'compile' || !dslText.trim()}>
            {busy === 'compile' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} 编译并预演
          </button>
        </div>
        <p className="muted small">保存会写入项目并创建版本快照；编译生成场景图与时间轴，供导演台实时预演与成片导出。</p>
      </div>
    </div>
  );
}
