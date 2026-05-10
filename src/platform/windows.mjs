import path from 'node:path';
import { defaultWorktreeRoot, quoteWindowsCmdArg, stripPathQuotes } from './common.mjs';

const fsPath = path.win32;

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
  restartCommand({ port }) {
    return `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'node\\s+src\\\\server\\.mjs|node\\s+src/server\\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-ScheduledTask -TaskName 'codex-control'; Start-Sleep -Seconds 3; (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:${port}/api/health').StatusCode"`;
  },
};
