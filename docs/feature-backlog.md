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
- Thread controls: fork, rollback, compact, archive, rename, interrupt.
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

- Match the Codex app / VS Code steering model: when a turn is active, normal send queues the message for after the agent finishes.
- Show queued messages above the prompt bar so the user can see what will be sent next.
- Provide an explicit Steer button/action that sends the draft immediately as a `turn/steer` prompt against the active turn.
- Provide a clear Stop button for interrupting the active turn via `turn/interrupt`.
- Avoid exposing protocol labels like `thread/start` and `thread/resume` directly in the main UI; use user-facing labels like New session, Open session, Continue, Send, Steer, Stop.
- Consider a compact compaction control/status later: expose manual compaction only if useful, and show compaction events when they happen.
