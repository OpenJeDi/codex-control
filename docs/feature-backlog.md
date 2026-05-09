# Codex Control feature backlog

User ideas captured for later planning. Everything below is unplanned backlog unless it is already part of the current session list/content/prompt-bar implementation scope.

- Settings/session defaults screen.
- Show instruction sources and system-prompt-ish context.
- Editable developer instructions for new sessions.
- Codex config read/write with diff + confirm.
- Model/provider/reasoning/sandbox defaults.
- Account and rate-limit visibility.
- Skills, plugins, MCP, and hooks surfaces.
- Filesystem browser and watch features.
- Thread controls: fork, rollback, compact, archive, rename. Interrupt/Stop is implemented for active turns.
- Richer live streaming / follow view.

## Live observability / status chrome

- Show account usage info permanently but subtly, for example a compact status pill with account tier, quota/usage, current model, and reset date.
- Add a dedicated Live Events tab for following Codex app-server events as they happen.
- Use subtle colors and icons to distinguish event types clearly, for example status changes, turn start/finish, agent text deltas, command output, file changes, approvals, warnings, and errors.
- Keep the event stream useful for diagnosis without turning the main session transcript into noisy plumbing.

## Session model controls

- Show the model used by the active session permanently in the session UI, probably as a compact label inside or near the prompt bar.
- Make that same model label interactive: clicking it opens a dropdown to switch the model for the current session.
- The model picker should use Codex model/provider capability data where available and make the current session override clear versus global defaults.

## Prompt queue, steering, and interruption UX

Status: core behavior implemented in the session-interaction branch; remaining items are polish/follow-up unless noted in `docs/implementation-status.md`.

- Implemented: when a turn is active, normal Send queues the message for after the agent finishes and shows the queued message above the prompt bar.
- Implemented: explicit Steer action sends the draft immediately with verified `turn/steer` params and annotates the transcript.
- Implemented: clear Stop action interrupts the active turn with verified `turn/interrupt` params and renders a stopped break line.
- Follow-up polish: persist queued-message annotations across app restarts if this proves necessary.
- Avoid exposing protocol labels like `thread/start` and `thread/resume` directly in the main UI; use user-facing labels like New session, Open session, Continue, Send, Steer, Stop.
- Consider a compact compaction control/status later: expose manual compaction only if useful, and show compaction events when they happen.

## Session management actions

- Support obvious session rename action, backed by `thread/setName` / thread metadata updates as appropriate.
- Support obvious archive/unarchive actions in the session list/detail UI.
- Archived sessions should stay hidden from normal results unless archive search/filter is explicitly enabled.
- Make destructive-ish actions reversible where possible and confirm only when the consequence is not obvious.

## Rollback checkpoints

- Support rollback as a useful session action, but make the limitation explicit: Codex thread rollback may not automatically revert file changes already made in the worktree.
- Add subtle rollback buttons between turns/sections so the user can roll the conversation back to that point.
- Before rollback, show a warning and current worktree dirty state/diff summary when possible.
- Longer term, pair session rollback with optional git/file rollback helpers so model-made changes can be reverted deliberately.
- Do not prioritize forking; it does not fit the intended JeDi/Brain workflow unless a clear use case appears later.

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
- Improve existing session image rendering polish later: captions, sizing, multiple-image layout, and non-data image sources. Basic Codex structured image parts now render; this remains separate from Markdown rendering.
- Keep commands, file changes, raw JSON, and large/noisy payloads collapsible in monospace.
- Preserve inspectability while making normal Codex replies pleasant to read.
