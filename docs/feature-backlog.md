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
