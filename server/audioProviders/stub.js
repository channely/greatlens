import crypto from 'node:crypto';

export async function synthesize() {
  return {
    audioUrl: `stub://audio/${crypto.randomUUID()}.mp3`,
    tokenUsage: { inputTokens: 128, outputTokens: 256 },
    realCall: false,
  };
}
