import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { localFileContentType } from './utils/contentTypes.js';

export function createTranscriptMediaHelpers({ mediaById }) {
  function mediaFromDataUrl(dataUrl) {
    const match = String(dataUrl ?? '').match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) return null;
    const [, contentType, encoded] = match;
    const id = createHash('sha256').update(dataUrl).digest('hex').slice(0, 40);
    if (!mediaById.has(id)) mediaById.set(id, { contentType, data: Buffer.from(encoded, 'base64') });
    return { type: 'image', src: `/api/media/${id}`, contentType };
  }

  function mediaFromLocalFilePath(filePath) {
    const target = String(filePath ?? '').trim().replace(/^<|>$/g, '');
    if (!/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(target)) return null;
    if (!existsSync(target)) return null;
    try { if (!statSync(target).isFile()) return null; } catch { return null; }
    const contentType = localFileContentType(target);
    const id = createHash('sha256').update(target).digest('hex').slice(0, 40);
    if (!mediaById.has(id)) mediaById.set(id, { contentType, filePath: target, filename: path.basename(target) });
    return { src: `/api/media/${id}`, contentType, filename: path.basename(target) };
  }

  function rewriteMarkdownLocalFileLinks(text) {
    return String(text ?? '').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawTarget) => {
      const target = String(rawTarget ?? '').trim().replace(/^["']|["']$/g, '');
      const media = mediaFromLocalFilePath(target);
      const kind = String(media?.contentType ?? '').startsWith('video/') ? 'video' : 'image';
      return media ? `![${alt}](${media.src}?kind=${kind})` : match;
    }).replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (match, label, rawTarget) => {
      const target = String(rawTarget ?? '').trim().replace(/^["']|["']$/g, '');
      const media = mediaFromLocalFilePath(target);
      return media ? `[${label}](${media.src})` : match;
    });
  }

  function rewriteLocalFileReferences(text, cwd = '') {
    return String(text ?? '').split(/(```[\s\S]*?```)/g).map((segment) => {
      if (segment.startsWith('```')) return segment;
      return rewriteBareLocalFilePaths(rewriteInlineCodeLocalFileLinks(rewriteMarkdownLocalFileLinks(segment), cwd), cwd);
    }).join('');
  }

  function rewriteInlineCodeLocalFileLinks(text, cwd = '') {
    return String(text ?? '').replace(/`([^`\n]+)`/g, (match, rawPath) => {
      const resolved = resolveMentionedFilePath(rawPath, cwd);
      const media = resolved ? mediaFromLocalFilePath(resolved) : null;
      return media ? `[${rawPath}](${media.src})` : match;
    });
  }

  function resolveMentionedFilePath(rawPath, cwd = '') {
    const cleaned = String(rawPath ?? '').trim().replace(/^[\'"`(<\[]+|[\'"`)>\].,;:]+$/g, '');
    if (!cleaned) return '';
    if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(cleaned)) return existsSync(cleaned) ? cleaned : '';
    if (!cwd || cleaned.includes('://') || cleaned.startsWith('/api/')) return '';
    if (!/[\\/]/.test(cleaned)) return '';
    const resolved = path.win32.resolve(cwd, cleaned.replace(/\//g, '\\'));
    return existsSync(resolved) ? resolved : '';
  }

  function rewriteBareLocalFilePaths(text, cwd = '') {
    const source = String(text ?? '');
    return source.replace(/(^|[\s(<])((?:[a-zA-Z]:[\\/]|\\\\)[^\s`<>()\[\]{}]+|(?:\.\.?[\\/]|[A-Za-z0-9_.-]+[\\/])[^\s`<>()\[\]{}]+)(?=$|[\s)\]>.,;:])/g, (match, prefix, rawPath) => {
      const resolved = resolveMentionedFilePath(rawPath, cwd);
      const media = resolved ? mediaFromLocalFilePath(resolved) : null;
      return media ? `${prefix}[${rawPath}](${media.src})` : match;
    });
  }

  return {
    mediaFromDataUrl,
    mediaFromLocalFilePath,
    rewriteLocalFileReferences,
    resolveMentionedFilePath,
  };
}
