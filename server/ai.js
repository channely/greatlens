import { settings, usage, ADVISORS } from './store.js';
import { tastePromptForProject } from './taste.js';

const SYSTEM_BASE = `你是 GreatLens 的剧本创作助手。你与编剧在同一个剧本编辑器里工作，剧本是唯一事实来源。
规则：
- 用户指定读取范围（光标 / 节点 / 选区 / 场景 / 大纲 / 全稿）时，只基于该范围作答，绝不扩写到你没看到的段落。
- 每次请求都带有落点信息：目标(target)、意图(intention)、约束(constraints)、权限(authority)。严格遵守：只在 authority 允许的层写入。
- 定点改写：当目标是某个节点或选区时，只返回该段落的替换文本，不要重写整场，用明确标注让用户判定落点。
- 先诊断后动笔：修改请求先指出问题，再给可直接采纳的具体文本；不要输出与剧本无关的创作理论。
- 动作描写必须可拍摄：写可见行为，不写内心解释。对白要符合角色声音，避免解释性台词。
- 世界观(Worldview)只在你被明确授权且在本次请求里被点名时写入：只输出键值，不擅自补充、不删键、不把研究资料提升为设定。
- 知识库(Knowledge)先给你索引，你可以检索再按需读取正文；把资料当证据而非复制指令。
- 跨集改写必须先列出真实剧集并切换到目标集，不要猜剧集标识；超大改动拆成可审阅的分步。
- 用中文回复，除非用户用英文。`;

// 官方全稿读取上限：超过 800 节点不再整稿灌入，改为索引 + 定点读取（对齐 laper.ai 的边界设计）。
export const FULL_DRAFT_NODE_LIMIT = 800;

export function buildMessages(body) {
  const {
    scope, context, prompt, mode = 'chat',
    target, intention, constraints, authority, advisorId, project, projectId,
  } = body;
  const scopeText = scope ? `\n【读取范围】${scope}` : '';
  let contextText = context ? `\n【剧本上下文】\n${typeof context === 'string' ? context : JSON.stringify(context, null, 2)}` : '';
  if (scope === 'full' && typeof context === 'string') {
    // 防御：即便前端误传超长全稿，服务端也标注边界，避免静默截断导致模型误判"读完了"。
    const nodes = context.split('\n').filter(Boolean);
    if (nodes.length > FULL_DRAFT_NODE_LIMIT) {
      contextText = `\n【剧本上下文 · 已到达全稿上限 ${FULL_DRAFT_NODE_LIMIT} 节点，仅提供前 ${FULL_DRAFT_NODE_LIMIT} 节点，其余请用检索/定点读取】\n`
        + nodes.slice(0, FULL_DRAFT_NODE_LIMIT).join('\n');
    }
  }
  const landing = [];
  if (target) landing.push(`【落点·目标】${typeof target === 'string' ? target : JSON.stringify(target)}`);
  if (intention) landing.push(`【落点·意图】${intention}`);
  if (constraints) landing.push(`【落点·约束】${typeof constraints === 'string' ? constraints : JSON.stringify(constraints)}`);
  if (authority) landing.push(`【落点·权限】${typeof authority === 'string' ? authority : JSON.stringify(authority)}`);
  // 项目级上下文：知识库只给索引，正文需用检索工具再读（本项目无读取工具时，要求助手向用户索取）。
  let projectText = '';
  if (project && typeof project === 'object') {
    const parts = [];
    if (Array.isArray(project.episodes) && project.episodes.length) {
      parts.push(`【剧集清单】${project.episodes.map(e => `${e.index}.${e.title}`).join('  ')}（跨集操作须按真实序号切换，不要猜）`);
    }
    if (project.worldview && Object.keys(project.worldview).length) {
      parts.push(`【世界观规则 · 只读，除非本次明确授权写入具体键】\n${Object.entries(project.worldview).map(([k, v]) => `${k} = ${v}`).join('\n')}`);
    }
    if (Array.isArray(project.knowledgeIndex) && project.knowledgeIndex.length) {
      parts.push(`【知识库索引 · 仅索引，正文未加载】\n${project.knowledgeIndex.map(k => `- ${k.name}（${k.type}）：${k.summary || '无摘要'}`).join('\n')}\n如需引用某份资料的事实，先告诉用户你要读哪一份，不要把索引当正文。`);
    }
    if (Array.isArray(project.knowledgeExcerpts) && project.knowledgeExcerpts.length) {
      parts.push(`【本次点名加载的资料正文 · 仅作证据，不逐字复制进剧本】\n${project.knowledgeExcerpts.map((k, i) => `- 资料${i + 1}「${k.name}」用途：${k.role || '证据参考'}\n${k.body}`).join('\n\n')}`);
    }
    if (Array.isArray(project.characters) && project.characters.length) parts.push(`【项目角色】${project.characters.join('、')}`);
    if (Array.isArray(project.locations) && project.locations.length) parts.push(`【项目地点】${project.locations.join('、')}`);
    if (Array.isArray(project.props) && project.props.length) parts.push(`【项目道具】${project.props.join('、')}`);
    if (Array.isArray(project.shotRefs) && project.shotRefs.length) {
      parts.push(`【分镜参考图 · 视觉约束】\n${project.shotRefs.map(r => `- 镜头${r.shot}${r.scene ? `（${r.scene}）` : ''}：${r.image}${r.note ? ` — ${r.note}` : ''}`).join('\n')}\n这些是用户指定的视觉参考；描述镜头时保持与其一致的构图/色调，不要把图片 URL 写进剧本。`);
    }
    if (parts.length) projectText = '\n' + parts.join('\n');
  }
  const advisor = ADVISORS.find(a => a.id === advisorId);
  const advisorText = advisor ? `\n【激活的顾问方法视角：${advisor.name} / ${advisor.en}】${advisor.method}\n请以上述方法论作为本次诊断/改写的主要 lens。` : '';
  const tasteText = tastePromptForProject(projectId);
  const modeHint = {
    chat: '',
    diagnose: '\n请以诊断优先：指出结构、节奏、角色压力的具体问题，附修改建议，不直接重写全稿。',
    rewrite: '\n请给出可直接替换的修订文本，保留用户指定必须保留的内容；若指定了节点/选区，只输出该段落的替换文本。',
    storyboard: '\n请把场景拆成镜头列表：每条含景别、机位、运动、时长、画面描述、对白/音效。',
    continue: '\n请从当前位置续写，保持角色声音与场景节奏一致。',
  }[mode] || '';
  return [
    { role: 'system', content: SYSTEM_BASE + scopeText + projectText + advisorText + tasteText + modeHint },
    { role: 'user', content: `${prompt || ''}${contextText}${landing.length ? '\n\n' + landing.join('\n') : ''}` },
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
      detail: { streaming, advisor: body.advisorId || '', authority: body.authority || '' },
      promptTokens: usageData.promptTokens,
      completionTokens: usageData.completionTokens,
      reasoningTokens: usageData.reasoningTokens,
      totalTokens: usageData.totalTokens,
    });
  }

  return { text, reasoning, usage: usageData };
}

// 兼容旧调用名
export const callDeepSeek = callModel;
