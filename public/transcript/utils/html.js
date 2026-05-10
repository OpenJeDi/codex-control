export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}[ch]));

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}
