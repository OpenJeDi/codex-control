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
