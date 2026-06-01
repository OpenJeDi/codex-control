import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  normalizeLocalFilePath as defaultNormalizeLocalFilePath,
  resolveMentionedFilePath,
} from '../media/localPaths.mjs';
import { imageContentTypeFromBase64, localFileContentType } from './utils/contentTypes.js';

function defaultCanServeLocalFilePath(filePath) {
  if (!filePath) return false;
  if (!existsSync(filePath)) return false;
  try { if (!statSync(filePath).isFile()) return false; } catch { return false; }
  return true;
}

function policyFromCwd(cwd = '', policy = {}) {
  const resolveRoots = uniqueValues([
    cwd,
    policy.cwd,
    ...(Array.isArray(policy.resolveRoots) ? policy.resolveRoots : []),
    ...(Array.isArray(policy.resolveCwds) ? policy.resolveCwds : []),
  ].filter(Boolean));
  const allowedRoots = uniqueValues([
    policy.cwd,
    ...(Array.isArray(policy.allowedRoots) ? policy.allowedRoots : []),
    ...resolveRoots,
  ].filter(Boolean));
  return {
    ...policy,
    cwd: policy.cwd || cwd || '',
    resolveRoots,
    resolveCwds: resolveRoots,
    allowedRoots,
  };
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function resolveRootsForPolicy(policy = {}) {
  return uniqueValues([
    ...(Array.isArray(policy.resolveRoots) ? policy.resolveRoots : []),
    ...(Array.isArray(policy.resolveCwds) ? policy.resolveCwds : []),
    policy.cwd,
  ]);
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
      const media = renderableMediaFromLocalFilePath(resolveMentionedFilePathForPolicy(target, policy) || target, policy);
      const kind = String(media?.contentType ?? '').startsWith('video/') ? 'video' : 'image';
      return media ? `![${alt}](${media.src}?kind=${kind})` : match;
    }).replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, (match, label, rawTarget) => {
      const target = String(rawTarget ?? '').trim().replace(/^["']|["']$/g, '');
      const resolved = resolveMentionedFilePathForPolicy(target, policy) || target;
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
      const resolved = resolveMentionedFilePathForPolicy(rawPath, policy);
      const media = resolved ? mediaFromLocalFilePath(resolved, policy) : null;
      return media ? `[${rawPath}](${media.src})` : match;
    });
  }

  function rewriteBareLocalFilePaths(text, policy = {}) {
    const source = String(text ?? '');
    return source.replace(/(^|[\s(<])((?:[a-zA-Z]:[\\/]|\\\\)[^\s`<>()\[\]{}]+|(?:(?:\.{1,3}|\u2026)[\\/]|[A-Za-z0-9_.-]+[\\/])[^\s`<>()\[\]{}]+)(?=$|[\s)\]>.,;:])/g, (match, prefix, rawPath) => {
      const resolved = resolveMentionedFilePathForPolicy(rawPath, policy);
      const media = resolved ? mediaFromLocalFilePath(resolved, policy) : null;
      return media ? `${prefix}[${rawPath}](${media.src})` : match;
    });
  }

  function resolveMentionedFilePathForPolicy(rawPath, policy = {}) {
    for (const root of resolveRootsForPolicy(policy)) {
      const resolved = resolveMentionedFilePath(rawPath, root);
      if (resolved) return resolved;
    }
    return resolveMentionedFilePath(rawPath, policy.cwd);
  }

  return {
    mediaFromBase64Data,
    mediaFromDataUrl,
    mediaFromLocalFilePath,
    rewriteLocalFileReferences,
    resolveMentionedFilePath,
  };
}
