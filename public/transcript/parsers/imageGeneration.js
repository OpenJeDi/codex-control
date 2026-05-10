function toImagesHtml(images = [], context = {}) {
  const escapeHtml = context.escapeHtml || ((value) => String(value ?? ''));
  const escapeAttribute = context.escapeAttribute || ((value) => String(value ?? ''));
  const renderImage = (image, index) => {
    const src = String(image?.src ?? '').trim();
    if (!src) return '';
    const caption = image.filename || image.alt || `generated-image-${index + 1}`;
    return `<figure class="session-image">
      <img src="${escapeAttribute(src)}" alt="${escapeAttribute(caption)}" loading="lazy">
      <figcaption>${escapeHtml(caption)}</figcaption>
    </figure>`;
  };
  return images.map(renderImage).filter(Boolean).join('');
}

export const imageGenerationParser = {
  canRender(block) {
    const type = String(block?.kind || block?.type || '').toLowerCase();
    return type === 'imagegeneration';
  },
  render(block, context = {}) {
    if (!block) return '';
    const escapeHtml = context.escapeHtml || ((value) => String(value ?? ''));
    const images = Array.isArray(block.images) ? block.images : [];
    const gallery = toImagesHtml(images, context);
    const prompt = String(block.prompt || '').trim();
    const details = String(block.raw || block.text || '').trim();
    return `<div class="item-block item-block--image-generation">
      ${prompt ? `<p class="image-generation-prompt">${escapeHtml(prompt)}</p>` : ''}
      ${gallery ? `<div class="image-generation-preview">${gallery}</div>` : ''}
      ${details ? `<details class="item-block-details">
        <summary>Raw image-generation block</summary>
        <pre>${escapeHtml(details)}</pre>
      </details>` : ''}
    </div>`;
  },
};
