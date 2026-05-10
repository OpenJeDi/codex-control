# Public Release History Cleanup

This repository has been cleaned in the current tree, but the existing Git history still contains local development details. Before publishing this repository publicly, rewrite or replace the history so those details are not exposed in old commits.

## Required Before Public Release

- Rewrite history or publish from a fresh squashed branch.
- Remove personal absolute paths from old commits.
- Remove private hostnames and tunnel/review URLs from old commits.
- Remove Windows Scheduled Task and compatibility-shim operational notes from old commits.
- Remove internal workflow names and project-specific labels from old commits.
- Remove smoke-test thread IDs and local temporary test paths from old commits.
- Remove the old vendored copy of the Codex app-server documentation from history, leaving only the official docs link.
- Remove the old tracked `docs/development-handoff.md` from history; private handoff notes should stay outside the repository.

## Commits To Inspect

These commits were identified during the current cleanup sweep as containing public-release-sensitive history:

- `e312dadc5f2eb0a375c2df88a06bb7b321804863`
- `bb8d9be854d34c8524040a77ed09acf9531df7e0`
- `a4fe8fad24bb2f850f1bec6fcadead4893c30e8d`
- `b6a5cf8ca7bf930603fef4f4d7d8521be6658465`
- `a5ab8b30cdfeecfb8020a23f1d1097e0a2f1a66e`
- `a4b9b00ac15302fb56b7b7be1ca3981532247ae3`
- `905c998be867764a743b0d5c521ad4bc223cfe87`
- `f09537d86e8fdc840e3e28ad75540174db541915`

## Verification Search

After rewriting history, scan all refs for:

- personal usernames and email domains
- absolute home-directory paths
- private hostnames, tunnel URLs, and machine names
- internal project or workflow names
- scheduled-task and shim paths
- smoke-test session/thread IDs
- copied third-party documentation
- secret-like tokens, API keys, private keys, and bearer credentials

The current sweep did not find real credentials, but history should still be scanned again after rewriting.
