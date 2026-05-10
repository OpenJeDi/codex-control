# Agent Notes

Before editing transcript parser or renderer code in this folder, read `README.md`.

Keep parser modules focused:

- One item or block shape per file under `parsers/`.
- Register parsers in `registry.js`.
- Put shared Markdown, media, HTML, code-block, content-part, and binding helpers in `rendering.js`.
- Keep filesystem access and local media resolution in `src/server.mjs`; browser parsers should render normalized data only.
- Preserve fallback behavior in `public/app.js` for Markdown, local media links, code blocks, intermediate activity, prompt/response summaries, and copy buttons.

When adding parser support, update `README.md` if the parser contract, render context helpers, or server/client ownership rules change.
