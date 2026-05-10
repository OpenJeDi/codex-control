# Transcript Rendering

This folder owns the browser-side transcript rendering extension points for Codex Control.

The server still owns filesystem-aware normalization in `src/server.mjs`. Anything that needs local file access, media IDs, or path resolution should be normalized there before it reaches this browser code.

## Main Files

- `registry.js`: registers item parsers and block parsers, then creates render functions for `public/app.js`.
- `rendering.js`: shared HTML, Markdown, media, code-block, content-part, and DOM binding helpers.
- `parsers/`: focused parser modules, one transcript item or block shape per file.

## Rendering Layers

There are two parser layers:

- Item parsers receive one normalized transcript item and may return a full `<article class="item ...">...</article>`.
- Block parsers receive one entry from `item.renderBlocks` and return an HTML fragment embedded inside the default item shell.

Use an item parser when a whole normalized transcript item needs custom markup. `commandExecution` is the current example.

Use a block parser when the default item shell should stay intact, but one structured block inside the item needs special rendering. `imageGeneration` is the current example.

If no parser matches, `public/app.js` keeps the normal fallback behavior for Markdown, media links, code blocks, noisy raw payloads, prompt/response summaries, intermediate activity, and copy buttons.

## Parser Contract

Each parser exports an object with this shape:

```js
export const exampleParser = {
  canRender(entry) {
    return entry?.type === 'example';
  },
  render(entry, context, renderContext) {
    return '<div>...</div>';
  },
};
```

Rules:

- `canRender(entry)` must be cheap and side-effect free.
- `render(entry, context, renderContext)` returns an HTML string.
- Return `''` when there is nothing useful to render.
- Do not attach event listeners inside parsers.
- Do not access the filesystem from parsers.
- Escape untrusted text with `context.escapeHtml`.
- Escape attribute values with `context.escapeAttribute`.
- Prefer shared helpers from `context` over copying markup.

`renderContext` is currently the same object as `entry`. It exists so the registry can pass additional per-render metadata later without changing parser signatures.

## Render Context Helpers

`createTranscriptRenderContext()` from `rendering.js` provides these helpers to parsers and default UI rendering:

- `escapeHtml(value)`: escape text content.
- `escapeAttribute(value)`: escape attribute values.
- `mediaKindFromSrc(src)`: classify image, video, or file URLs.
- `renderSessionImageFigure(src, caption, alt)`: render standard clickable transcript image markup.
- `renderCompactDetailsItem({ type, label, body, preview, className })`: render the standard compact `<details>` item shell.
- `renderMarkdownMedia(src, label, embedded)`: render Markdown-linked media or anchors.
- `renderInlineMarkdown(text)`: render inline Markdown subset.
- `renderMarkdownBlocks(text)`: render paragraph/list/heading Markdown subset.
- `renderCodeBlockContent(code)`: render code block content with local absolute path links.
- `renderMarkdownText(text)`: render full Markdown text, including copy-code buttons.
- `shouldRenderMarkdown(item)`: decide whether text parts should use Markdown.
- `renderContentParts(item, fallbackBody)`: render normalized `item.parts`.

DOM binding helpers also live in `rendering.js`, but they are used by `public/app.js`, not parser modules:

- `bindCodeCopyControls(container)`
- `bindSessionImageViewer(container, openImageLightbox)`

## Adding A Block Parser

Normalize the raw shape server-side first:

```js
// src/server.mjs, inside normalizeTranscriptItem(...)
return {
  ...base,
  text: truncate(JSON.stringify(item, null, 2), 6000),
  renderBlocks: [{
    kind: 'exampleBlock',
    title: item.title,
    raw: truncate(JSON.stringify(item, null, 2), 6000),
  }],
};
```

Add `public/transcript/parsers/exampleBlock.js`:

```js
export const exampleBlockParser = {
  canRender(block) {
    return String(block?.kind || block?.type || '').toLowerCase() === 'exampleblock';
  },
  render(block, context = {}) {
    const title = String(block?.title || '').trim();
    const raw = String(block?.raw || '').trim();
    return `<div class="item-block item-block--example">
      ${title ? `<p>${context.escapeHtml(title)}</p>` : ''}
      ${raw ? `<details class="item-block-details">
        <summary>Raw example block</summary>
        <pre>${context.escapeHtml(raw)}</pre>
      </details>` : ''}
    </div>`;
  },
};
```

Register it in `registry.js`:

```js
import { exampleBlockParser } from './parsers/exampleBlock.js';

addParser(blockParsers, exampleBlockParser);
```

## Adding An Item Parser

Use an item parser when the parser owns the whole item shell:

```js
export const exampleItemParser = {
  canRender(item) {
    return item?.type === 'exampleItem';
  },
  render(item, context = {}) {
    const body = String(item?.text || '');
    return context.renderCompactDetailsItem({
      type: item?.type || 'exampleItem',
      label: 'Example item',
      body,
    });
  },
};
```

Register it in `registry.js`:

```js
import { exampleItemParser } from './parsers/exampleItem.js';

addParser(itemParsers, exampleItemParser);
```

## Server And Client Ownership

Keep this boundary intact:

- Server: detect raw Codex protocol shapes, resolve local files, create `/api/media/:id` URLs, truncate raw JSON, and normalize data into stable item/block fields.
- Client parsers: choose markup for already-normalized item/block shapes.
- `public/app.js`: orchestrate transcript rendering, detail refresh, lightbox state, copy-button binding, and other page-level behavior.

If a parser needs a helper that should be shared, add it to `rendering.js` and include it in `createTranscriptRenderContext()`.

## Verification

For parser or rendering changes, run at least:

```powershell
node --check public\app.js
node --check public\transcript\registry.js
node --check public\transcript\rendering.js
node --check public\transcript\parsers\<parser>.js
git diff --check
```

For user-visible UI changes, also load a thread containing the relevant item/block shape and verify the rendered transcript in the browser.
