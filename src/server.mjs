import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const port = Number(process.env.PORT || 4567);
const host = process.env.HOST || '127.0.0.1';
const maxBodyBytes = 75 * 1024 * 1024;
const mediaById = new Map();

class CodexAppServer {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.statusByThread = new Map();
    this.activeTurnByThread = new Map();
    this.queuedMessagesByThread = new Map();
    this.steeredMessagesByThread = new Map();
    this.eventsByThread = new Map();
    this.eventClients = new Set();
    this.watchers = [];
    this.threadsChangedTimer = null;
    this.pendingChangedThreadIds = new Set();
    this.ready = this.start();
  }

  start() {
    this.proc = spawn('codex', ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    this.proc.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.warn('[codex]', text);
    });

    this.proc.on('exit', (code, signal) => {
      const err = new Error(`codex app-server exited (${code ?? signal})`);
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(err);
      }
      this.pending.clear();
      this.broadcast('codex-exit', { code, signal });
      this.ready = Promise.reject(err);
    });

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => this.handleLine(line));

    return this.request('initialize', {
      clientInfo: {
        name: 'codex_control',
        title: 'Codex Control',
        version: '0.1.0',
      },
    }).then((result) => {
      this.notify('initialized', {});
      this.info = result;
      this.watchCodexHome(result.codexHome);
      return result;
    });
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.warn('[codex] non-json line:', line);
      return;
    }

    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(Object.assign(new Error(message.error.message), { rpcError: message.error }));
      else resolve(message.result);
      return;
    }

    if (message.method) this.handleNotification(message);
  }

  handleNotification(message) {
    const method = message.method;
    const params = message.params ?? {};
    this.rememberStatus(method, params);
    this.rememberEvent(method, params);
    this.broadcast('codex-notification', { method, params });
  }

  rememberStatus(method, params) {
    const lower = String(method ?? '').toLowerCase();
    const thread = params.thread;
    const threadId = params.threadId ?? params.id ?? thread?.id;
    if (!threadId) return;

    const turnId = params.turnId ?? params.turn?.id;
    if (turnId && (lower.includes('turnstarted') || lower.includes('turn/started'))) {
      this.removeQueuedMessage(threadId, turnId);
      this.activeTurnByThread.set(String(threadId), String(turnId));
    }
    if (lower.includes('turncompleted') || lower.includes('turn/completed') || lower.includes('interrupt')) this.activeTurnByThread.delete(String(threadId));

    let status = params.status ?? thread?.status;
    if (!status && (lower.includes('turnstarted') || lower.includes('turn/started'))) status = { type: 'running' };
    if (!status && (lower.includes('turncompleted') || lower.includes('turn/completed'))) status = { type: 'idle' };
    if (!status && lower.includes('interrupt')) status = { type: 'idle' };
    if (!status && lower.includes('error')) status = { type: 'error' };
    if (!status) return;

    this.statusByThread.set(String(threadId), normalizeStatus(status));
  }

  async decorateThread(thread) {
    if (!thread?.id) return thread;
    const remembered = this.statusByThread.get(String(thread.id));
    if (remembered) return { ...thread, status: remembered };
    const external = await inferExternalThreadStatus(thread);
    return external ? { ...thread, status: external } : thread;
  }

  request(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    const payload = { id, method, params };
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async listThreads({ includeArchived = false } = {}) {
    await this.ready;
    const result = await this.request('thread/list', { includeArchived });
    return Promise.all((result.data ?? []).map((thread) => this.decorateThread(thread)));
  }

  async readThread(threadId) {
    await this.ready;
    const read = await this.request('thread/read', { threadId });
    let turns = { data: [] };
    try {
      turns = await this.request('thread/turns/list', { threadId });
    } catch (error) {
      if (!isTurnsNotReadyError(error)) throw error;
    }
    const key = String(threadId);
    const turnData = turns.data ?? [];
    this.pruneQueuedMessages(key, new Set(turnData.map((turn) => String(turn.id))));
    return {
      thread: await this.decorateThread(read.thread),
      turns: turnData.map((turn) => compactTurn(turn, this.steeredMessagesByThread.get(key) ?? [])),
      queuedMessages: this.queuedMessagesByThread.get(key) ?? [],
      events: this.eventsByThread.get(key) ?? [],
    };
  }

  async startThread(cwd) {
    await this.ready;
    const result = await this.request('thread/start', { cwd }, 30000);
    if (result.thread) this.rememberStatus('thread/started', { thread: result.thread });
    return { ...result, thread: await this.decorateThread(result.thread) };
  }

  async startTurn(threadId, input) {
    await this.ready;
    let activeBefore = null;
    try {
      activeBefore = await this.activeTurnId(threadId);
    } catch (error) {
      if (!isTurnsNotReadyError(error)) throw error;
    }

    const result = await this.request('turn/start', { threadId, input }, 30000);
    const turnId = result.turn?.id;
    if (activeBefore && turnId && String(activeBefore) !== String(turnId)) {
      this.addQueuedMessage(threadId, turnId, input);
      this.statusByThread.set(String(threadId), { type: 'running' });
      this.rememberEvent('turn/queued', { threadId, turnId });
      this.broadcast('codex-notification', { method: 'turn/queued', params: { threadId, turnId } });
      return result;
    }

    if (turnId) this.activeTurnByThread.set(String(threadId), String(turnId));
    this.rememberStatus('turn/started', { threadId, turnId, status: { type: 'running' } });
    this.rememberEvent('turn/started', { threadId, turnId, status: { type: 'running' } });
    this.broadcast('codex-notification', { method: 'turn/started', params: { threadId, turnId } });
    return result;
  }

  async steerTurn(threadId, input) {
    await this.ready;
    const turnId = await this.activeTurnId(threadId);
    if (!turnId) throw new Error('No active turn found for this thread.');
    const result = await this.request('turn/steer', { threadId, expectedTurnId: turnId, input }, 15000);
    const text = textFromContent(input);
    if (text) {
      const key = String(threadId);
      const current = this.steeredMessagesByThread.get(key) ?? [];
      this.steeredMessagesByThread.set(key, [...current, { turnId, text: truncate(text, 1600), createdAt: Date.now() }].slice(-25));
    }
    this.rememberEvent('turn/steered', { threadId, turnId });
    this.broadcast('codex-notification', { method: 'turn/steered', params: { threadId, turnId } });
    return { ...result, threadId, turnId };
  }

  async setThreadName(threadId, name) {
    await this.ready;
    const result = await this.request('thread/name/set', { threadId, name: String(name ?? '').trim() || null }, 15000);
    this.rememberEvent('thread/name/set', { threadId, name });
    this.broadcast('codex-notification', { method: 'thread/name/set', params: { threadId, name } });
    this.scheduleThreadsChanged({ source: 'thread/name/set', threadId });
    return result;
  }

  async archiveThread(threadId) {
    await this.ready;
    const result = await this.request('thread/archive', { threadId }, 15000);
    this.rememberEvent('thread/archive', { threadId });
    this.broadcast('codex-notification', { method: 'thread/archive', params: { threadId } });
    this.scheduleThreadsChanged({ source: 'thread/archive', threadId });
    return result;
  }

  async unarchiveThread(threadId) {
    await this.ready;
    const result = await this.request('thread/unarchive', { threadId }, 15000);
    this.rememberEvent('thread/unarchive', { threadId });
    this.broadcast('codex-notification', { method: 'thread/unarchive', params: { threadId } });
    this.scheduleThreadsChanged({ source: 'thread/unarchive', threadId });
    return result;
  }

  async interruptTurn(threadId) {
    await this.ready;
    const turnId = await this.activeTurnId(threadId);
    if (!turnId) throw new Error('No active turn found for this thread.');
    const result = await this.request('turn/interrupt', { threadId, turnId }, 15000);
    this.activeTurnByThread.delete(String(threadId));
    this.rememberStatus('turn/interrupted', { threadId, turnId, status: { type: 'idle' } });
    this.rememberEvent('turn/interrupted', { threadId, turnId, status: { type: 'idle' } });
    this.broadcast('codex-notification', { method: 'turn/interrupted', params: { threadId, turnId } });
    return { ...result, threadId, turnId };
  }

  rememberEvent(method, params = {}) {
    if (!shouldStoreEvent(method)) return;
    const thread = params.thread;
    const threadId = params.threadId ?? params.id ?? thread?.id;
    if (!threadId) return;
    const turnId = params.turnId ?? params.turn?.id;
    const event = {
      at: Date.now(),
      method: String(method ?? ''),
      turnId: turnId ? String(turnId) : null,
      status: params.status?.type ?? params.status ?? thread?.status?.type ?? null,
      message: eventMessage(method, params),
    };
    const key = String(threadId);
    const current = this.eventsByThread.get(key) ?? [];
    this.eventsByThread.set(key, [...current, event].slice(-80));
  }

  addQueuedMessage(threadId, turnId, input) {
    const text = textFromContent(input);
    const key = String(threadId);
    const current = this.queuedMessagesByThread.get(key) ?? [];
    this.queuedMessagesByThread.set(key, [...current, { turnId, text: truncate(text, 1600), createdAt: Date.now() }].slice(-25));
  }

  removeQueuedMessage(threadId, turnId) {
    const key = String(threadId);
    const current = this.queuedMessagesByThread.get(key) ?? [];
    const next = current.filter((message) => String(message.turnId) !== String(turnId));
    if (next.length) this.queuedMessagesByThread.set(key, next);
    else this.queuedMessagesByThread.delete(key);
  }

  pruneQueuedMessages(threadId, seenTurnIds) {
    const key = String(threadId);
    const current = this.queuedMessagesByThread.get(key) ?? [];
    const next = current.filter((message) => !seenTurnIds.has(String(message.turnId)));
    if (next.length) this.queuedMessagesByThread.set(key, next);
    else this.queuedMessagesByThread.delete(key);
  }

  async activeTurnId(threadId) {
    const remembered = this.activeTurnByThread.get(String(threadId));
    if (remembered) return remembered;
    const turns = await this.request('thread/turns/list', { threadId }, 15000);
    const active = (turns.data ?? []).find((turn) => isActiveTurnStatus(turn.status));
    if (active?.id) {
      this.activeTurnByThread.set(String(threadId), String(active.id));
      return String(active.id);
    }
    return null;
  }

  addEventClient(res) {
    const id = randomUUID();
    this.eventClients.add(res);
    res.write(`event: ready\ndata: ${JSON.stringify({ id })}\n\n`);
    return () => this.eventClients.delete(res);
  }

  broadcast(event, payload) {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.eventClients) client.write(data);
  }

  watchCodexHome(codexHome) {
    if (!codexHome) return;
    const sessionsDir = path.join(codexHome, 'sessions');
    if (!existsSync(sessionsDir)) return;

    try {
      const watcher = watch(sessionsDir, { recursive: true }, (_eventType, filename) => {
        const text = String(filename ?? '');
        if (!text.endsWith('.jsonl')) return;
        this.scheduleThreadsChanged({ source: 'codex-sessions-watch', path: text, threadId: threadIdFromRolloutPath(text) });
      });
      watcher.on('error', (error) => console.warn('[codex-control] session watch failed:', error.message));
      this.watchers.push(watcher);
    } catch (error) {
      console.warn('[codex-control] session watch unavailable:', error.message);
    }
  }

  scheduleThreadsChanged(payload = {}) {
    if (payload.threadId) this.pendingChangedThreadIds.add(String(payload.threadId));
    if (this.threadsChangedTimer) return;
    this.threadsChangedTimer = setTimeout(() => {
      this.threadsChangedTimer = null;
      const threadIds = [...this.pendingChangedThreadIds];
      this.pendingChangedThreadIds.clear();
      this.broadcast('threads-changed', { source: payload.source, threadId: threadIds[0] ?? null, threadIds });
    }, 350);
  }
}

const codex = new CodexAppServer();

function normalizeStatus(status) {
  if (!status) return { type: 'idle' };
  if (typeof status === 'string') return { type: status };
  return { ...status, type: status.type ?? 'idle' };
}

function isTurnsNotReadyError(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return message.includes('not materialized yet') || message.includes('turns/list is unavailable before first user message');
}

function isActiveTurnStatus(status) {
  const text = String(status ?? '').toLowerCase();
  return text === 'inprogress' || text === 'in_progress' || text === 'running';
}

const terminalRolloutEvents = new Set([
  'task_complete',
  'turn_complete',
  'turn_completed',
  'completed',
  'error',
]);

async function inferExternalThreadStatus(thread) {
  const currentType = String(thread?.status?.type ?? '').toLowerCase();
  if (currentType && currentType !== 'notloaded') return null;

  const filePath = thread?.path;
  if (!filePath || !existsSync(filePath)) return null;

  try {
    const last = await readLastRolloutEvent(filePath);
    if (!last) return null;
    const eventType = String(last.payload?.type ?? last.type ?? '').toLowerCase();
    if (terminalRolloutEvents.has(eventType)) return null;

    const lastMs = Date.parse(last.timestamp ?? '');
    if (!Number.isFinite(lastMs)) return null;
    const ageMs = Date.now() - lastMs;
    if (ageMs < 0 || ageMs > 20 * 60 * 1000) return null;

    return { type: 'externalActive', source: 'rollout-tail', lastEvent: eventType };
  } catch {
    return null;
  }
}

async function readLastRolloutEvent(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, 128 * 1024);
    if (!length) return null;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    const lines = buffer.toString('utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch {
        // The first line in the chunk may be partial; keep walking backward.
      }
    }
    return null;
  } finally {
    await handle.close();
  }
}

function threadIdFromRolloutPath(filePath) {
  const match = String(filePath ?? '').match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] ?? null;
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 10, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        error.stdout = stdout;
        reject(error);
        return;
      }
      resolve(String(stdout ?? ''));
    });
  });
}

async function worktreesForRepo(repoUrl) {
  const repo = String(repoUrl ?? '').trim();
  if (!repo) return { repo, worktrees: [], source: 'none' };

  const threads = await codex.listThreads({ includeArchived: true });
  const candidates = threads
    .filter((thread) => includes(`${thread.gitInfo?.originUrl ?? ''}\n${thread.cwd ?? ''}\n${thread.path ?? ''}`, repo))
    .map((thread) => thread.cwd)
    .filter(Boolean);

  const seen = new Set();
  for (const cwd of candidates) {
    if (seen.has(cwd)) continue;
    seen.add(cwd);
    try {
      const output = await execFileText('git', ['-C', cwd, 'worktree', 'list', '--porcelain']);
      return { repo, source: cwd, worktrees: parseWorktreeList(output) };
    } catch {
      // Try the next known cwd.
    }
  }

  return { repo, worktrees: [], source: 'not-found' };
}

function parseWorktreeList(output) {
  const blocks = String(output).split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block) => {
    const item = { path: '', bare: false, head: '', branch: '' };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) item.path = line.slice('worktree '.length);
      else if (line === 'bare') item.bare = true;
      else if (line.startsWith('HEAD ')) item.head = line.slice('HEAD '.length);
      else if (line.startsWith('branch ')) item.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
    return item;
  });
}

function compactTurn(turn, steeredMessages = []) {
  return {
    id: turn.id,
    status: turn.status,
    error: turn.error,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    durationMs: turn.durationMs,
    steeredMessages: steeredMessages.filter((message) => message.turnId === turn.id),
    items: (turn.items ?? []).map(compactItem),
  };
}


function shouldStoreEvent(method) {
  const lower = String(method ?? '').toLowerCase();
  if (!lower) return false;
  if (lower.includes('/delta')) return false;
  if (lower.includes('tokenusage')) return false;
  if (lower.includes('agentmessage')) return false;
  if (lower.startsWith('item/')) return false;
  return true;
}

function eventMessage(method, params = {}) {
  const lower = String(method ?? '').toLowerCase();
  const status = params.status?.type ?? params.thread?.status?.type ?? params.status;
  const name = String(params.name ?? '').trim();
  if (lower.includes('thread/name/set')) return name ? `Renamed to "${truncate(name, 120)}"` : 'Name cleared';
  if (lower.includes('thread/name')) return 'Name updated';
  if (lower.includes('thread/archive')) return 'Archived session';
  if (lower.includes('thread/unarchive')) return 'Restored session';
  if (lower.includes('thread/start')) return 'Opened session';
  if (lower.includes('turn/queued')) return 'Queued follow-up prompt';
  if (lower.includes('turn/steer') || lower.includes('steered')) return 'Steered active turn';
  if (lower.includes('interrupt') || lower.includes('interrupted')) return 'Stopped active turn';
  if (lower.includes('turn/start') || lower.includes('turn/started')) return 'Started turn';
  if (lower.includes('turn/complet')) return 'Completed turn';
  if (lower.includes('turn/error') || lower.includes('failed')) return 'Turn error';
  if (status) return `Status: ${String(status)}`;
  return String(method ?? 'Event');
}

function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' || part?.type === 'input_text' || part?.text || part?.value)
    .map((part) => part?.text ?? part?.value ?? '')
    .filter(Boolean)
    .join('\n');
}

function mediaFromDataUrl(dataUrl) {
  const match = String(dataUrl ?? '').match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) return null;
  const [, contentType, encoded] = match;
  const id = createHash('sha256').update(dataUrl).digest('hex').slice(0, 40);
  if (!mediaById.has(id)) mediaById.set(id, { contentType, data: Buffer.from(encoded, 'base64') });
  return { type: 'image', src: `/api/media/${id}`, contentType };
}

function compactContentParts(content) {
  if (!Array.isArray(content)) return [];
  return content.map((part) => {
    const type = String(part?.type ?? '').toLowerCase();
    if (type === 'text' || type === 'input_text' || part?.text || part?.value) {
      const text = part?.text ?? part?.value ?? '';
      return text ? { type: 'text', text: truncate(text) } : null;
    }
    if (type === 'image' || type === 'input_image') {
      const media = mediaFromDataUrl(part?.url ?? part?.image_url);
      return media ? { ...media, detail: part?.detail } : { type: 'unsupportedImage' };
    }
    return null;
  }).filter(Boolean);
}

function truncate(value, max = 12000) {
  const text = String(value ?? '');
  return text.length > max ? text.slice(0, max) + "\n... truncated ..." : text;
}

function compactItem(item) {
  const type = item.type ?? 'unknown';
  const base = { id: item.id, type };

  if (type === 'userMessage') return { ...base, text: truncate(textFromContent(item.content)), parts: compactContentParts(item.content) };
  if (type === 'agentMessage') return { ...base, phase: item.phase, text: truncate(item.text) };
  if (type === 'commandExecution') {
    return {
      ...base,
      command: item.command ?? item.cmd ?? item.argv?.join(' '),
      status: item.status,
      exitCode: item.exitCode,
      output: truncate(item.output ?? item.stdout ?? item.stderr ?? '', 8000),
    };
  }
  if (type === 'reasoning') return { ...base, text: truncate(item.text ?? item.summary ?? '') };

  const json = JSON.stringify(item, null, 2);
  return { ...base, text: truncate(json, 6000) };
}

function includes(haystack, needle) {
  return !needle || String(haystack ?? '').toLowerCase().includes(String(needle).toLowerCase());
}

function filterThreads(threads, params) {
  const q = (params.get('q') ?? params.get('query') ?? '').trim();
  const repo = (params.get('repo') ?? '').trim();
  const source = (params.get('source') ?? '').trim();
  const branch = (params.get('branch') ?? '').trim();
  const cwd = (params.get('cwd') ?? '').trim();
  const limit = Math.min(Number(params.get('limit') || 50), 500);

  const filtered = threads.filter((thread) => {
    const status = thread.status?.type ?? '';
    const searchable = [
      thread.id,
      thread.name,
      thread.preview,
      thread.cwd,
      thread.path,
      thread.source,
      status,
      thread.gitInfo?.originUrl,
      thread.gitInfo?.branch,
      thread.gitInfo?.sha,
    ].filter(Boolean).join('\n');

    if (q && !includes(searchable, q)) return false;
    if (repo && !includes(`${thread.gitInfo?.originUrl ?? ''}\n${thread.cwd ?? ''}\n${thread.path ?? ''}`, repo)) return false;
    if (source && !includes(thread.source, source)) return false;
    if (branch && !includes(thread.gitInfo?.branch, branch)) return false;
    if (cwd && !includes(thread.cwd, cwd)) return false;
    return true;
  });

  return filtered.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, limit);
}

function buildFacets(threads) {
  const repos = new Map();
  const branches = new Map();
  const sources = new Map();

  for (const thread of threads) {
    countFacet(repos, thread.gitInfo?.originUrl || '');
    countFacet(branches, thread.gitInfo?.branch || '');
    countFacet(sources, thread.source || '');
  }

  return {
    repos: facetList(repos),
    branches: facetList(branches),
    sources: facetList(sources),
  };
}

function countFacet(map, value) {
  if (!value) return;
  map.set(value, (map.get(value) ?? 0) + 1);
}

function facetList(map) {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function cleanSlug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function assertSafeBranch(branch) {
  if (!branch || !/^[a-z0-9][a-z0-9-]*$/.test(branch)) {
    throw new Error('Branch/worktree name must be lowercase hyphenated text with no slashes.');
  }
}

function repoWorktreeRoot(sourcePath) {
  const parsed = path.win32.parse(sourcePath);
  const base = path.win32.basename(sourcePath);
  const parent = path.win32.dirname(sourcePath);
  const parentBase = path.win32.basename(parent).toLowerCase();
  if (parentBase.endsWith('-worktrees') || parentBase === 'worktrees') return parent;
  if (['main', 'master', 'develop'].includes(base.toLowerCase()) && parentBase === 'worktrees') return parent;
  return path.win32.join(parent, `${base}-worktrees`);
}

async function buildWorktreePlan(body) {
  const sourcePath = String(body.sourcePath ?? '').trim();
  const rawBranch = String(body.branch ?? '').trim() || `feature-${cleanSlug(body.slug)}`;
  const branch = cleanSlug(rawBranch.startsWith('feature-') ? rawBranch : rawBranch);
  assertSafeBranch(branch);
  if (!sourcePath) throw new Error('Choose an existing worktree as the source.');

  const targetRoot = String(body.targetRoot ?? '').trim() || repoWorktreeRoot(sourcePath);
  const targetPath = path.win32.join(targetRoot, branch);
  const display = `git -C ${quoteWinArg(sourcePath)} worktree add -b ${quoteWinArg(branch)} ${quoteWinArg(targetPath)}`;
  return {
    sourcePath,
    branch,
    targetRoot,
    targetPath,
    commands: [{ display, command: 'git', args: ['-C', sourcePath, 'worktree', 'add', '-b', branch, targetPath] }],
  };
}

function quoteWinArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

async function createWorktree(body) {
  if (!body.confirmed) throw new Error('Worktree creation requires confirmation.');
  const plan = await buildWorktreePlan(body);
  if (existsSync(plan.targetPath)) throw new Error(`Target path already exists: ${plan.targetPath}`);
  const existing = await execFileText('git', ['-C', plan.sourcePath, 'branch', '--list', plan.branch]);
  if (existing.trim()) throw new Error(`Branch already exists: ${plan.branch}`);
  const command = plan.commands[0];
  await execFileText(command.command, command.args);
  return { ...plan, created: true };
}

async function readJson(req) {
  const buffer = await readBody(req);
  if (!buffer.length) return {};
  return JSON.parse(buffer.toString('utf8'));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, contentType) {
  const match = String(contentType ?? '').match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  if (!match) throw new Error('Missing multipart boundary.');
  const boundary = Buffer.from(`--${match[1] ?? match[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer.slice(cursor, cursor + 2).toString() === '--') break;
    if (buffer.slice(cursor, cursor + 2).toString() === '\r\n') cursor += 2;
    const next = buffer.indexOf(boundary, cursor);
    if (next === -1) break;
    let end = next;
    if (buffer.slice(end - 2, end).toString() === '\r\n') end -= 2;
    const part = buffer.slice(cursor, end);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString('utf8');
      const data = part.slice(headerEnd + 4);
      const headers = Object.fromEntries(headerText.split(/\r?\n/).map((line) => {
        const index = line.indexOf(':');
        return index === -1 ? ['', ''] : [line.slice(0, index).toLowerCase(), line.slice(index + 1).trim()];
      }).filter(([key]) => key));
      const disposition = headers['content-disposition'] ?? '';
      const name = disposition.match(/name="([^"]+)"/)?.[1] ?? '';
      const filename = disposition.match(/filename="([^"]*)"/)?.[1] ?? '';
      parts.push({ name, filename, contentType: headers['content-type'] ?? '', data });
    }
    cursor = next;
  }

  return parts;
}

function safeFilename(name) {
  const base = path.win32.basename(String(name ?? 'attachment')) || 'attachment';
  return base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment';
}

function safeThreadId(threadId) {
  return String(threadId ?? '').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function readTurnPayload(req) {
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.includes('multipart/form-data')) {
    const parts = parseMultipart(await readBody(req), contentType);
    return {
      cwd: parts.find((part) => part.name === 'cwd')?.data.toString('utf8') ?? '',
      prompt: parts.find((part) => part.name === 'prompt')?.data.toString('utf8') ?? '',
      files: parts.filter((part) => part.name === 'files' && part.filename),
    };
  }

  const body = await readJson(req);
  return { ...body, prompt: String(body.prompt ?? ''), files: [] };
}

async function buildTurnInput(threadId, thread, reqOrPayload) {
  const payload = reqOrPayload?.headers ? await readTurnPayload(reqOrPayload) : reqOrPayload;
  const prompt = String(payload?.prompt ?? '');
  const files = payload?.files ?? [];

  const input = [];
  const filePathNotes = [];
  if (prompt.trim()) input.push({ type: 'text', text: prompt.trim() });

  if (files.length) {
    const cwd = thread.cwd;
    if (!cwd) throw new Error('Thread has no cwd; cannot save attachments.');
    const attachmentDir = path.win32.join(cwd, '.codex-control', 'attachments', safeThreadId(threadId));
    await mkdir(attachmentDir, { recursive: true });

    for (const file of files) {
      const filename = `${Date.now()}-${safeFilename(file.filename)}`;
      const filePath = path.win32.join(attachmentDir, filename);
      await writeFile(filePath, file.data);
      if (String(file.contentType).toLowerCase().startsWith('image/')) input.push({ type: 'localImage', path: filePath });
      else filePathNotes.push(filePath);
    }
  }

  if (filePathNotes.length) {
    input.push({ type: 'text', text: `Attached local file paths:\n${filePathNotes.map((filePath) => `- ${filePath}`).join('\n')}` });
  }

  if (!input.length) throw new Error('Enter a prompt or attach a file.');
  return input;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, error) {
  sendJson(res, status, { error: error.message ?? String(error) });
}

function sendMedia(res, id) {
  const media = mediaById.get(id);
  if (!media) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Media not found');
    return;
  }
  res.writeHead(200, {
    'content-type': media.contentType,
    'cache-control': 'no-store',
  });
  res.end(media.data);
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const type = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  }[ext] ?? 'application/octet-stream';

  const data = await readFile(filePath);
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(data);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  try {
    if (url.pathname === '/api/health') {
      const info = await codex.ready;
      sendJson(res, 200, { ok: true, ...info });
      return;
    }

    const mediaMatch = url.pathname.match(/^\/api\/media\/([a-f0-9]+)$/);
    if (mediaMatch && req.method === 'GET') {
      sendMedia(res, mediaMatch[1]);
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
      });
      const remove = codex.addEventClient(res);
      req.on('close', remove);
      return;
    }

    if (url.pathname === '/api/repo-worktrees') {
      sendJson(res, 200, await worktreesForRepo(url.searchParams.get('repo')));
      return;
    }

    if (url.pathname === '/api/worktree-plan' && req.method === 'POST') {
      sendJson(res, 200, await buildWorktreePlan(await readJson(req)));
      return;
    }

    if (url.pathname === '/api/worktrees' && req.method === 'POST') {
      sendJson(res, 200, await createWorktree(await readJson(req)));
      return;
    }

    if (url.pathname === '/api/threads' && req.method === 'GET') {
      const includeArchived = url.searchParams.get('archived') === '1' || url.searchParams.get('archived') === 'true';
      const threads = await codex.listThreads({ includeArchived });
      sendJson(res, 200, { data: filterThreads(threads, url.searchParams), facets: buildFacets(threads) });
      return;
    }

    if (url.pathname === '/api/threads' && req.method === 'POST') {
      const payload = await readTurnPayload(req);
      const cwd = String(payload.cwd ?? '').trim();
      if (!cwd) throw new Error('Choose a worktree first.');
      const started = await codex.startThread(cwd);
      const threadId = started.thread?.id;
      if (threadId && (String(payload.prompt ?? '').trim() || payload.files?.length)) {
        const input = await buildTurnInput(threadId, started.thread, payload);
        await codex.startTurn(threadId, input);
      }
      sendJson(res, 200, { ...started, thread: threadId ? (await codex.readThread(threadId)).thread : started.thread });
      return;
    }

    const nameMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/name$/);
    if (nameMatch && req.method === 'POST') {
      const body = await readJson(req);
      sendJson(res, 200, await codex.setThreadName(decodeURIComponent(nameMatch[1]), body.name));
      return;
    }

    const archiveMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/archive$/);
    if (archiveMatch && req.method === 'POST') {
      sendJson(res, 200, await codex.archiveThread(decodeURIComponent(archiveMatch[1])));
      return;
    }

    const unarchiveMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/unarchive$/);
    if (unarchiveMatch && req.method === 'POST') {
      sendJson(res, 200, await codex.unarchiveThread(decodeURIComponent(unarchiveMatch[1])));
      return;
    }

    const turnMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/turn$/);
    if (turnMatch && req.method === 'POST') {
      const threadId = decodeURIComponent(turnMatch[1]);
      const data = await codex.readThread(threadId);
      const input = await buildTurnInput(threadId, data.thread, req);
      sendJson(res, 200, await codex.startTurn(threadId, input));
      return;
    }

    const steerMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/steer$/);
    if (steerMatch && req.method === 'POST') {
      const threadId = decodeURIComponent(steerMatch[1]);
      const data = await codex.readThread(threadId);
      const input = await buildTurnInput(threadId, data.thread, req);
      sendJson(res, 200, await codex.steerTurn(threadId, input));
      return;
    }

    const interruptMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/interrupt$/);
    if (interruptMatch && req.method === 'POST') {
      sendJson(res, 200, await codex.interruptTurn(decodeURIComponent(interruptMatch[1])));
      return;
    }

    const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
    if (threadMatch && req.method === 'GET') {
      sendJson(res, 200, await codex.readThread(decodeURIComponent(threadMatch[1])));
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendError(res, 500, error);
  }
});

server.listen(port, host, () => {
  console.log(`codex-control listening on http://${host}:${port}`);
});
