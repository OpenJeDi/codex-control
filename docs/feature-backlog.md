# Codex Control feature backlog

User ideas captured for later planning. Everything below is unplanned backlog unless it is already part of the current session list/content/prompt-bar implementation scope.

- Settings/session defaults screen.
- Show instruction sources and system-prompt-ish context.
- Editable developer instructions for new sessions.
- Codex config read/write with diff + confirm.
- Model/provider/reasoning/sandbox defaults. Implemented for permissions: browser-local global defaults plus per-session overrides survive Codex Control server restarts.
- Account and rate-limit visibility, including explicit credit-exhausted/account-blocked states when a session cannot continue.
- Skills, plugins, MCP, and hooks surfaces.
- Filesystem browser and watch features.
- Repository setup flow: actually clone a repo into the expected local worktree structure, then create/select the first lane worktree. Current Add repository only adds a repo URL/owner-name to the browser-local picker and assumes the local repo/worktrees already exist.
- Configurable session workflow templates: repo/worktree-first remains the default local workflow, but the New Session dialog should eventually load workflow rules from config instead of hardcoding repo/worktree placement and branch naming.
- Thread controls: fork, rollback, compact. Rename and archive are implemented in the detail view; Interrupt/Stop and Steer are implemented for active turns, including stale-busy-state clearing when app-server has no active turn.
- Richer live streaming / follow view.
- Improve the development restart endpoint behavior: `/api/codex/restart` should respond quickly, restart asynchronously, and expose clear progress/health state so callers do not appear to hang.

## Live observability / status chrome

- Show account usage info permanently but subtly, for example a compact status pill with account tier, quota/usage, current model, and reset date.
- Implemented: compact Recent events block in the detail view for useful in-memory thread/turn/control events.
- Follow-up: add a dedicated Live Events tab only if the compact block is not enough.
- Follow-up: use subtle colors/icons for status changes, turn start/finish, approvals, warnings, and errors; keep agent deltas/token-usage noise out of the main timeline.
- Keep the event stream useful for diagnosis without turning the main session transcript into noisy plumbing.

## Session model controls

- Implemented: show the model used by the active session in the session UI, with source-aware status (`thread.modelSource`) visible in session/turn rendering.
- Implemented: model and thinking controls in the new-session modal and existing-session composer. These are browser-local defaults plus per-session preferences and are sent as `turn/start` overrides for the next normal turn.
- Implemented: model choices are loaded from Codex app-server `model/list` when available, with a static fallback. The effective config value is selected directly in the dropdown and a subtle source dot distinguishes inherited config values from explicit overrides.
- Remaining: make unavailable/unsupported provider combinations explicit when Codex exposes enough provider capability data.

## Prompt queue, steering, interruption, and approval UX

Status: core behavior is implemented; remaining items are polish/follow-up unless noted in `docs/implementation-status.md`.

- Implemented: when a turn is active, normal Send queues the message for after the agent finishes and shows the queued message above the prompt bar.
- Implemented: explicit Steer action sends the draft immediately with verified `turn/steer` params and annotates the transcript.
- Implemented: clear Stop action interrupts the active turn with verified `turn/interrupt` params, renders a stopped break line, and clears stale local busy state when app-server has no active turn.
- Follow-up polish: persist queued-message annotations across app restarts if this proves necessary.
- Implemented: app-server approval request notifications mark the session as approval-blocked and show an explicit warning that Codex Control cannot answer approval prompts yet.
- Follow-up: add full approval UX for app-server command/file/tool approval prompts and credit/rate-limit/account-blocked states. Approval prompts should send decisions back to app-server; account/credit blocks should be shown as actionable blocking states with recovery guidance.
- Avoid exposing protocol labels like `thread/start` and `thread/resume` directly in the main UI; use user-facing labels like New session, Open session, Continue, Send, Steer, Stop.
- Consider a compact compaction control/status later: expose manual compaction only if useful, and show compaction events when they happen.

## Session management actions

- Implemented: obvious session rename action backed by verified `thread/name/set` with `{ threadId, name }`.
- Implemented: archive from the detail UI backed by verified `thread/archive` with `{ threadId }`; unarchive is available through the API and the archive filter/recovery path, but not yet polished as an obvious list-row action.
- Archived sessions should stay hidden from normal results unless archive search/filter is explicitly enabled.
- Make destructive-ish actions reversible where possible and confirm only when the consequence is not obvious.

## Rollback checkpoints

- Support rollback as a useful session action, but make the limitation explicit: Codex thread rollback may not automatically revert file changes already made in the worktree.
- Add subtle rollback buttons between turns/sections so the user can roll the conversation back to that point.
- Before rollback, show a warning and current worktree dirty state/diff summary when possible.
- Longer term, pair session rollback with optional git/file rollback helpers so model-made changes can be reverted deliberately.
- Do not prioritize forking unless a clear use case appears later.

## Explicitly out of current scope

- Do not handle skills, plugins, MCP, or hooks for now.
- Do not handle review workflows for now.
- Do not expose the Codex FileSystem API as a general UI for now.
- Revisit these only after the core session list, prompt bar, live status/events, worktree/session creation, and instruction/model controls are solid.

## Visual design direction

- Move away from the current blue-accent theme toward a calmer grey/dark-neutral interface, closer to Cinny's feel.
- Use color sparingly for semantic state only: success, warning, error, active/running, approval-needed.
- Keep the UI dense, quiet, and readable rather than dashboard-bright.

## Transcript rendering polish

- Improve the basic safe Markdown renderer: richer tables/blockquotes/task lists if they become useful, without making command/raw payload rendering noisy.
- Improve existing session image rendering polish later: captions, sizing, and multiple-image layout. Basic Codex structured image parts, Markdown local image/video links, and absolute local file links now render/link through media endpoints.
- Keep commands, file changes, raw JSON, and large/noisy payloads collapsible in monospace.
- Preserve inspectability while making normal Codex replies pleasant to read.
