// 导演圆桌与剧本围读：同步 TTS，成功直接落 audio asset；按 token 精确记账，未知成本不猜。
import { db, uid, settings, usage } from './store.js';
import { persist } from './media.js';
import {
  DEFAULT_AUDIO_MODEL, MAX_AUDIO_PROMPT_CHARS,
  MAX_ROUNDTABLE_SECONDS, MAX_OTHER_AUDIO_SECONDS,
  MAX_AUDIO_REFERENCES, MAX_AUDIO_REFERENCE_SECONDS, MAX_AUDIO_REFERENCE_BYTES,
} from './models.js';
import { synthesize as stubSynthesize } from './audioProviders/stub.js';
import { synthesize as bailianSynthesize } from './audioProviders/bailian.js';

const STUB = process.env.GL_STUB_MODELS === '1';
const bad = (message, status = 422) => Object.assign(new Error(message), { status });

export function planAudio(project, body = {}) {
  const scene = String(body.scene || 'readthrough');
  if (!['roundtable', 'readthrough'].includes(scene)) throw bad('未知音频场景');
  const ep = (project.episodes || []).find(e => e.id === body.episodeId) || project.episodes?.[0];

  if (scene === 'roundtable') {
    const focus = String(body.focus || project.cover?.logline || project.logline || project.name || '这个项目');
    const script = [
      `导演：这次讨论只围绕一个问题——「${focus}」的可见动作是什么？`,
      '编剧：先别解决它。把角色放进一个必须做选择的场次里，答案自然会露出。',
      '制片：这个选择需要几个地点？如果超过两个，先把第三个并进前一个。',
      '导演：好。保留选择的代价，删掉解释代价的台词。',
    ].join('\n');
    return {
      scene, script,
      seconds: Math.min(MAX_ROUNDTABLE_SECONDS, Math.max(30, Math.round(script.length / 4))),
      limit: MAX_ROUNDTABLE_SECONDS,
      needsRange: false,
      note: '导演圆桌先生成对谈稿，确认后再合成；单人段与多人段按同一接口处理。',
    };
  }

  const nodes = ep?.nodes || [];
  const script = nodes.filter(n => ['character', 'dialogue'].includes(n.type) && String(n.text || '').trim())
    .map(n => `${n.type === 'character' ? '角色' : '对白'}：${n.text.trim()}`)
    .join('\n');
  if (!script) throw bad('当前剧集没有可对白的节点，请先写两轮对话。');
  const needsRange = script.length > MAX_AUDIO_PROMPT_CHARS || Math.round(script.length / 4) > MAX_OTHER_AUDIO_SECONDS;
  return {
    scene, episodeId: ep.id, script: script.slice(0, MAX_AUDIO_PROMPT_CHARS),
    seconds: Math.min(MAX_OTHER_AUDIO_SECONDS, Math.max(20, Math.round(script.length / 4))),
    limit: MAX_OTHER_AUDIO_SECONDS,
    needsRange,
    note: needsRange ? '对白超过 120 秒 / 3000 字符。请缩小场次或回合范围；不自动截断、不承诺跨段音色一致。' : '剧本围读从现有 nodes 派生，不复制第二份剧本。',
  };
}

export async function generateAudio(body = {}) {
  const scene = String(body.scene || 'readthrough');
  if (!['roundtable', 'readthrough'].includes(scene)) throw bad('未知音频场景');
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw bad('音频文案不能为空');
  if (prompt.length > MAX_AUDIO_PROMPT_CHARS) throw bad(`音频文案最多 ${MAX_AUDIO_PROMPT_CHARS} 字符`);
  const limit = scene === 'roundtable' ? MAX_ROUNDTABLE_SECONDS : MAX_OTHER_AUDIO_SECONDS;
  const seconds = Math.min(limit, Math.max(1, Math.round(Number(body.seconds) || 30)));
  if (Number(body.seconds) > limit) throw bad(`${scene === 'roundtable' ? '导演圆桌' : '其他场景'}最长 ${limit} 秒，请缩小范围`);

  const refs = Array.isArray(body.references) ? body.references : [];
  if (refs.length > MAX_AUDIO_REFERENCES) throw bad(`参考音频最多 ${MAX_AUDIO_REFERENCES} 条`);
  for (const r of refs) {
    if (Number(r.seconds) > MAX_AUDIO_REFERENCE_SECONDS) throw bad('每条参考音频最长 30 秒');
    if (Number(r.bytes) > MAX_AUDIO_REFERENCE_BYTES) throw bad('每条参考音频不超过 10MB');
  }

  const model = String(body.model || settings.get().audioModel || DEFAULT_AUDIO_MODEL);
  const provider = STUB ? stubSynthesize : bailianSynthesize;
  const result = await provider({ prompt, model, voice: body.voice, references: refs });
  const asset = await persist(result.audioUrl, 'audio', {
    model, prompt, projectId: body.projectId, scene, seconds, taskId: uid(),
  });

  const cfg = settings.get();
  const inputTokens = Number(result.tokenUsage?.inputTokens);
  const outputTokens = Number(result.tokenUsage?.outputTokens);
  const known = Number.isFinite(inputTokens) && Number.isFinite(outputTokens);
  const cost = known
    ? Math.round((inputTokens / 1e6 * Number(cfg.audioPriceInput || 0) + outputTokens / 1e6 * Number(cfg.audioPriceOutput || 0)) * 1e6) / 1e6
    : 0;
  const taskId = uid();
  usage.add({
    type: 'audio', model, mode: scene, scope: '', promptTokens: known ? inputTokens : 0,
    completionTokens: known ? outputTokens : 0, totalTokens: known ? inputTokens + outputTokens : 0,
    projectId: body.projectId || '',
    detail: {
      scene, seconds, costKnown: known,
      note: known
        ? `音频按 token 计费：输入 ${inputTokens} × ¥${cfg.audioPriceInput}/百万 + 输出 ${outputTokens} × ¥${cfg.audioPriceOutput}/百万`
        : '接口未返回可计费 Token，成本未知；未用时长冒充 Token。',
    },
    costOverride: cost,
  });

  db.update(d => {
    d.tasks.unshift({
      id: taskId, taskId, type: 'audio', status: 'succeeded', model, prompt,
      scene, seconds, projectId: body.projectId || '', assets: [asset.id],
      usageRecordedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const stored = d.assets.find(a => a.id === asset.id);
    if (stored) Object.assign(stored, { costKnown: known, cost, tokenUsage: result.tokenUsage || null });
  });

  return {
    taskId, status: 'succeeded', url: asset.url, assetId: asset.id,
    prompt, scene, seconds, costKnown: known, cost,
    note: known ? '' : '成本未知：接口未返回可计费 Token。',
  };
}
