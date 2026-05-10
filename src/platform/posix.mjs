import path from 'node:path';
import { defaultWorktreeRoot, quotePosixShellArg, stripPathQuotes } from './common.mjs';

const fsPath = path.posix;

export default {
  family: process.platform === 'darwin' ? 'macos' : 'linux',
  spawnCodexWithShell: false,
  basename: (value) => fsPath.basename(String(value ?? '')),
  dirname: (value) => fsPath.dirname(String(value ?? '')),
  joinPath: (...parts) => fsPath.join(...parts.map((part) => String(part ?? ''))),
  resolvePathFromCwd(cwd, value) {
    return fsPath.resolve(String(cwd ?? ''), stripPathQuotes(value));
  },
  gitSafeDirectory(cwd) {
    return fsPath.resolve(String(cwd ?? ''));
  },
  defaultWorktreeRoot(sourcePath) {
    return defaultWorktreeRoot(fsPath, sourcePath);
  },
  displayGitWorktreeAddCommand(sourcePath, targetPath, branch, { branchExists = false } = {}) {
    return branchExists
      ? `git -C ${quotePosixShellArg(sourcePath)} worktree add ${quotePosixShellArg(targetPath)} ${quotePosixShellArg(branch)}`
      : `git -C ${quotePosixShellArg(sourcePath)} worktree add -b ${quotePosixShellArg(branch)} ${quotePosixShellArg(targetPath)}`;
  },
  restartCommand() {
    return '';
  },
};
