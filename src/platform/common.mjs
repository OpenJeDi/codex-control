export function stripPathQuotes(value) {
  return String(value ?? '').trim().replace(/^["']|["']$/g, '');
}

export function quotePosixShellArg(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

export function quoteWindowsCmdArg(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function defaultWorktreeRoot(fsPath, sourcePath) {
  const base = fsPath.basename(String(sourcePath ?? ''));
  const parent = fsPath.dirname(String(sourcePath ?? ''));
  const parentBase = fsPath.basename(parent).toLowerCase();
  if (parentBase.endsWith('-worktrees') || parentBase === 'worktrees') return parent;
  if (['main', 'master', 'develop'].includes(base.toLowerCase()) && parentBase === 'worktrees') return parent;
  return fsPath.join(parent, `${base}-worktrees`);
}
