import path from 'node:path';

const localContentTypes = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.cpp': 'text/plain; charset=utf-8',
  '.h': 'text/plain; charset=utf-8',
  '.hpp': 'text/plain; charset=utf-8',
  '.cs': 'text/plain; charset=utf-8',
  '.js': 'text/plain; charset=utf-8',
  '.mjs': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.diff': 'text/plain; charset=utf-8',
  '.patch': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
};

const imageContentTypes = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

export function localFileContentType(filePath) {
  const ext = path.extname(String(filePath ?? '')).toLowerCase();
  return localContentTypes[ext] ?? 'application/octet-stream';
}

export function imageContentTypeFromSource(source) {
  const clean = String(source ?? '').split('?')[0].toLowerCase();
  const ext = path.extname(clean).replace('.', '');
  return imageContentTypes[ext] || null;
}

export function imageContentTypeFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  return '';
}

export function imageContentTypeFromBase64(base64Data) {
  const encoded = String(base64Data ?? '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return '';
  try {
    return imageContentTypeFromBuffer(Buffer.from(encoded, 'base64'));
  } catch {
    return '';
  }
}
