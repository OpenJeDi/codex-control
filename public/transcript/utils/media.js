export function isBrowserSafeTranscriptHref(src) {
  const raw = String(src ?? '').trim();
  if (!raw) return false;
  if (raw.startsWith('/api/media/')) return true;
  if (/^https?:\/\//i.test(raw)) return true;
  if (/^mailto:/i.test(raw)) return true;
  if (/^data:(?:image|video)\//i.test(raw)) return true;
  if (/^blob:/i.test(raw)) return true;
  return false;
}

export function mediaKindFromSrc(src) {
  const raw = String(src ?? '').toLowerCase();
  if (!isBrowserSafeTranscriptHref(raw)) return 'file';
  if (raw.includes('kind=video')) return 'video';
  if (raw.includes('kind=image')) return 'image';
  const clean = raw.split('?')[0];
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(clean) || clean.startsWith('/api/media/')) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video';
  return 'file';
}
