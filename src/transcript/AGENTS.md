# Agent Notes

Before editing server-side transcript normalization in this folder, read `README.md`.

Keep this boundary clear:

- Server normalizers produce structured transcript data.
- Browser parsers in `public/transcript/` produce HTML.
- Filesystem access, local file existence checks, media hashing, and `/api/media/:id` creation stay server-side.
- Low-level shared helpers belong in `utils/`; parser modules should stay focused on one raw Codex shape.

When adding support for a new raw Codex item or block shape, update both sides deliberately:

- Add or update a normalizer in `src/transcript/`.
- Add or update the renderer in `public/transcript/`.
- Update the relevant README if the contract or context helpers change.
