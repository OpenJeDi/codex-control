import path from 'node:path';
import { defaultWorktreeRoot, quoteWindowsCmdArg, stripPathQuotes } from './common.mjs';

const fsPath = path.win32;
const quotePowerShellSingle = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;

export default {
  family: 'windows',
  spawnCodexWithShell: true,
  basename: (value) => fsPath.basename(String(value ?? '')),
  dirname: (value) => fsPath.dirname(String(value ?? '')),
  joinPath: (...parts) => fsPath.join(...parts.map((part) => String(part ?? ''))),
  resolvePathFromCwd(cwd, value) {
    const cleaned = stripPathQuotes(value).replace(/\//g, '\\');
    return fsPath.resolve(String(cwd ?? ''), cleaned);
  },
  gitSafeDirectory(cwd) {
    return fsPath.resolve(String(cwd ?? ''));
  },
  defaultWorktreeRoot(sourcePath) {
    return defaultWorktreeRoot(fsPath, sourcePath);
  },
  displayGitWorktreeAddCommand(sourcePath, targetPath, branch, { branchExists = false } = {}) {
    return branchExists
      ? `git -C ${quoteWindowsCmdArg(sourcePath)} worktree add ${quoteWindowsCmdArg(targetPath)} ${quoteWindowsCmdArg(branch)}`
      : `git -C ${quoteWindowsCmdArg(sourcePath)} worktree add -b ${quoteWindowsCmdArg(branch)} ${quoteWindowsCmdArg(targetPath)}`;
  },
  restartCommand({ port, restartTaskName = '' }) {
    return `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/restart-codex-control.ps1 -HealthUrl ${quotePowerShellSingle(`http://127.0.0.1:${port}/api/health`)}${restartTaskName ? ` -TaskName ${quotePowerShellSingle(restartTaskName)}` : ''}`;
  },
};
