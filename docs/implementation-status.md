# Implementation Status

This document is a public-safe snapshot of the current implementation. Private continuation notes, local smoke-test IDs, hostnames, and machine-specific paths should stay outside the repository.

## Implemented

- Session list via `codex app-server` `thread/list`
- Repo-scoped browsing from `thread.gitInfo.originUrl`
- Repo picker with browser-local custom repositories
- Search, filter drawer, archive toggle, and optional branch grouping
- Thread detail view via `thread/read` and `thread/turns/list`
- New-session modal from a selected worktree
- Session-first new-session flow with session naming, matching worktree suggestion, and chat-only sessions without a repository worktree
- Duplicate-session prevention for worktrees that already have an attached session
- Worktree planning and branch worktree creation
- First prompts and follow-up prompts with multipart attachments
- Local image attachments passed to Codex as `localImage`
- Structured Codex image parts rendered through local media endpoints
- Basic safe Markdown rendering for normal user, agent, and reasoning text
- Live refresh through Codex notifications and session-file watching
- Model and reasoning-effort display with Codex/config provenance
- Model, reasoning effort, sandbox, approval, and network controls for future normal turns
- Stop active turns through `turn/interrupt`
- Steer active turns through `turn/steer`
- Queued follow-up prompts while a turn is active
- Rename, archive, and unarchive session actions
- Compact in-memory recent events for useful thread, turn, and control events
- Runtime diagnostics for local write access and Git metadata access
- Development restart helper for restarting the local Node server
- Restart helper refuses by default while sessions are active, because the current Node process owns its `codex app-server` child process
- Read-only mode that disables mutating API routes and hides write controls
- Optional built-in HTTP Basic Auth for all non-health routes
- Local file/media links scoped to session permissions, with explicit system-wide opt-in
- Missing local media files return HTTP errors instead of crashing the server

## Known Gaps

- Approval request notifications are detected, but full approval decision UX is not implemented.
- Queued-message, recent-event, and sent-image fallback annotations are in-memory only.
- Account, rate-limit, and blocked-state diagnostics need clearer first-class UI.
- Worktree creation assumes a simple branch-worktree workflow and should become more configurable before broader use.
- Restart behavior is local-development oriented and should remain disabled or explicitly configured in deployed environments.
- Codex Control cannot yet restart only the Node/web layer while keeping active Codex turns alive; that needs external/reused app-server mode.
- Exposed deployments need explicit authentication/network controls; use read-only mode when viewers should not be able to mutate sessions or worktrees.
- `CODEX_CONTROL_FILE_SERVING=system` intentionally weakens local file isolation and should only be used on trusted machines.

## Protocol Notes

Do not guess app-server method names. Verify against the installed `codex app-server` or the official docs before adding controls for rollback, fork, compaction, approvals, or account flows.

Official reference:

- https://developers.openai.com/codex/app-server
