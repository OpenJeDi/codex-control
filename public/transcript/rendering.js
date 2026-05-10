import { escapeAttribute, escapeHtml } from './utils/html.js';
import { mediaKindFromSrc } from './utils/media.js';

export { escapeAttribute, escapeHtml, mediaKindFromSrc };

export function renderSessionImageFigure(src, caption = '', alt = 'Session image') {
  return `<figure class="session-image"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt || caption || 'Session image')}" loading="lazy"><figcaption>${escapeHtml(caption || 'image')}</figcaption></figure>`;
}

export function renderCompactDetailsItem({ type = 'item', label = 'Item', body = '', preview = '', className = '' } = {}) {
  const itemClass = ['item', type, 'compact-item', className].filter(Boolean).join(' ');
  const summary = preview || String(body ?? '').slice(0, 220).replace(/\s+/g, ' ').trim() || 'expand details';
  return `<article class="${escapeAttribute(itemClass)}">
    <details>
      <summary>
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml(summary)}</small>
      </summary>
      <pre>${escapeHtml(body)}</pre>
    </details>
  </article>`;
}

export function renderMarkdownMedia(src, label = '', embedded = false) {
  const cleanSrc = String(src ?? '').trim().replace(/^["']|["']$/g, '');
  const caption = escapeHtml(label || 'media');
  const kind = mediaKindFromSrc(cleanSrc);
  if (embedded && kind === 'image') {
    return renderSessionImageFigure(cleanSrc, label || 'media', label || 'Session image');
  }
  if (embedded && kind === 'video') {
    return `<figure class="session-image session-video"><video src="${escapeAttribute(cleanSrc)}" controls preload="metadata"></video><figcaption>${caption}</figcaption></figure>`;
  }
  return `<a href="${escapeAttribute(cleanSrc)}" target="_blank" rel="noreferrer">${escapeHtml(label || cleanSrc)}</a>`;
}

export function renderInlineMarkdown(text) {
  const codeSpans = [];
  const media = [];
  const pushCodeSpan = (code) => {
    const token = `@@CODE${codeSpans.length}@@`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  };
  let html = String(text ?? '').replace(/`([^`]+)`/g, (_match, code) => {
    return pushCodeSpan(code);
  }).replace(/<code>([\s\S]*?)<\/code>/gi, (_match, code) => {
    return pushCodeSpan(code);
  }).replace(/!\[([^\]\n]*)\]\(([^)\n]+)\)/g, (_match, alt, src) => {
    const token = `@@MEDIA${media.length}@@`;
    media.push(renderMarkdownMedia(src, alt, true));
    return token;
  });
  html = escapeHtml(html);
  for (const [index, code] of codeSpans.entries()) html = html.replace(`@@CODE${index}@@`, code);
  html = html.replace(/\[([^\]\n]+)\]((?:\()([^)]+)(?:\)))/g, (_match, label, _wrapped, url) => renderMarkdownMedia(url, label, false));
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  for (const [index, rendered] of media.entries()) html = html.replace(`@@MEDIA${index}@@`, rendered);
  return html;
}

export function renderMarkdownBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(`<${list.type}>${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 2;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2].trim())}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== 'ul') list = { type: 'ul', items: [] };
      list.items.push(bullet[1]);
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (!list || list.type !== 'ol') list = { type: 'ol', items: [] };
      list.items.push(numbered[1]);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks.join('') || '<p></p>';
}

export function renderCodeBlockContent(code) {
  const source = String(code ?? '');
  const pathPattern = /((?:[a-zA-Z]:[\\/]|\\\\)[^\s`<>()\[\]{}]+)/g;
  let html = '';
  let lastIndex = 0;
  for (const match of source.matchAll(pathPattern)) {
    const rawMatch = match[1];
    const start = match.index ?? 0;
    const rawPath = rawMatch.replace(/[.,;:]+$/g, '');
    const suffix = rawMatch.slice(rawPath.length);
    html += escapeHtml(source.slice(lastIndex, start));
    html += `<a class="code-file-link" href="/api/media/path?path=${encodeURIComponent(rawPath)}" target="_blank" rel="noreferrer">${escapeHtml(rawPath)}</a>${escapeHtml(suffix)}`;
    lastIndex = start + rawMatch.length;
  }
  html += escapeHtml(source.slice(lastIndex));
  return html;
}

export function renderMarkdownText(text) {
  const segments = String(text ?? '').replace(/\r\n/g, '\n').split(/```/);
  return `<div class="markdown-body">${segments.map((segment, index) => {
    if (index % 2 === 1) {
      const code = segment.replace(/^\w+\n/, '');
      return `<pre class="md-code"><button type="button" class="copy-code" title="Copy code" aria-label="Copy code">Copy</button><code>${renderCodeBlockContent(code)}</code></pre>`;
    }
    return renderMarkdownBlocks(segment);
  }).join('')}</div>`;
}

export function shouldRenderMarkdown(item) {
  return item?.type === 'userMessage' || item?.type === 'agentMessage' || item?.type === 'reasoning';
}

export function renderContentParts(item, fallbackBody) {
  const renderText = (text) => shouldRenderMarkdown(item) ? renderMarkdownText(text) : `<pre>${escapeHtml(text)}</pre>`;
  if (!Array.isArray(item?.parts) || !item.parts.length) return renderText(fallbackBody);
  return item.parts.map((part) => {
    if (part.type === 'text') return part.text ? renderText(part.text) : '';
    if (part.type === 'image') {
      return renderSessionImageFigure(part.src, part.contentType || 'image', 'Attached session image');
    }
    if (part.type === 'unsupportedImage') return '<div class="unsupported-media">Image omitted: unsupported source</div>';
    return '';
  }).join('');
}

export function bindCodeCopyControls(container) {
  container?.querySelectorAll('.copy-code').forEach((button) => {
    button.onclick = async () => {
      const code = button.parentElement?.querySelector('code')?.textContent ?? '';
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      } catch {
        window.alert('Could not copy code.');
      }
    };
  });
}

export function bindSessionImageViewer(container, openImageLightbox) {
  container?.querySelectorAll('.session-image img, .queued-attachments img').forEach((image) => {
    image.addEventListener('click', () => openImageLightbox?.(image.src, image.alt || 'Session image'));
  });
}

export function createTranscriptRenderContext() {
  return {
    escapeHtml,
    escapeAttribute,
    mediaKindFromSrc,
    renderSessionImageFigure,
    renderCompactDetailsItem,
    renderMarkdownMedia,
    renderInlineMarkdown,
    renderMarkdownBlocks,
    renderCodeBlockContent,
    renderMarkdownText,
    shouldRenderMarkdown,
    renderContentParts,
  };
}
