import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { imageContentTypeFromBase64, localFileContentType } from './utils/contentTypes.js';

function stripPathLineSuffix(filePath) {
  const text = String(filePath ?? '').trim();
  const withoutFragment = text.replace(/#L\d+(?:-L?\d+)?$/i, '');
  const match = withoutFragment.match(/^(.+[\\/][^\\/]+):\d+(?::\d+)?$/);
  return match ? match[1] : withoutFragment;
}

function defaultNormalizeLocalFilePath(filePath) {
  const target = stripPathLineSuffix(String(filePath ?? '').trim().replace(/^<|>$/g, ''));
  if (!target || target.includes('\0')) return '';
  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(target)) return path.win32.normalize(target);
  if (path.isAbsolute(target)) return path.normalize(target);
  return '';
}

function defaultCanServeLocalFilePath(filePath) {
  if (!filePath) return false;
  if (!existsSync(filePath)) return false;
  try { if (!statSync(filePath).isFile()) return false; } catch { return false; }
  return true;
}

function policyFromCwd(cwd = '', policy = {}) {
  return {
    ...policy,
    cwd: policy.cwd || cwd || '',
  };
}

export function createTranscriptMediaHelpers({
  mediaById,
  canServeLocalFilePath = defaultCanServeLocalFilePath,
  localFileScope = (filePath) => filePath,
  normalizeLocalFilePath = defaultNormalizeLocalFilePath,
} = {}) {
  function mediaFromBase64Data(base64Data, fallbackContentType = '') {
    const encoded = String(base64Data ?? '').replace(/\s+/g, '');
    const hasImageContentType = String(fallbackContentType ?? '').startsWith('image/');
    if ((!hasImageContentType && encoded.length < 64) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
    let data;
    try {
      data = Buffer.from(encoded, 'base64');
    } catch {
      return null;
    }
    const contentType = imageContentTypeFromBase64(encoded) || fallbackContentType;
    if (!contentType?.startsWith('image/')) return null;
    const id = createHash('sha256').update(`${contentType}:${encoded}`).digest('hex').slice(0, 40);
    if (!mediaById.has(id)) mediaById.set(id, { contentType, data });
    return { type: 'image', src: `/api/media/${id}`, contentType };
  }

  function mediaFromDataUrl(dataUrl) {
    const match = String(dataUrl ?? '').match(/^data:([^;,]+);base64,(.+)$/s);
    if (!match) return null;
    const [, contentType, encoded] = match;
    return mediaFromBase64Data(encoded, contentType);
  }

  function mediaFromLocalFilePath(filePath, policy = {}) {
    const target = normalizeLocalFilePath(filePath);
    if (!canServeLocalFilePath(target, policy)) return null;
    const contentType = localFileContentType(target);
    const scope = localFileScope(target, policy) || target;
    const id = createHash('sha256').update(`${scope}\n${target}`).digest('hex').slice(0, 40);
    if (!mediaById.has(id)) mediaById.set(id, { contentType, filePath: target, filename: path.basename(target), scope });
    return { src: `/api/media/${id}`, contentType, filename: path.basename(target) };
  }

  function renderableMediaFromLocalFilePath(filePath, policy = {}) {
    const media = mediaFromLocalFilePath(filePath, policy);
    return isRenderableTranscriptMedia(media) ? media : null;
  }

  function isRenderableTranscriptMedia(media) {
    return /^image\/|^video\//.test(String(media?.contentType ?? ''));
  }

  function rewriteMarkdownLocalFileLinks(text, policy = {}) {
    return String(text ?? '').replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawTarget) => {
      const target = String(rawTarget ?? '').trim().replace(/^["']|["']$/g, '');
      const media = renderableMediaFromLocalFilePath(resolveMentionedFilePath(target, policy.cwd) || target, policy);
      const kind = String(media?.contentType ?? '').startsWith('video/') ? 'video' : 'image';
      return media ? `![${alt}](${media.src}?kind=${kind})` : match;
    }).replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (match, label, rawTarget) => {
      const target = String(rawTarget ?? '').trim().replace(/^["']|["']$/g, '');
      const resolved = resolveMentionedFilePath(target, policy.cwd) || target;
      const media = mediaFromLocalFilePath(resolved, policy);
      return media ? `[${label}](${media.src})` : match;
    });
  }

  function rewriteLocalFileReferences(text, cwd = '', mediaPolicy = {}) {
    const policy = policyFromCwd(cwd, mediaPolicy);
    return String(text ?? '').split(/(```[\s\S]*?```)/g).map((segment) => {
      if (segment.startsWith('```')) return segment;
      return rewriteBareLocalFilePaths(rewriteInlineCodeLocalFileLinks(rewriteMarkdownLocalFileLinks(segment, policy), policy), policy);
    }).join('');
  }

  function rewriteInlineCodeLocalFileLinks(text, policy = {}) {
    return String(text ?? '').replace(/`([^`\n]+)`/g, (match, rawPath) => {
      const resolved = resolveMentionedFilePath(rawPath, policy.cwd);
      const media = resolved ? mediaFromLocalFilePath(resolved, policy) : null;
      return media ? `[${rawPath}](${media.src})` : match;
    });
  }

  function resolveMentionedFilePath(rawPath, cwd = '') {
    const cleaned = stripPathLineSuffix(String(rawPath ?? '').trim().replace(/^[\'"`(<\[]+|[\'"`)>\].,;:]+$/g, ''));
    if (!cleaned) return '';
    if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(cleaned)) return existsSync(cleaned) ? cleaned : '';
    if (!cwd || cleaned.includes('://') || cleaned.startsWith('/api/')) return '';
    if (!/[\\/]/.test(cleaned) && !cleaned.startsWith('.')) return '';
    const relative = cleaned.replace(/^(?:\.\.\.|\u2026)(?:[\\/])/, '');
    const resolved = path.win32.resolve(cwd, relative.replace(/\//g, '\\'));
    return existsSync(resolved) ? resolved : '';
  }

  function rewriteBareLocalFilePaths(text, policy = {}) {
    const source = String(text ?? '');
    return source.replace(/(^|[\s(<])((?:[a-zA-Z]:[\\/]|\\\\)[^\s`<>()\[\]{}]+|(?:(?:\.{1,3}|\u2026)[\\/]|[A-Za-z0-9_.-]+[\\/])[^\s`<>()\[\]{}]+)(?=$|[\s)\]>.,;:])/g, (match, prefix, rawPath) => {
      const resolved = resolveMentionedFilePath(rawPath, policy.cwd);
      const media = resolved ? mediaFromLocalFilePath(resolved, policy) : null;
      return media ? `${prefix}[${rawPath}](${media.src})` : match;
    });
  }

  return {
    mediaFromBase64Data,
    mediaFromDataUrl,
    mediaFromLocalFilePath,
    rewriteLocalFileReferences,
    resolveMentionedFilePath,
  };
}
