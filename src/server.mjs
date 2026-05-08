import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const port = Number(process.env.PORT || 4567);
const host = process.env.HOST || '127.0.0.1';

class CodexAppServer {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
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

    // Notifications are useful later for live updates. For v0, keep them quiet.
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
    return result.data ?? [];
  }

  async readThread(threadId) {
    await this.ready;
    const [read, turns] = await Promise.all([
      this.request('thread/read', { threadId }),
      this.request('thread/turns/list', { threadId }),
    ]);
    return {
      thread: read.thread,
      turns: (turns.data ?? []).map(compactTurn),
    };
  }
}

const codex = new CodexAppServer();

function compactTurn(turn) {
  return {
    id: turn.id,
    items: (turn.items ?? []).map(compactItem),
  };
}

function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content.map((part) => part?.text ?? part?.value ?? '').filter(Boolean).join('\n');
}

function truncate(value, max = 12000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}\nâ€¦ truncated â€¦` : text;
}

function compactItem(item) {
  const type = item.type ?? 'unknown';
  const base = { id: item.id, type };

  if (type === 'userMessage') return { ...base, text: truncate(textFromContent(item.content)) };
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
  const q = params.get('q') ?? params.get('query') ?? '';
  const repo = params.get('repo') ?? '';
  const source = params.get('source') ?? '';
  const branch = params.get('branch') ?? '';
  const cwd = params.get('cwd') ?? '';
  const limit = Math.min(Number(params.get('limit') || 50), 500);

  const filtered = threads.filter((thread) => {
    const searchable = [
      thread.id,
      thread.name,
      thread.preview,
      thread.cwd,
      thread.path,
      thread.source,
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

    if (url.pathname === '/api/threads') {
      const includeArchived = url.searchParams.get('archived') === '1' || url.searchParams.get('archived') === 'true';
      const threads = await codex.listThreads({ includeArchived });
      sendJson(res, 200, { data: filterThreads(threads, url.searchParams) });
      return;
    }

    const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
    if (threadMatch) {
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

