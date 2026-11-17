import { settings, usage } from './store.js';

const SYSTEM_BASE = `你是 GreatLens 的剧本创作助手。你与编剧在同一个剧本编辑器里工作，剧本是唯一事实来源。
规则：
- 用户指定读取范围（光标 / 场景 / 大纲 / 全稿）时，只基于该范围作答。
- 修改请求先给诊断，再给可采纳的具体文本；不要输出与剧本无关的创作理论。
- 动作描写必须可拍摄：写可见行为，不写内心解释。
- 对白要符合角色声音，避免解释性台词。
- 用户要求写入世界观时，只输出明确的键值对，不擅自补充。
- 用中文回复，除非用户用英文。`;

function buildMessages(body) {
  const { scope, context, prompt, mode = 'chat' } = body;
  const scopeText = scope ? `\n【读取范围】${scope}` : '';
  const contextText = context ? `\n【剧本上下文】\n${typeof context === 'string' ? context : JSON.stringify(context, null, 2)}` : '';
  const modeHint = {
    chat: '',
    diagnose: '\n请以诊断优先：指出结构、节奏、角色压力的具体问题，附修改建议，不直接重写全稿。',
    rewrite: '\n请给出可直接替换的修订文本，保留用户指定必须保留的内容。',
    storyboard: '\n请把场景拆成镜头列表：每条含景别、机位、运动、时长、画面描述、对白/音效。',
    continue: '\n请从当前位置续写，保持角色声音与场景节奏一致。',
  }[mode] || '';
  return [
    { role: 'system', content: SYSTEM_BASE + scopeText + modeHint },
    { role: 'user', content: `${prompt || ''}${contextText}` },
  ];
}

function extractUsage(u) {
  if (!u) return null;
  return {
    promptTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    completionTokens: u.completion_tokens ?? u.output_tokens ?? 0,
    totalTokens: u.total_tokens ?? ((u.prompt_tokens || 0) + (u.completion_tokens || 0)),
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens
      ?? u.output_tokens_details?.reasoning_tokens ?? 0,
    details: u,
  };
}

/**
 * 调用百炼 OpenAI 兼容 Chat Completions。
 * onEvent(event, payload): event ∈ 'delta' | 'reasoning' | 'usage'
 * 返回 { text, reasoning, usage }
 */
export async function callModel(body, onEvent) {
  const cfg = settings.get();
  if (!cfg.apiKey) {
    throw Object.assign(new Error('尚未配置百炼 API Key，请在「设置」中填写。'), { status: 428 });
  }
  const base = (cfg.baseUrl || '').replace(/\/$/, '');
  if (!base) throw Object.assign(new Error('尚未配置 Base URL。'), { status: 428 });
  const url = base + '/chat/completions';
  const messages = buildMessages(body);
  const streaming = typeof onEvent === 'function';

  const payload = {
    model: cfg.model || 'qwen4-max',
    messages,
    temperature: Number(cfg.temperature ?? 1),
    stream: streaming,
  };
  if (cfg.enableThinking !== false) {
    payload.enable_thinking = true;
    payload.reasoning_effort = 'medium';
  } else {
    payload.enable_thinking = false;
  }
  if (streaming) payload.stream_options = { include_usage: true };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`百炼 API 错误 ${res.status}: ${text.slice(0, 500)}`), { status: 502 });
  }

  let text = '';
  let reasoning = '';
  let usageData = null;

  if (!streaming) {
    const json = await res.json();
    text = json.choices?.[0]?.message?.content || '';
    reasoning = json.choices?.[0]?.message?.reasoning_content || '';
    usageData = extractUsage(json.usage);
  } else {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        if (parsed.usage) {
          usageData = extractUsage(parsed.usage);
          onEvent('usage', usageData);
        }
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          onEvent('reasoning', delta.reasoning_content);
        }
        if (delta.content) {
          text += delta.content;
          onEvent('delta', delta.content);
        }
      }
    }
  }

  if (usageData) {
    usage.add({
      type: 'chat',
      model: cfg.model,
      mode: body.mode || 'chat',
      scope: body.scope || '',
      promptTokens: usageData.promptTokens,
      completionTokens: usageData.completionTokens,
      reasoningTokens: usageData.reasoningTokens,
      totalTokens: usageData.totalTokens,
      detail: { streaming },
    });
  }

  return { text, reasoning, usage: usageData };
}

// 兼容旧调用名
export const callDeepSeek = callModel;
