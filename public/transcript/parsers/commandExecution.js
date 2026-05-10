export const commandExecutionParser = {
  canRender(item) {
    return item?.type === 'commandExecution';
  },
  render(item, context = {}, renderContext = {}) {
    const escapeHtml = context.escapeHtml || ((value) => String(value ?? ''));
    const escapeAttribute = context.escapeAttribute || ((value) => String(value ?? ''));
    const label = renderContext.label || 'Command';
    const command = String(item?.command ?? item?.cmd ?? item?.argv?.join(' ') ?? '').trim();
    const output = String(item?.output ?? item?.stdout ?? item?.stderr ?? '');
    const body = command ? `$ ${command}\n\n${output}` : String(item?.text ?? output ?? '');
    const preview = body.slice(0, 220).replace(/\s+/g, ' ').trim();

    return `<article class="item ${escapeAttribute(item?.type || 'commandExecution')} compact-item">
      <details>
        <summary>
          <span>${escapeHtml(label)}</span>
          <small>${escapeHtml(preview || 'expand details')}</small>
        </summary>
        <pre>${escapeHtml(body)}</pre>
      </details>
    </article>`;
  },
};
