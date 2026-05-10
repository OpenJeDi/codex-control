# Agent Instructions

This file is for coding agents working in this repository. It is not user-facing product documentation.

## Documentation Rules

- Keep `README.md` focused on end-user usage, safety, setup, configuration, and troubleshooting.
- Put human maintainer and contributor notes in `DEVELOPMENT.md`.
- Put agent-only workflow notes in this file.
- Do not add private handoff notes, local machine paths, hostnames, smoke thread IDs, or personal workflow names to tracked docs.
- Do not vendor OpenAI Codex app-server docs. Link to the official page instead: https://developers.openai.com/codex/app-server

## Public Release Hygiene

- Keep current-tree docs public-safe.
- Update `docs/public-release-history-cleanup.md` when new history rewrite risks are discovered.
- Before public release, scan all refs for personal paths, hostnames, internal workflow names, smoke IDs, copied docs, and secret-like tokens.

## Safety Expectations

- Preserve `CODEX_CONTROL_READ_ONLY=1` behavior when changing routes or UI controls.
- Every new mutating API route must call the server-side write-access guard.
- Every new write control in the UI must be hidden or disabled in read-only mode.
- Treat local file/media serving as sensitive when the app is reachable beyond loopback.

## Working Style

- Keep changes scoped and commit coherent checkpoints often.
- Prefer existing code patterns over new abstractions.
- Use `rg` for searches.
- Use `apply_patch` for manual edits.
- Run `node --check src\server.mjs`, `node --check public\app.js`, and `git diff --check` before committing JS/server changes.
