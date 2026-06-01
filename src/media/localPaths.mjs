import { existsSync } from 'node:fs';
import path from 'node:path';

export function stripPathLineSuffix(filePath) {
  const text = String(filePath ?? '').trim();
  const withoutFragment = text.replace(/#L\d+(?:-L?\d+)?$/i, '');
  const match = withoutFragment.match(/^(.+[\\/][^\\/]+):\d+(?::\d+)?$/);
  return match ? match[1] : withoutFragment;
}

export function normalizeLocalFilePath(filePath) {
  const target = stripPathLineSuffix(String(filePath ?? '').trim().replace(/^<|>$/g, ''));
  if (!target || target.includes('\0')) return '';
  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(target)) return path.win32.normalize(target);
  if (path.isAbsolute(target)) return path.normalize(target);
  return '';
}

export function isWindowsPath(filePath) {
  return /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(String(filePath ?? ''));
}

export function isPathInside(root, candidate) {
  const normalizedRoot = normalizeLocalFilePath(root);
  const normalizedCandidate = normalizeLocalFilePath(candidate);
  if (!normalizedRoot || !normalizedCandidate) return false;
  const pathApi = isWindowsPath(normalizedRoot) || isWindowsPath(normalizedCandidate) ? path.win32 : path;
  const from = pathApi.normalize(normalizedRoot);
  const to = pathApi.normalize(normalizedCandidate);
  const relative = pathApi.relative(from, to);
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative));
}

export function resolveMentionedFilePath(rawPath, cwd = '') {
  const cleaned = stripPathLineSuffix(String(rawPath ?? '').trim().replace(/^[\'"`(<\[]+|[\'"`)>\].,;:]+$/g, ''));
  if (!cleaned) return '';
  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(cleaned)) return existsSync(cleaned) ? cleaned : '';
  if (!cwd || cleaned.includes('://') || cleaned.startsWith('/api/')) return '';
  if (!/[\\/]/.test(cleaned) && !cleaned.startsWith('.')) return '';
  const relative = cleaned.replace(/^(?:\.\.\.|\u2026)(?:[\\/])/, '');
  const resolved = path.win32.resolve(cwd, relative.replace(/\//g, '\\'));
  return existsSync(resolved) ? resolved : '';
}
