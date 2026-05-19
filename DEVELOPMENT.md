# Development

This file is for humans working on Codex Control itself. End-user setup and usage live in `README.md`.

## Local Development

```powershell
npm install
npm run dev
```

Open <http://127.0.0.1:4567>.

Local machine settings can live in `.env`. The file is intentionally ignored by Git; keep reusable examples in `.env.example`.

## Restarting During Development

```powershell
npm run restart
```

The restart helper stops existing `node src/server.mjs` processes, starts the server again, and checks `/api/health`.

On Windows, set `CODEX_CONTROL_RESTART_TASK` to start an existing Scheduled Task instead of launching `node src/server.mjs` directly.

To stop the local service without restarting it:

```powershell
npm stop
```

The stop helper uses the same active-session safety check as restart. Use `npm run stop:windows:force` only when interrupting active turns is intentional.

## Operational Gotchas

- If sessions fail before the app receives useful output, check external account state before debugging the UI or server. Exhausted Codex/OpenAI credits, quota limits, expired auth, or model access changes can present as local app hangs or startup failures.

## Checks

Run focused checks before committing code changes:

```powershell
node --check src\server.mjs
node --check public\app.js
git diff --check
```

For UI changes, also verify the rendered browser state. Served JS/CSS text alone is not enough for layout or interaction changes.

## Documentation Boundaries

- `README.md`: user-facing setup, usage, safety notes, and configuration.
- `DEVELOPMENT.md`: human contributor and maintainer notes.
- `AGENTS.md`: agent-only instructions that should not be part of normal user docs.
- `docs/implementation-status.md`: public-safe implementation snapshot.
- `docs/public-release-history-cleanup.md`: private-release checklist until history is rewritten.

Keep private paths, hostnames, smoke thread IDs, local task names, and continuation handoff notes outside the repository.
