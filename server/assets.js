// 本地上传与资产入库。与生成资产共用 assets[]，binding 由 bindings.js 统一维护。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ASSETS_DIR } from './store.js';
import { recordUploadedAsset } from './bindings.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm',
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/webm': '.webm',
};

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function typeFromMime(mime) {
  if (String(mime).startsWith('video/')) return 'video';
  if (String(mime).startsWith('audio/')) return 'audio';
  return 'image';
}

function safeExt(name, mime) {
  const match = String(name || '').match(/\.[a-zA-Z0-9]{1,5}$/);
  if (match) return match[0].toLowerCase();
  return EXT_BY_MIME[String(mime || '').toLowerCase()] || '.bin';
}

export function uploadAsset(body = {}) {
  const name = String(body.name || '上传素材').slice(0, 160);
  const mime = String(body.mime || '');
  const dataBase64 = String(body.dataBase64 || '');
  if (!dataBase64) throw bad('文件内容为空');
  if (dataBase64.length > Math.ceil(MAX_UPLOAD_BYTES * 4 / 3)) throw bad('文件过大（上限 10MB）', 413);

  let buffer;
  try { buffer = Buffer.from(dataBase64, 'base64'); }
  catch { throw bad('文件无法解码'); }
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) throw bad('文件过大或为空', 413);

  const id = crypto.randomUUID();
  const ext = safeExt(name, mime);
  const filename = `upload-${Date.now()}-${id.slice(0, 8)}${ext}`;
  const target = path.join(ASSETS_DIR, filename);
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.writeFileSync(target, buffer);

  const binding = body.binding || (body.projectId
    ? { kind: 'project', projectId: body.projectId, entityId: body.projectId, slot: 'asset' }
    : null);
  const meta = {
    id,
    type: typeFromMime(mime),
    name,
    url: '/media/' + filename,
    remoteUrl: '',
    path: '/media/' + filename,
    mime,
    size: buffer.length,
    model: 'upload',
    prompt: '',
    projectId: binding?.projectId || body.projectId || '',
    taskId: '',
    createdAt: new Date().toISOString(),
    bindings: [],
  };
  return recordUploadedAsset(meta, binding);
}
