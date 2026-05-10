# Transcript Normalization

This folder owns server-side transcript normalization for Codex Control.

The browser can render normalized transcript items and blocks, but it cannot resolve local filesystem paths. Any Codex protocol shape that references local files must be handled here before it reaches `public/transcript/`.

## Main Files

- `normalize.js`: normalizes Codex turns and items into stable client-facing transcript shapes.
- `media.js`: resolves local files, data URLs, and local path mentions into `/api/media/:id` URLs.
- `parsers/`: focused normalizers for raw Codex item/block shapes.

## Normalization Flow

`src/server.mjs` creates shared media helpers with the server-owned `mediaById` map, then creates a transcript normalizer with those helpers plus model/effort extractors.

The normalizer:

- preserves prompt, response, reasoning, command, and attachment behavior;
- rewrites agent local file references into served `/api/media/:id` links;
- normalizes image content parts into browser-renderable media parts;
- delegates specialized raw shapes, such as image generation, to parser modules;
- returns `item.renderBlocks` for structured blocks that the browser should render with `public/transcript/parsers/`.

## Adding A Server Normalizer

Add a parser module under `src/transcript/parsers/`:

```js
export const exampleNormalizer = {
  canNormalize(item) {
    return item?.type === 'example';
  },
  normalize(item, context = {}) {
    return [{
      kind: 'example',
      raw: context.truncate(JSON.stringify(item, null, 2), 6000),
    }];
  },
};
```

Register it in `normalize.js`:

```js
import { exampleNormalizer } from './parsers/example.js';

const blockNormalizers = [
  imageGenerationNormalizer,
  exampleNormalizer,
];
```

Then add the matching browser block parser under `public/transcript/parsers/`.

## Context Helpers

Normalizer modules receive a context object with:

- `cwd`: the thread working directory for relative path resolution.
- `truncate(value, max)`: truncates large raw fields before sending to the browser.
- `mediaFromDataUrl(dataUrl)`: stores data URL media and returns a served media object.
- `mediaFromLocalFilePath(filePath)`: stores local file media and returns a served media object.
- `resolveMentionedFilePath(rawPath, cwd)`: resolves absolute or thread-relative file mentions.
- `rewriteLocalFileReferences(text, cwd)`: rewrites local media mentions in Markdown-ish text.
- `extractModelFromPayload(value)`: reads model metadata for turns.
- `extractEffortFromPayload(value)`: reads reasoning effort metadata for turns.

## Ownership Rules

- Keep filesystem access in server modules only.
- Keep browser-facing shapes small and stable.
- Include raw JSON behind a disclosure when it helps debugging, but truncate it.
- Return `null` from a normalizer when the item does not produce useful render blocks.
- Do not emit HTML from server normalizers; emit structured data for the client parser layer.

## Verification

For normalization changes, run at least:

```powershell
node --check src\server.mjs
node --check src\transcript\normalize.js
node --check src\transcript\media.js
node --check src\transcript\parsers\<parser>.js
git diff --check
```

For new transcript block support, also verify the matching browser parser and a real rendered transcript.
