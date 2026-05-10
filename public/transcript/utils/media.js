export function mediaKindFromSrc(src) {
  const raw = String(src ?? '').toLowerCase();
  if (raw.includes('kind=video')) return 'video';
  if (raw.includes('kind=image')) return 'image';
  const clean = raw.split('?')[0];
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(clean) || clean.startsWith('/api/media/')) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return 'video';
  return 'file';
}
