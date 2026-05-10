export function truncate(value, max = 12000) {
  const text = String(value ?? '');
  return text.length > max ? text.slice(0, max) + "\n... truncated ..." : text;
}

export function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' || part?.type === 'input_text' || part?.text || part?.value)
    .map((part) => part?.text ?? part?.value ?? '')
    .filter(Boolean)
    .join('\n');
}
