# Releasing

Use this checklist before publishing Codex Control publicly.

## Current Tree

- Run the app with `CODEX_CONTROL_READ_ONLY=1`.
- Confirm write controls are hidden in the UI.
- Confirm mutating API routes return `403` in read-only mode.
- Confirm `CODEX_CONTROL_FILE_SERVING=session` is the default.
- Confirm `CODEX_CONTROL_FILE_SERVING=system` is documented as trusted-machine only.
- Run syntax checks:

```powershell
node --check src\server.mjs
node --check public\app.js
git diff --check
```

## Public Content Scan

Scan the current tree for:

- personal usernames and email domains
- absolute home-directory paths
- private hostnames, tunnel URLs, and machine names
- internal project or workflow names
- scheduled-task and compatibility-shim paths
- smoke-test session/thread IDs
- copied third-party documentation
- secret-like tokens, API keys, private keys, and bearer credentials

## Git History

The current tree is public-safe, but old commits still contain private local development details. Before pushing to a public GitHub repository, complete `docs/public-release-history-cleanup.md`.

Recommended public-release path:

1. Create a fresh public branch from the cleaned tree, or rewrite history to remove private details.
2. Run the full current-tree and all-refs scans again.
3. Verify no copied app-server docs remain in history.
4. Verify private handoff notes are outside the repository.
5. Push only after the history scan is clean.
