import { settings } from '../store.js';

// qwen-audio-3.1-tts-next：同步非流式；WorkspaceId 决定北京地域接入域名。
export async function synthesize({ prompt, model, voice, references = [] }) {
  const cfg = settings.get();
  const workspaceId = String(cfg.workspaceId || '').trim();
  if (!workspaceId) throw Object.assign(new Error('尚未配置百炼 WorkspaceId。'), { status: 428 });
  if (!cfg.apiKey) throw Object.assign(new Error('尚未配置百炼 API Key。'), { status: 428 });

  const url = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`;
  const payload = {
    model: model || cfg.audioModel,
    input: { text: prompt, voice: voice || 'longwan' },
    parameters: { format: 'mp3', sample_rate: 24000 },
  };
  if (references.length) payload.input.references = references;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok || json.code) {
    throw Object.assign(new Error(`音频接口错误 ${json.code || res.status}: ${json.message || text.slice(0, 200)}`), { status: 502 });
  }
  const audioUrl = json.output?.audio_url || json.output?.url || '';
  if (!audioUrl) throw Object.assign(new Error('音频接口未返回结果 URL。'), { status: 502 });
  const u = json.usage || {};
  const tokenUsage = {
    inputTokens: Number(u.input_tokens ?? u.prompt_tokens_tokens),
    outputTokens: Number(u.output_tokens ?? u.completion_tokens),
  };
  return { audioUrl, tokenUsage, realCall: true };
}
