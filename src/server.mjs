import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync, watch } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createTranscriptMediaHelpers } from './transcript/media.js';
import { createTranscriptNormalizer, textFromContent, truncate } from './transcript/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
loadDotEnv(path.join(rootDir, '.env'));
const publicDir = path.join(rootDir, 'public');
const port = Number(process.env.PORT || 4567);
const host = process.env.HOST || '127.0.0.1';
const restartTaskName = String(process.env.CODEX_CONTROL_RESTART_TASK || '').trim();
const readOnlyMode = ['1', 'true', 'yes', 'on'].includes(String(process.env.CODEX_CONTROL_READ_ONLY || '').trim().toLowerCase());
const fileServingMode = normalizeFileServingMode(process.env.CODEX_CONTROL_FILE_SERVING || (process.env.CODEX_CONTROL_SERVE_SYSTEM_FILES ? 'system' : 'session'));
const maxBodyBytes = 75 * 1024 * 1024;
const mediaById = new Map();
const gitInfoByCwd = new Map();
const defaultSourceKinds = ['cli', 'vscode', 'appServer', 'unknown'];
const transcriptMedia = createTranscriptMediaHelpers({
  mediaById,
  canServeLocalFilePath,
  localFileScope,
  normalizeLocalFilePath,
});
const { mediaFromLocalFilePath } = transcriptMedia;
const transcriptNormalizer = createTranscriptNormalizer({
  ...transcriptMedia,
  extractModelFromPayload,
  extractEffortFromPayload,
});

class CodexAppServer {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.statusByThread = new Map();
    this.activeTurnByThread = new Map();
    this.queuedMessagesByThread = new Map();
    this.permissionSettingsByThread = new Map();
    this.cwdByThread = new Map();
    this.attachmentsByTurn = new Map();
    this.queueDrainByThread = new Set();
    this.steeredMessagesByThread = new Map();
    this.eventsByThread = new Map();
    this.eventClients = new Set();
    this.watchers = [];
    this.restartInProgress = null;
    this.isManualShutdown = false;
    this.startInProgress = null;
    this.threadsChangedTimer = null;
    this.pendingChangedThreadIds = new Set();
    this.codexHome = null;
    this.lastRestartAt = 0;
    this.ready = this.start();
  }

  start() {
    if (this.startInProgress) return this.startInProgress;
    this.startInProgress = (async () => {
      const proc = spawn('codex', ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      this.proc = proc;

      proc.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text) console.warn('[codex]', text);
      });

      proc.on('exit', (code, signal) => {
        if (this.proc !== proc) return;
        const err = new Error(`codex app-server exited (${code ?? signal})`);
        for (const { reject, timer } of this.pending.values()) {
          clearTimeout(timer);
          reject(err);
        }
        this.pending.clear();
        this.broadcast('codex-exit', { code, signal });
        this.activeTurnByThread.clear();
        if (!this.isManualShutdown) {
          setTimeout(() => {
            this.restartCodex().catch((error) => {
              console.error('[codex-control] automatic codex restart failed:', error.message);
            });
          }, 250);
        }
      });

      proc.on('error', (error) => {
        if (this.proc !== proc) return;
        const startupError = new Error(`codex app-server process error: ${error.message}`);
        for (const { reject, timer } of this.pending.values()) {
          clearTimeout(timer);
          reject(startupError);
        }
        this.pending.clear();
      });

      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (this.proc === proc) this.handleLine(line);
      });

      const result = await this.request('initialize', {
        clientInfo: {
          name: 'codex_control',
          title: 'Codex Control',
          version: '0.1.0',
        },
      }, 15000, { skipReady: true, allowRetry: false });
      this.notify('initialized', {});
      this.info = result;
      this.codexHome = result?.codexHome ?? null;
      this.watchCodexHome(result.codexHome);
      return result;
    })().finally(() => {
      this.startInProgress = null;
    });
    this.ready = this.startInProgress;
    return this.startInProgress;
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
    this.maybeDrainQueuedTurn(method, params);
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
    if (!status && lower.includes('requestapproval')) status = { type: 'waitingOnApproval' };
    if (!status && lower.includes('error')) status = { type: 'error' };
    if (!status) return;

    this.statusByThread.set(String(threadId), normalizeStatus(status));
  }

  async decorateThread(thread) {
    if (!thread?.id) return thread;
    const enriched = markArchivedThread(await enrichThreadGitInfo(thread));
    const remembered = this.statusByThread.get(String(thread.id));
    if (remembered) return { ...enriched, status: remembered };
    const external = await inferExternalThreadStatus(enriched);
    return external ? { ...enriched, status: external } : enriched;
  }

  isProcessRunning(proc) {
    return Boolean(proc && proc.exitCode === null && proc.signalCode === null);
  }

  waitForProcessExit(proc, timeoutMs = 800) {
    if (!this.isProcessRunning(proc)) return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, timeoutMs);
      proc.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  async restartCodex() {
    if (this.restartInProgress) return this.restartInProgress;
    this.restartInProgress = (async () => {
      const now = Date.now();
      if (now - this.lastRestartAt < 250) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      this.lastRestartAt = Date.now();

      if (this.isProcessRunning(this.proc)) {
        const proc = this.proc;
        this.isManualShutdown = true;
        try {
          proc.kill();
        } catch (error) {
          console.warn('[codex-control] failed to stop existing codex process:', error.message);
        }
        await this.waitForProcessExit(proc);
        if (this.isProcessRunning(proc)) {
          try {
            proc.kill('SIGKILL');
          } catch (error) {
            console.warn('[codex-control] failed to force-stop codex process:', error.message);
          }
          await this.waitForProcessExit(proc);
        }
        this.isManualShutdown = false;
      }

      this.ready = this.start();
      return await this.ready;
    })();
    this.ready = this.restartInProgress;

    try {
      await this.restartInProgress;
    } finally {
      this.restartInProgress = null;
    }
  }

  isRecoverableCodexError(error) {
    const message = String(error?.message ?? '').toLowerCase();
    const code = String(error?.code ?? '').toLowerCase();
    return code === 'epipe'
      || code === 'err_stream_destroyed'
      || message.includes('codex app-server exited')
      || message.includes('codex app-server process error')
      || message.includes('broken pipe')
      || message.includes('write after end')
      || message.includes('stream has been destroyed')
      || message.includes('cannot call write');
  }

  async request(method, params = {}, timeoutMs = 15000, options = {}) {
    const { allowRetry = true, skipReady = false } = options;
    if (!skipReady) {
      try {
        await this.ready;
      } catch (error) {
        if (!allowRetry || !this.isRecoverableCodexError(error)) throw error;
        await this.restartCodex();
        return this.request(method, params, timeoutMs, { ...options, allowRetry: false });
      }
    }

    const id = this.nextId++;
    const payload = { id, method, params };
    const requestPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });

    try {
      if (!this.proc?.stdin?.writable || this.proc.stdin.destroyed) {
        throw new Error('codex app-server stdin is not writable');
      }
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error || !this.pending.has(id)) return;
        const pending = this.pending.get(id);
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      if (!allowRetry || !this.isRecoverableCodexError(error)) throw error;
      await this.restartCodex();
      return this.request(method, params, timeoutMs, { ...options, allowRetry: false });
    }

    return requestPromise.catch(async (error) => {
      if (!allowRetry || !this.isRecoverableCodexError(error)) {
        throw error;
      }
      await this.restartCodex();
      return this.request(method, params, timeoutMs, { ...options, allowRetry: false });
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async listThreads({ includeArchived = false, limit = 50, searchTerm = '', cwd = '', sourceKinds = defaultSourceKinds } = {}) {
    await this.ready;
    const target = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const data = [];
    let cursor = null;

    while (data.length < target) {
      const pageLimit = Math.min(25, target - data.length);
      const params = { archived: Boolean(includeArchived), limit: pageLimit, sortKey: 'updated_at' };
      if (Array.isArray(sourceKinds) && sourceKinds.length) params.sourceKinds = sourceKinds;
      if (String(searchTerm ?? '').trim()) params.searchTerm = String(searchTerm).trim();
      if (String(cwd ?? '').trim()) params.cwd = String(cwd).trim();
      if (cursor) params.cursor = cursor;
      const result = await this.request('thread/list', params, 15000, { allowRetry: true });
      data.push(...(result.data ?? []));
      cursor = result.nextCursor;
      if (!cursor || !(result.data ?? []).length) break;
    }

    return Promise.all(data.map((thread) => this.decorateThread(thread)));
  }

  async readThread(threadId) {
    await this.ready;
    const read = await this.request('thread/read', { threadId }, 15000, { allowRetry: true });
    let turns = { data: [] };
    try {
      turns = await this.request('thread/turns/list', { threadId }, 15000, { allowRetry: true });
    } catch (error) {
      if (!isTurnsNotReadyError(error)) throw error;
    }
    const key = String(threadId);
    const turnData = turns.data ?? [];
    this.pruneQueuedMessages(key, new Set(turnData.map((turn) => String(turn.id))));
    const thread = await this.decorateThread(read.thread);
    const turnModelsFromCodex = (turnData ?? []).map((turn) => extractModelFromPayload(turn));
    const threadModelFromCodex = extractModelFromPayload(
      thread?.model
        || thread?.currentModel
        || thread?.config?.model
        || thread?.settings?.model
        || thread?.metadata?.model
        || thread?.provider?.model,
    );
    const hasAnyTurnFromCodex = turnModelsFromCodex.some((value) => Boolean(value));
    const hasMissingTurnModelFromCodex = turnModelsFromCodex.some((value) => !Boolean(value));
    const allTurnModelsFromCodex = turnModelsFromCodex.length && turnModelsFromCodex.every((value) => Boolean(value));
    let modelSource = threadModelFromCodex || allTurnModelsFromCodex ? 'codex' : 'unknown';

    let resolvedTurns = turnData;
    let resolvedThread = thread;

    if (shouldUseRolloutModelHints(read.thread, turnData)) {
      const rolloutModelInfo = await getRolloutModelInfo(read.thread?.path, threadId, this.codexHome);
      if (rolloutModelInfo) {
        resolvedTurns = applyRolloutModelHints(turnData, rolloutModelInfo);
        resolvedThread = applyRolloutModelHintsToThread(thread, rolloutModelInfo, resolvedTurns);
        if (modelSource === 'codex' && hasMissingTurnModelFromCodex) {
          modelSource = 'mixed';
        } else if (modelSource === 'unknown') {
          modelSource = hasAnyTurnFromCodex ? 'mixed' : 'rollout';
        }
      }
    }

    const resolvedModel = inferThreadModel(resolvedThread, resolvedTurns);
    const permissionSettings = this.permissionSettingsByThread.get(key) ?? {};
    const mediaPolicy = mediaPolicyForThread(resolvedThread, permissionSettings);
    if (resolvedThread?.cwd) this.cwdByThread.set(key, resolvedThread.cwd);
    return {
      thread: resolvedModel ? { ...resolvedThread, model: resolvedModel, modelSource } : { ...resolvedThread, modelSource },
      turns: resolvedTurns.map((turn) => transcriptNormalizer.normalizeTranscriptTurn(turn, this.steeredMessagesByThread.get(key) ?? [], this.attachmentsForTurn(key, turn.id), resolvedThread?.cwd, mediaPolicy)),
      queuedMessages: (this.queuedMessagesByThread.get(key) ?? []).map((message) => normalizeQueuedMessage(message, mediaPolicy)),
      permissionSettings,
      events: this.eventsByThread.get(key) ?? [],
    };
  }

  async startThread(cwd = '', overrides = {}) {
    await this.ready;
    const params = String(cwd ?? '').trim() ? { cwd: String(cwd).trim() } : {};
    const result = await this.request('thread/start', params, 30000, { allowRetry: false });
    if (result.thread) {
      this.rememberStatus('thread/started', { thread: result.thread });
      this.rememberPermissionSettings(result.thread.id, overrides);
      if (result.thread.cwd) this.cwdByThread.set(String(result.thread.id), result.thread.cwd);
    }
    return { ...result, thread: await this.decorateThread(result.thread) };
  }

  async resumeThread(threadId) {
    await this.ready;
    const result = await this.request('thread/resume', { threadId }, 30000, { allowRetry: false });
    if (result.thread) this.rememberStatus('thread/resumed', { thread: result.thread });
    if (result.thread?.cwd) this.cwdByThread.set(String(threadId), result.thread.cwd);
    return { ...result, thread: await this.decorateThread(result.thread) };
  }

  async startTurn(threadId, input, overrides = {}) {
    await this.ready;
    let activeBefore = null;
    try {
      activeBefore = await this.activeTurnId(threadId);
    } catch (error) {
      if (!isTurnsNotReadyError(error)) throw error;
    }

    if (activeBefore) {
      const queued = this.addQueuedMessage(threadId, input, overrides);
      this.statusByThread.set(String(threadId), { type: 'running' });
      this.rememberEvent('turn/queued', { threadId, turnId: queued.turnId });
      this.broadcast('codex-notification', { method: 'turn/queued', params: { threadId, turnId: queued.turnId } });
      return { queued: true, threadId, turn: { id: queued.turnId, status: 'queued' } };
    }

    this.rememberPermissionSettings(threadId, overrides);
    const result = await this.request('turn/start', { threadId, input, ...overrides }, 30000, { allowRetry: false });
    const turnId = result.turn?.id;
    if (turnId) this.rememberTurnAttachments(threadId, turnId, attachmentsFromInput(input, this.mediaPolicyForThreadId(threadId)));
    if (turnId) this.activeTurnByThread.set(String(threadId), String(turnId));
    this.rememberStatus('turn/started', { threadId, turnId, status: { type: 'running' } });
    this.rememberEvent('turn/started', { threadId, turnId, status: { type: 'running' } });
    this.broadcast('codex-notification', { method: 'turn/started', params: { threadId, turnId } });
    return result;
  }

  mediaPolicyForThreadId(threadId) {
    const key = String(threadId);
    return mediaPolicyForThread(
      { id: key, cwd: this.cwdByThread.get(key) || '' },
      this.permissionSettingsByThread.get(key) ?? {},
    );
  }

  async steerTurn(threadId, input) {
    await this.ready;
    const turnId = await this.activeTurnId(threadId);
    if (!turnId) {
      this.clearStaleActiveTurn(threadId);
      return { threadId, status: 'idle', stale: true };
    }
    try {
      const result = await this.request('turn/steer', { threadId, expectedTurnId: turnId, input }, 15000, { allowRetry: false });
      const text = textFromContent(input);
      if (text) {
        const key = String(threadId);
        const current = this.steeredMessagesByThread.get(key) ?? [];
        this.steeredMessagesByThread.set(key, [...current, { turnId, text: truncate(text, 1600), createdAt: Date.now() }].slice(-25));
      }
      this.rememberEvent('turn/steered', { threadId, turnId });
      this.broadcast('codex-notification', { method: 'turn/steered', params: { threadId, turnId } });
      return { ...result, threadId, turnId };
    } catch (error) {
      if (/no active turn/i.test(error.message)) {
        this.clearStaleActiveTurn(threadId, turnId);
        return { threadId, turnId, status: 'idle', stale: true };
      }
      throw error;
    }
  }

  async setThreadName(threadId, name) {
    await this.ready;
    const result = await this.request('thread/name/set', { threadId, name: String(name ?? '').trim() || null }, 15000, { allowRetry: false });
    this.rememberEvent('thread/name/set', { threadId, name });
    this.broadcast('codex-notification', { method: 'thread/name/set', params: { threadId, name } });
    this.scheduleThreadsChanged({ source: 'thread/name/set', threadId });
    return result;
  }

  async archiveThread(threadId) {
    await this.ready;
    const result = await this.request('thread/archive', { threadId }, 15000, { allowRetry: false });
    this.rememberEvent('thread/archive', { threadId });
    this.broadcast('codex-notification', { method: 'thread/archive', params: { threadId } });
    this.scheduleThreadsChanged({ source: 'thread/archive', threadId });
    return result;
  }

  async unarchiveThread(threadId) {
    await this.ready;
    const result = await this.request('thread/unarchive', { threadId }, 15000, { allowRetry: false });
    this.rememberEvent('thread/unarchive', { threadId });
    this.broadcast('codex-notification', { method: 'thread/unarchive', params: { threadId } });
    this.scheduleThreadsChanged({ source: 'thread/unarchive', threadId });
    return result;
  }

  clearStaleActiveTurn(threadId, turnId = null) {
    this.activeTurnByThread.delete(String(threadId));
    const params = { threadId, ...(turnId ? { turnId } : {}), status: { type: 'idle' } };
    this.rememberStatus('turn/idle', params);
    this.rememberEvent('turn/idle', params);
    this.broadcast('codex-notification', { method: 'turn/idle', params });
    this.scheduleThreadsChanged({ source: 'turn/idle', threadId });
    setTimeout(() => this.drainQueuedTurn(threadId).catch((error) => {
      console.warn('[codex-control] failed to start queued turn after stale active clear:', error.message);
    }), 250);
  }

  async interruptTurn(threadId) {
    await this.ready;
    const turnId = await this.activeTurnId(threadId);
    if (!turnId) {
      this.clearStaleActiveTurn(threadId);
      return { threadId, status: 'idle', stale: true };
    }
    try {
      const result = await this.request('turn/interrupt', { threadId, turnId }, 15000, { allowRetry: false });
      this.activeTurnByThread.delete(String(threadId));
      this.rememberStatus('turn/interrupted', { threadId, turnId, status: { type: 'idle' } });
      this.rememberEvent('turn/interrupted', { threadId, turnId, status: { type: 'idle' } });
      this.broadcast('codex-notification', { method: 'turn/interrupted', params: { threadId, turnId } });
      return { ...result, threadId, turnId };
    } catch (error) {
      if (/no active turn/i.test(error.message)) {
        this.clearStaleActiveTurn(threadId, turnId);
        return { threadId, turnId, status: 'idle', stale: true };
      }
      throw error;
    }
  }

  rememberEvent(method, params = {}) {
    if (!shouldStoreEvent(method)) return;
    const thread = params.thread;
    const threadId = params.threadId ?? params.id ?? thread?.id;
    if (!threadId) return;
    const turnId = params.turnId ?? params.turn?.id;
    const modelFrom = extractModelFromParams(params, 'from');
    const modelTo = extractModelFromParams(params, 'to');
    const event = {
      at: Date.now(),
      method: String(method ?? ''),
      turnId: turnId ? String(turnId) : null,
      status: params.status?.type ?? params.status ?? thread?.status?.type ?? null,
      message: eventMessage(method, params),
      modelFrom: modelFrom || null,
      modelTo: modelTo || null,
      model: modelTo || modelFrom || null,
    };
    const key = String(threadId);
    const current = this.eventsByThread.get(key) ?? [];
    this.eventsByThread.set(key, [...current, event].slice(-80));
  }

  rememberPermissionSettings(threadId, overrides = {}) {
    if (!threadId || !Object.keys(overrides).length) return;
    const key = String(threadId);
    const current = this.permissionSettingsByThread.get(key) ?? {};
    this.permissionSettingsByThread.set(key, { ...current, ...overrides });
  }

  rememberTurnAttachments(threadId, turnId, attachments = []) {
    if (!threadId || !turnId || !attachments.length) return;
    const key = String(threadId);
    const current = this.attachmentsByTurn.get(key) ?? new Map();
    current.set(String(turnId), attachments);
    this.attachmentsByTurn.set(key, current);
  }

  attachmentsForTurn(threadId, turnId) {
    if (!threadId || !turnId) return [];
    return this.attachmentsByTurn.get(String(threadId))?.get(String(turnId)) ?? [];
  }

  addQueuedMessage(threadId, input, overrides = {}) {
    const text = textFromContent(input);
    const key = String(threadId);
    const turnId = `queued-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const current = this.queuedMessagesByThread.get(key) ?? [];
    const message = { turnId, input, overrides, text: truncate(text, 1600), createdAt: Date.now() };
    this.queuedMessagesByThread.set(key, [...current, message].slice(-25));
    return message;
  }

  removeQueuedMessage(threadId, turnId) {
    const key = String(threadId);
    const current = this.queuedMessagesByThread.get(key) ?? [];
    const removed = current.find((message) => String(message.turnId) === String(turnId)) ?? null;
    const next = current.filter((message) => String(message.turnId) !== String(turnId));
    if (next.length) this.queuedMessagesByThread.set(key, next);
    else this.queuedMessagesByThread.delete(key);
    return removed ? normalizeQueuedMessage(removed, this.mediaPolicyForThreadId(threadId)) : null;
  }

  moveQueuedMessage(threadId, turnId, direction) {
    const key = String(threadId);
    const current = [...(this.queuedMessagesByThread.get(key) ?? [])];
    const index = current.findIndex((message) => String(message.turnId) === String(turnId));
    const mediaPolicy = this.mediaPolicyForThreadId(threadId);
    if (index === -1) return current.map((message) => normalizeQueuedMessage(message, mediaPolicy));
    const delta = direction === 'down' ? 1 : -1;
    const target = Math.max(0, Math.min(current.length - 1, index + delta));
    if (target !== index) {
      const [message] = current.splice(index, 1);
      current.splice(target, 0, message);
      this.queuedMessagesByThread.set(key, current);
    }
    return current.map((message) => normalizeQueuedMessage(message, mediaPolicy));
  }

  async steerQueuedMessage(threadId, turnId) {
    const key = String(threadId);
    const current = this.queuedMessagesByThread.get(key) ?? [];
    const message = current.find((queued) => String(queued.turnId) === String(turnId));
    if (!message) throw new Error('Queued message not found.');
    this.removeQueuedMessage(threadId, turnId);
    return this.steerTurn(threadId, message.input);
  }

  pruneQueuedMessages(threadId, seenTurnIds) {
    const key = String(threadId);
    const current = this.queuedMessagesByThread.get(key) ?? [];
    const next = current.filter((message) => !seenTurnIds.has(String(message.turnId)));
    if (next.length) this.queuedMessagesByThread.set(key, next);
    else this.queuedMessagesByThread.delete(key);
  }

  maybeDrainQueuedTurn(method, params = {}) {
    const lower = String(method ?? '').toLowerCase();
    if (!lower.includes('turn/completed') && !lower.includes('turncompleted') && !lower.includes('interrupt')) return;
    let threadId = params.threadId ?? params.thread?.id;
    const turnId = params.turnId ?? params.turn?.id;
    if (!threadId && turnId) {
      for (const [candidateThreadId, activeTurnId] of this.activeTurnByThread.entries()) {
        if (String(activeTurnId) === String(turnId)) {
          threadId = candidateThreadId;
          break;
        }
      }
    }
    if (!threadId) return;
    this.activeTurnByThread.delete(String(threadId));
    setTimeout(() => this.drainQueuedTurn(threadId).catch((error) => {
      console.warn('[codex-control] failed to start queued turn:', error.message);
    }), 250);
  }

  async drainQueuedTurn(threadId) {
    const key = String(threadId);
    if (this.queueDrainByThread.has(key)) return;
    const current = this.queuedMessagesByThread.get(key) ?? [];
    const next = current[0];
    if (!next) return;
    this.queueDrainByThread.add(key);
    try {
      const remaining = current.slice(1);
      if (remaining.length) this.queuedMessagesByThread.set(key, remaining);
      else this.queuedMessagesByThread.delete(key);
      this.rememberEvent('turn/dequeued', { threadId, turnId: next.turnId });
      this.broadcast('codex-notification', { method: 'turn/dequeued', params: { threadId, turnId: next.turnId } });
      await this.resumeThread(threadId);
      await this.startTurn(threadId, next.input, next.overrides ?? {});
    } finally {
      this.queueDrainByThread.delete(key);
    }
  }

  async activeTurnId(threadId) {
    const remembered = this.activeTurnByThread.get(String(threadId));
    if (remembered) return remembered;
    const turns = await this.request('thread/turns/list', { threadId }, 15000, { allowRetry: true });
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

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function normalizeFileServingMode(value) {
  const mode = String(value ?? '').trim().toLowerCase();
  return ['system', 'all', 'any'].includes(mode) ? 'system' : 'session';
}

const terminalRolloutEvents = new Set([
  'task_complete',
  'turn_complete',
  'turn_completed',
  'completed',
  'error',
]);

function shouldUseRolloutModelHints(thread, turns = []) {
  const threadModel = extractModelFromPayload(
    thread?.model
      || thread?.currentModel
      || thread?.config?.model
      || thread?.settings?.model
      || thread?.metadata?.model
      || thread?.provider?.model,
  );
  const threadEffort = extractEffortFromPayload(thread);
  if (!threadModel || !threadEffort) return true;
  for (const turn of turns ?? []) {
    if (!extractModelFromPayload(turn) || !extractEffortFromPayload(turn)) return true;
  }
  return false;
}

function resolveRolloutPath(filePath, threadId, codexHome) {
  if (!filePath && !threadId) return null;

  if (filePath) {
    if (existsSync(filePath)) return filePath;
    try {
      const resolvedPath = path.resolve(filePath);
      if (existsSync(resolvedPath)) return resolvedPath;
    } catch {
      // fallback below
    }
  }

  if (!threadId || !codexHome) return null;
  const candidate = path.join(codexHome, 'sessions', `${threadId}.jsonl`);
  return existsSync(candidate) ? candidate : null;
}

async function getRolloutModelInfo(filePath, threadId, codexHome) {
  const candidatePath = resolveRolloutPath(filePath, threadId, codexHome);
  if (!candidatePath) return null;

  let resolvedPath = candidatePath;
  try {
    resolvedPath = path.resolve(candidatePath);
  } catch {
    resolvedPath = candidatePath;
  }
  try {
    const handle = await open(resolvedPath, 'r');
    let fileStat;
    try {
      fileStat = await handle.stat();
    } finally {
      await handle.close();
    }
    const cached = rolloutModelInfoCache.get(resolvedPath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) return cached;
    const info = await readRolloutModelInfo(resolvedPath);
    const merged = {
      ...info,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
    };
    rolloutModelInfoCache.set(resolvedPath, merged);
    return merged;
  } catch {
    return null;
  }
}

function getRolloutTurnId(event) {
  const payload = event?.payload ?? {};
  return String(payload.turn_id ?? payload.turnId ?? payload.turn?.id ?? '').trim();
}

async function readRolloutModelInfo(filePath) {
  const turnModels = new Map();
  const turnEfforts = new Map();
  let threadModel = '';
  let threadEffort = '';
  const seenTurnModels = new Map();
  const seenTurnEfforts = new Map();

  try {
    const input = createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });

    for await (const line of lines) {
      const text = String(line ?? '').trim();
      if (!text) continue;

      let event;
      try {
        event = JSON.parse(text);
      } catch {
        continue;
      }

      const payload = event.payload ?? event;
      const model = extractModelFromPayload(payload);
      const effort = extractEffortFromPayload(payload);
      const turnId = getRolloutTurnId(event);
      if (model) {
        if (event?.type === 'session_meta' || !threadModel) threadModel = model;
        if (turnId) seenTurnModels.set(turnId, model);
      }
      if (effort) {
        if (event?.type === 'session_meta' || !threadEffort) threadEffort = effort;
        if (turnId) seenTurnEfforts.set(turnId, effort);
      }
    }
  } catch {
    return { threadModel: '', turnModels: new Map() };
  }

  for (const [turnId, model] of seenTurnModels.entries()) {
    if (model) turnModels.set(turnId, model);
  }
  for (const [turnId, effort] of seenTurnEfforts.entries()) {
    if (effort) turnEfforts.set(turnId, effort);
  }

  return {
    threadModel,
    threadEffort,
    turnModels,
    turnEfforts,
  };
}

const rolloutModelInfoCache = new Map();

function applyRolloutModelHints(turns, rolloutInfo) {
  if (!rolloutInfo || !turns?.length) return turns;
  const turnModels = rolloutInfo.turnModels ?? new Map();
  const turnEfforts = rolloutInfo.turnEfforts ?? new Map();

  return turns.map((turn) => {
    if (!turn?.id) return turn;
    const fromRolloutModel = extractModelFromPayload(turnModels.get(String(turn.id)));
    const fromRolloutEffort = extractEffortFromPayload(turnEfforts.get(String(turn.id)));
    return {
      ...turn,
      ...(extractModelFromPayload(turn) || !fromRolloutModel ? {} : { model: fromRolloutModel }),
      ...(extractEffortFromPayload(turn) || !fromRolloutEffort ? {} : { effort: fromRolloutEffort }),
    };
  });
}

function applyRolloutModelHintsToThread(thread, rolloutInfo, turns = []) {
  if (!thread || !rolloutInfo) return thread;
  const currentThreadModel = extractModelFromPayload(thread.model);
  const currentThreadEffort = extractEffortFromPayload(thread);
  const fromTurns = [...turns].map((turn) => extractModelFromPayload(turn)).filter(Boolean).pop() || '';
  const effortFromTurns = [...turns].map((turn) => extractEffortFromPayload(turn)).filter(Boolean).pop() || '';
  const fromRollout = extractModelFromPayload(rolloutInfo.threadModel) || fromTurns;
  const effortFromRollout = extractEffortFromPayload(rolloutInfo.threadEffort) || effortFromTurns;
  return {
    ...thread,
    ...(currentThreadModel || !fromRollout ? {} : { model: fromRollout }),
    ...(currentThreadEffort || !effortFromRollout ? {} : { effort: effortFromRollout }),
  };
}

function markArchivedThread(thread) {
  if (!thread) return thread;
  const filePath = String(thread.path ?? '').replace(/\\/g, '/').toLowerCase();
  if (!filePath.includes('/archived_sessions/')) return thread;
  return { ...thread, archived: true };
}
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

async function enrichThreadGitInfo(thread) {
  if (String(thread?.gitInfo?.originUrl ?? '').trim() || !thread?.cwd) return thread;
  const gitInfo = await gitInfoForCwd(thread.cwd);
  if (!Object.keys(gitInfo).length) return thread;
  const merged = { ...gitInfo };
  for (const [key, value] of Object.entries(thread.gitInfo ?? {})) {
    if (value !== undefined && value !== null && String(value) !== '') merged[key] = value;
  }
  return { ...thread, gitInfo: merged };
}

async function gitInfoForCwd(cwd) {
  const key = String(cwd ?? '');
  if (!key || !existsSync(key)) return {};
  if (gitInfoByCwd.has(key)) return gitInfoByCwd.get(key);
  const info = {};
  try {
    const [originUrl, branch, sha] = await Promise.all([
      execFileText('git', gitArgs(key, ['remote', 'get-url', 'origin'])).catch(() => ''),
      execFileText('git', gitArgs(key, ['branch', '--show-current'])).catch(() => ''),
      execFileText('git', gitArgs(key, ['rev-parse', 'HEAD'])).catch(() => ''),
    ]);
    if (originUrl.trim()) info.originUrl = originUrl.trim();
    if (branch.trim()) info.branch = branch.trim();
    if (sha.trim()) info.sha = sha.trim();
  } catch {
    // Missing repo metadata should not hide the session.
  }
  gitInfoByCwd.set(key, info);
  return info;
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

function gitArgs(cwd, args = []) {
  return ['-c', `safe.directory=${path.win32.resolve(String(cwd ?? ''))}`, '-C', cwd, ...args];
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

  const threads = await codex.listThreads({ includeArchived: true, limit: 500 });
  const threadsByCwd = await threadsByCwdMap(threads);
  const candidates = threads
    .filter((thread) => includes(`${thread.gitInfo?.originUrl ?? ''}\n${thread.cwd ?? ''}\n${thread.path ?? ''}`, repo))
    .map((thread) => thread.cwd)
    .filter(Boolean);

  try {
    const currentGit = await gitInfoForCwd(rootDir);
    if (includes(currentGit.originUrl, repo) || includes(rootDir, repo)) candidates.unshift(rootDir);
  } catch {
    // Current app repo fallback is best-effort only.
  }

  const seen = new Set();
  for (const cwd of candidates) {
    const key = String(cwd).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const output = await execFileText('git', gitArgs(cwd, ['worktree', 'list', '--porcelain']));
      return {
        repo,
        source: cwd,
        worktrees: await Promise.all(parseWorktreeList(output).map(async (worktree) => ({
          ...worktree,
          session: threadsByCwd.get(await pathKey(worktree.path)) ?? null,
        }))),
      };
    } catch {
      // Try the next known cwd.
    }
  }

  return { repo, worktrees: [], source: 'not-found' };
}

async function pathKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    return path.normalize(await realpath(text)).toLowerCase();
  } catch {
    return path.normalize(text).toLowerCase();
  }
}

async function threadsByCwdMap(threads = []) {
  const map = new Map();
  for (const thread of threads) {
    const key = await pathKey(thread.cwd);
    if (!key || map.has(key)) continue;
    map.set(key, {
      id: thread.id,
      name: thread.name || '',
      status: normalizeStatus(thread.status),
      archived: Boolean(thread.archived || thread.isArchived || thread.archivedAt || thread.archived_at),
      updatedAt: thread.updatedAt,
    });
  }
  return map;
}

async function existingThreadForCwd(cwd) {
  const key = await pathKey(cwd);
  if (!key) return null;
  const threads = await codex.listThreads({ includeArchived: true, limit: 500 });
  for (const thread of threads) {
    if (await pathKey(thread.cwd) === key) return thread;
  }
  return null;
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

function normalizeQueuedMessage(message, mediaPolicy = {}) {
  return {
    turnId: message.turnId,
    text: message.text,
    attachments: attachmentsFromInput(message.input, mediaPolicy),
    createdAt: message.createdAt,
  };
}

function attachmentsFromInput(input = [], mediaPolicy = {}) {
  return (Array.isArray(input) ? input : [])
    .filter((part) => part?.type === 'localImage' && part.path)
    .map((part) => {
      const media = mediaFromLocalFilePath(part.path, mediaPolicy);
      return media ? { type: 'image', ...media, filename: path.basename(part.path) } : null;
    })
    .filter(Boolean);
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
  const modelFrom = extractModelFromParams(params, 'from');
  const modelTo = extractModelFromParams(params, 'to');
  const status = params.status?.type ?? params.thread?.status?.type ?? params.status;
  const name = String(params.name ?? params.thread?.name ?? params.thread?.title ?? '').trim();
  if (lower.includes('model')) {
    if (modelFrom && modelTo && modelFrom !== modelTo) return `Model changed: ${modelFrom} -> ${modelTo}`;
    if (modelTo) return `Model set to "${modelTo}"`;
    if (modelFrom) return `Model set to "${modelFrom}"`;
  }
  if (lower.includes('thread/name/set') || lower.includes('thread/name/updated')) return name ? `Renamed to "${truncate(name, 120)}"` : 'Name updated';
  if (lower.includes('thread/name')) return name ? `Renamed to "${truncate(name, 120)}"` : 'Name updated';
  if (lower.includes('thread/archive')) return 'Archived session';
  if (lower.includes('thread/unarchive')) return 'Restored session';
  if (lower.includes('thread/start')) return 'Opened session';
  if (lower.includes('turn/dequeued')) return 'Started queued follow-up';
  if (lower.includes('turn/queued')) return 'Queued follow-up prompt';
  if (lower.includes('turn/steer') || lower.includes('steered')) return 'Steered active turn';
  if (lower.includes('interrupt') || lower.includes('interrupted')) return 'Stopped active turn';
  if (lower.includes('turn/start') || lower.includes('turn/started')) return 'Started turn';
  if (lower.includes('turn/complet')) return 'Completed turn';
  if (lower.includes('turn/error') || lower.includes('failed')) return 'Turn error';
  if (status) return `Status: ${String(status)}`;
  return String(method ?? 'Event');
}

function inferThreadModel(thread, turns = []) {
  const direct = extractModelFromPayload(thread?.model)
    || extractModelFromPayload(thread?.config?.model)
    || extractModelFromPayload(thread?.settings?.model)
    || extractModelFromPayload(thread?.metadata?.model)
    || extractModelFromPayload(thread?.provider?.model);
  if (direct) return direct;

  const turnModels = (turns ?? [])
    .map((turn) => extractModelFromPayload(turn))
    .filter(Boolean);
  return turnModels.length ? turnModels[turnModels.length - 1] : '';
}

function extractModelFromPayload(value) {
  if (value == null) return '';
  if (typeof value === 'string') return normalizeModelValue(value);
  if (typeof value === 'number' || typeof value === 'bigint') return normalizeModelValue(String(value));
  if (typeof value !== 'object') return '';

  const candidates = [
    value.model,
    value.name,
    value.id,
    value.value,
    value.providerModel,
    value.modelName,
    value.modelName?.name,
    value.currentModel,
    value.currentModel?.name,
    value.model_name,
    value.current_model,
    value.provider_model,
    value.model_id,
    value.config?.model,
    value.settings?.model,
    value.metadata?.model,
    value.provider?.model,
    value.model?.name,
    value.model?.id,
    value.model?.value,
  ];

  for (const candidate of candidates) {
    const model = extractModelFromPayload(candidate);
    if (model) return model;
  }

  return '';
}

function normalizeEffortValue(value) {
  const text = String(value ?? '').trim();
  return ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(text.toLowerCase()) ? text : '';
}

function extractEffortFromPayload(value) {
  if (value == null) return '';
  if (typeof value === 'string') return normalizeEffortValue(value);
  if (typeof value !== 'object') return '';

  const candidates = [
    value.effort,
    value.reasoningEffort,
    value.reasoning_effort,
    value.thinkingLevel,
    value.thinking_level,
    value.config?.effort,
    value.config?.reasoningEffort,
    value.settings?.effort,
    value.settings?.reasoningEffort,
    value.metadata?.effort,
    value.metadata?.reasoningEffort,
    value.reasoning?.effort,
    value.model?.reasoningEffort,
  ];

  for (const candidate of candidates) {
    const effort = extractEffortFromPayload(candidate);
    if (effort) return effort;
  }

  return '';
}

function extractModelFromParams(params = {}, direction) {
  if (!params || typeof params !== 'object') return '';
  const requested = String(direction ?? '').toLowerCase();
  if (requested === 'from') {
    return extractModelFromPayload(
      params.fromModel ??
      params.previousModel ??
      params.prevModel ??
      params.model?.from ??
      params.model?.previous ??
      params.model?.old
    );
  }
  if (requested === 'to') {
    return extractModelFromPayload(
      params.toModel ??
      params.nextModel ??
      params.currentModel ??
      params.model?.to ??
      params.model?.next ??
      params.model?.current
    );
  }
  return extractModelFromPayload(params.model ?? params.modelName ?? params.modelId ?? params.providerModel ?? params.model?.name ?? params.model?.id);
}

function normalizeModelValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return '';
  return text;
}

function normalizeLocalFilePath(filePath) {
  const target = String(filePath ?? '').trim().replace(/^<|>$/g, '');
  if (!target || target.includes('\0')) return '';
  if (/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(target)) return path.win32.normalize(target);
  if (path.isAbsolute(target)) return path.normalize(target);
  return '';
}

function isWindowsPath(filePath) {
  return /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(String(filePath ?? ''));
}

function isPathInside(root, candidate) {
  const normalizedRoot = normalizeLocalFilePath(root);
  const normalizedCandidate = normalizeLocalFilePath(candidate);
  if (!normalizedRoot || !normalizedCandidate) return false;
  const pathApi = isWindowsPath(normalizedRoot) || isWindowsPath(normalizedCandidate) ? path.win32 : path;
  const from = pathApi.normalize(normalizedRoot);
  const to = pathApi.normalize(normalizedCandidate);
  const relative = pathApi.relative(from, to);
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative));
}

function mediaPolicyForThread(thread = {}, permissionSettings = {}) {
  return {
    threadId: thread?.id || '',
    cwd: thread?.cwd || '',
    sandboxPolicy: normalizeSandboxPolicyValue(permissionSettings?.sandboxPolicy) || 'workspaceWrite',
  };
}

function canServeLocalFilePath(filePath, policy = {}) {
  const target = normalizeLocalFilePath(filePath);
  if (!target) return false;
  if (!existsSync(target)) return false;
  try { if (!statSync(target).isFile()) return false; } catch { return false; }
  if (fileServingMode === 'system') return true;
  const sandboxPolicy = normalizeSandboxPolicyValue(policy?.sandboxPolicy) || 'workspaceWrite';
  if (sandboxPolicy === 'dangerFullAccess') return true;
  return Boolean(policy?.cwd && isPathInside(policy.cwd, target));
}

function localFileScope(_filePath, policy = {}) {
  if (fileServingMode === 'system') return 'system';
  return normalizeSandboxPolicyValue(policy?.sandboxPolicy) === 'dangerFullAccess'
    ? 'dangerFullAccess'
    : `workspace:${normalizeLocalFilePath(policy?.cwd)}`;
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

function listThreadOptionsFromParams(params) {
  const q = (params.get('q') ?? params.get('query') ?? '').trim();
  const repo = (params.get('repo') ?? '').trim();
  const branch = (params.get('branch') ?? '').trim();
  const source = (params.get('source') ?? '').trim();
  const cwd = (params.get('cwd') ?? '').trim();
  const includeArchived = params.get('archived') === '1' || params.get('archived') === 'true';
  const needsLocalFilterWindow = Boolean(repo || branch);
  return {
    includeArchived,
    limit: needsLocalFilterWindow ? 500 : params.get('limit'),
    searchTerm: q,
    cwd,
    sourceKinds: source ? [source] : defaultSourceKinds,
  };
}

async function buildFacets(threads) {
  const repos = new Map();
  const branches = new Map();
  const sources = new Map();

  for (const thread of threads) {
    countFacet(repos, thread.gitInfo?.originUrl || '');
    countFacet(branches, thread.gitInfo?.branch || '');
    countFacet(sources, thread.source || '');
  }
  try {
    const currentGit = await gitInfoForCwd(rootDir);
    ensureFacet(repos, currentGit.originUrl || '');
  } catch {
    // Current repo facet is best-effort only.
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

function ensureFacet(map, value) {
  if (!value || map.has(value)) return;
  map.set(value, 0);
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
  if (!existsSync(sourcePath)) throw new Error(`Source worktree does not exist: ${sourcePath}`);

  const targetRoot = String(body.targetRoot ?? '').trim() || repoWorktreeRoot(sourcePath);
  const targetPath = path.win32.join(targetRoot, branch);
  const existing = await execFileText('git', gitArgs(sourcePath, ['branch', '--list', branch]));
  const branchExists = Boolean(existing.trim());
  const args = branchExists
    ? gitArgs(sourcePath, ['worktree', 'add', targetPath, branch])
    : gitArgs(sourcePath, ['worktree', 'add', '-b', branch, targetPath]);
  const display = branchExists
    ? `git -C ${quoteWinArg(sourcePath)} worktree add ${quoteWinArg(targetPath)} ${quoteWinArg(branch)}`
    : `git -C ${quoteWinArg(sourcePath)} worktree add -b ${quoteWinArg(branch)} ${quoteWinArg(targetPath)}`;
  return {
    sourcePath,
    branch,
    branchExists,
    targetRoot,
    targetPath,
    commands: [{ display, command: 'git', args }],
  };
}

function quoteWinArg(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function quotePowerShellSingle(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function createWorktree(body) {
  if (!body.confirmed) throw new Error('Worktree creation requires confirmation.');
  const plan = await buildWorktreePlan(body);
  if (existsSync(plan.targetPath)) throw new Error(`Target path already exists: ${plan.targetPath}`);
  await mkdir(plan.targetRoot, { recursive: true });
  const command = plan.commands[0];
  await execFileText(command.command, command.args);
  return { ...plan, created: true, worktree: { path: plan.targetPath, branch: plan.branch } };
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
      model: parts.find((part) => part.name === 'model')?.data.toString('utf8') ?? '',
      effort: parts.find((part) => part.name === 'effort')?.data.toString('utf8') ?? '',
      approvalPolicy: parts.find((part) => part.name === 'approvalPolicy')?.data.toString('utf8') ?? '',
      sandboxPolicy: parts.find((part) => part.name === 'sandboxPolicy')?.data.toString('utf8') ?? '',
      networkAccess: parts.find((part) => part.name === 'networkAccess')?.data.toString('utf8') ?? '',
      files: parts.filter((part) => part.name === 'files' && part.filename),
    };
  }

  const body = await readJson(req);
  return { ...body, prompt: String(body.prompt ?? ''), files: [] };
}

function normalizeModelText(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return '';
  return text;
}

function turnOverridesFromPayload(payload = {}) {
  const overrides = {};
  const model = normalizeModelText(payload.model);
  if (model) overrides.model = model;

  const effort = String(payload.effort ?? '').trim().toLowerCase();
  if (['low', 'medium', 'high', 'xhigh'].includes(effort)) {
    overrides.effort = effort;
  }

  const approvalPolicy = String(payload.approvalPolicy ?? '').trim();
  if (['untrusted', 'on-failure', 'on-request', 'granular', 'never'].includes(approvalPolicy)) {
    overrides.approvalPolicy = approvalPolicy;
  }

  const sandboxPolicy = String(payload.sandboxPolicy ?? '').trim();
  if (sandboxPolicy === 'readOnly') {
    overrides.sandboxPolicy = { type: 'readOnly' };
  } else if (sandboxPolicy === 'workspaceWrite') {
    overrides.sandboxPolicy = { type: 'workspaceWrite', networkAccess: payload.networkAccess === 'true' || payload.networkAccess === true || payload.networkAccess === 'on' };
  } else if (sandboxPolicy === 'dangerFullAccess') {
    overrides.sandboxPolicy = { type: 'dangerFullAccess' };
  }

  return overrides;
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

function requireWriteAccess() {
  if (readOnlyMode) throw Object.assign(new Error('Codex Control is running in read-only mode.'), { statusCode: 403 });
}

async function probeDirectoryWrite(dir) {
  const targetDir = String(dir ?? '').trim();
  if (!targetDir) return { canWrite: false, reason: 'No directory available.' };
  const probePath = path.join(targetDir, `.codex-control-probe-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(probePath, 'probe');
    await rm(probePath, { force: true });
    return { canWrite: true };
  } catch (error) {
    return { canWrite: false, reason: error.message };
  }
}

function resolveGitPath(baseDir, value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return path.isAbsolute(text) ? path.normalize(text) : path.resolve(baseDir, text);
}

function parentRepoFromGitCommonDir(gitCommonDir) {
  const normalized = path.normalize(String(gitCommonDir ?? ''));
  const lower = normalized.toLowerCase();
  const marker = `${path.sep}.git${path.sep}`;
  const index = lower.indexOf(marker);
  if (index !== -1) return normalized.slice(0, index);
  if (lower.endsWith(`${path.sep}.git`)) return path.dirname(normalized);
  return '';
}

async function runtimeDiagnostics() {
  await codex.ready;
  const git = {
    branch: '',
    worktreeRoot: rootDir,
    gitCommonDir: '',
    repositoryRoot: '',
    status: '',
    error: '',
  };

  try {
    const [branch, worktreeRoot, gitCommonDir, status] = await Promise.all([
      execFileText('git', ['-C', rootDir, 'branch', '--show-current']).catch(() => ''),
      execFileText('git', ['-C', rootDir, 'rev-parse', '--show-toplevel']).catch(() => rootDir),
      execFileText('git', ['-C', rootDir, 'rev-parse', '--git-common-dir']).catch(() => ''),
      execFileText('git', ['-C', rootDir, 'status', '--short', '--branch']).catch(() => ''),
    ]);
    git.branch = branch.trim();
    git.worktreeRoot = resolveGitPath(rootDir, worktreeRoot.trim()) || rootDir;
    git.gitCommonDir = resolveGitPath(rootDir, gitCommonDir.trim());
    git.repositoryRoot = parentRepoFromGitCommonDir(git.gitCommonDir) || git.worktreeRoot;
    git.status = status.trim();
  } catch (error) {
    git.error = error.message;
  }

  const worktreeAccess = await probeDirectoryWrite(rootDir);
  const gitAccess = git.gitCommonDir ? await probeDirectoryWrite(git.gitCommonDir) : { canWrite: false, reason: 'Git common directory was not found.' };
  const canCommit = Boolean(worktreeAccess.canWrite && gitAccess.canWrite);
  const recommendedWritableRoot = git.repositoryRoot || git.worktreeRoot || rootDir;

  return {
    server: {
      cwd: process.cwd(),
      rootDir,
      publicDir,
      host,
      port,
      readOnly: readOnlyMode,
      fileServingMode,
      codexHome: codex.codexHome,
      node: process.version,
    },
    git,
    access: {
      worktree: worktreeAccess,
      gitMetadata: gitAccess,
      canCommit,
      recommendedWritableRoot,
      currentSessionCanChangePermissions: false,
      permissionMutationSupported: !readOnlyMode,
      permissionMutationReason: readOnlyMode
        ? 'Codex Control is running in read-only mode. Turn, session, and worktree mutations are disabled.'
        : 'Codex app-server supports sandbox and approval overrides on turn/start for future normal turns. It does not apply those overrides to an already-running turn or to this separate agent session sandbox.',
    },
    commands: {
      restartFromCmd: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restart-codex-control.ps1${restartTaskName ? ` -TaskName ${quotePowerShellSingle(restartTaskName)}` : ''}`,
      neededAccess: `Allow this Codex session to write: ${recommendedWritableRoot}`,
    },
  };
}

async function appSettings() {
  let configResult = {};
  let modelResult = { data: [] };
  try {
    await codex.ready;
    [configResult, modelResult] = await Promise.all([
      codex.request('config/read', { includeLayers: false }).catch(() => ({})),
      codex.request('model/list', { limit: 100, includeHidden: false }).catch(() => ({ data: [] })),
    ]);
  } catch {
    // Keep static app settings available even when the child app-server is restarting.
  }
  const config = normalizeConfigSettings(configResult?.config ?? configResult ?? {});
  const models = Array.isArray(modelResult?.data) ? modelResult.data.map(compactModelInfo).filter((model) => model.id) : [];
  return { config, models, readOnly: readOnlyMode, fileServingMode };
}

function compactModelInfo(model = {}) {
  const id = normalizeModelValue(model.id ?? model.model ?? model.name);
  return {
    id,
    model: normalizeModelValue(model.model ?? id),
    displayName: String(model.displayName ?? model.name ?? id),
    defaultReasoningEffort: normalizeEffortValue(model.defaultReasoningEffort),
    supportedReasoningEfforts: (model.supportedReasoningEfforts ?? [])
      .map((entry) => normalizeEffortValue(entry?.reasoningEffort ?? entry))
      .filter(Boolean),
  };
}

function normalizeConfigSettings(config = {}) {
  const model = normalizeModelValue(config.model ?? config.model_id ?? config.modelId ?? config.modelName);
  const effort = normalizeEffortValue(config.model_reasoning_effort ?? config.modelReasoningEffort ?? config.reasoning_effort ?? config.reasoningEffort ?? config.effort);
  return {
    model,
    effort,
    sandboxPolicy: normalizeSandboxPolicyValue(config.sandbox_mode ?? config.sandboxMode ?? config.sandboxPolicy ?? config.sandbox),
    approvalPolicy: normalizeApprovalPolicyValue(config.approval_policy ?? config.approvalPolicy ?? config.approval),
    networkAccess: Boolean(config.sandboxPolicy?.networkAccess ?? config.sandbox?.networkAccess ?? config.networkAccess ?? config.network_access),
  };
}

function normalizeSandboxPolicyValue(value) {
  const raw = typeof value === 'object' ? value?.type : value;
  const text = String(raw ?? '').trim();
  const normalized = text.replace(/[_\s-]+/g, '').toLowerCase();
  if (normalized === 'readonly') return 'readOnly';
  if (normalized === 'workspacewrite') return 'workspaceWrite';
  if (normalized === 'dangerfullaccess') return 'dangerFullAccess';
  return '';
}

function normalizeApprovalPolicyValue(value) {
  const text = String(value ?? '').trim();
  const normalized = text.replace(/[_\s]+/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const aliases = {
    onrequest: 'on-request',
    onfailure: 'on-failure',
    unlesstrusted: 'untrusted',
  };
  const candidate = aliases[normalized.replace(/-/g, '')] ?? normalized;
  return ['untrusted', 'on-failure', 'on-request', 'granular', 'never'].includes(candidate) ? candidate : '';
}

function sendMediaPath(res, filePath) {
  const media = fileServingMode === 'system' ? mediaFromLocalFilePath(filePath, { sandboxPolicy: 'dangerFullAccess' }) : null;
  if (!media) {
    res.writeHead(fileServingMode === 'system' ? 404 : 403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(fileServingMode === 'system' ? 'Not found' : 'System file serving is disabled.');
    return;
  }
  const id = String(media.src ?? '').split('/').pop();
  sendMedia(res, id);
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
    ...(media.filename ? { 'content-disposition': `inline; filename="${String(media.filename).replace(/"/g, '')}"` } : {}),
  });
  if (media.filePath) {
    createReadStream(media.filePath).pipe(res);
    return;
  }
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

    if (url.pathname === '/api/runtime' && req.method === 'GET') {
      sendJson(res, 200, await runtimeDiagnostics());
      return;
    }

    if (url.pathname === '/api/settings' && req.method === 'GET') {
      sendJson(res, 200, await appSettings());
      return;
    }

    if (url.pathname === '/api/codex/restart' && req.method === 'POST') {
      requireWriteAccess();
      if (process.env.CODEX_CONTROL_DEV_RESTART !== '1') {
        sendJson(res, 403, { error: 'Codex restart endpoint is disabled. Set CODEX_CONTROL_DEV_RESTART=1 to use it.' });
        return;
      }
      await codex.restartCodex();
      sendJson(res, 200, { ok: true, message: 'Codex app-server restart initiated.' });
      return;
    }

    if (url.pathname === '/api/media/path' && req.method === 'GET') {
      sendMediaPath(res, url.searchParams.get('path'));
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
      requireWriteAccess();
      sendJson(res, 200, await buildWorktreePlan(await readJson(req)));
      return;
    }

    if (url.pathname === '/api/worktrees' && req.method === 'POST') {
      requireWriteAccess();
      sendJson(res, 200, await createWorktree(await readJson(req)));
      return;
    }

    if (url.pathname === '/api/threads' && req.method === 'GET') {
      const threads = await codex.listThreads(listThreadOptionsFromParams(url.searchParams));
      const facetThreads = await codex.listThreads({ includeArchived: true, limit: 500, sourceKinds: defaultSourceKinds });
      sendJson(res, 200, { data: filterThreads(threads, url.searchParams), facets: await buildFacets(facetThreads) });
      return;
    }

    if (url.pathname === '/api/threads' && req.method === 'POST') {
      requireWriteAccess();
      const payload = await readTurnPayload(req);
      const cwd = String(payload.cwd ?? '').trim();
      if (cwd) {
        const existing = await existingThreadForCwd(cwd);
        if (existing) throw new Error(`This worktree already has a session: ${existing.name || existing.id}. Open that session or create a new worktree.`);
      }
      const overrides = turnOverridesFromPayload(payload);
      const started = await codex.startThread(cwd, overrides);
      const threadId = started.thread?.id;
      if (threadId && (String(payload.prompt ?? '').trim() || payload.files?.length)) {
        const input = await buildTurnInput(threadId, started.thread, payload);
        await codex.startTurn(threadId, input, overrides);
      }
      sendJson(res, 200, { ...started, thread: threadId ? (await codex.readThread(threadId)).thread : started.thread });
      return;
    }

    const nameMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/name$/);
    if (nameMatch && req.method === 'POST') {
      requireWriteAccess();
      const body = await readJson(req);
      sendJson(res, 200, await codex.setThreadName(decodeURIComponent(nameMatch[1]), body.name));
      return;
    }

    const archiveMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/archive$/);
    if (archiveMatch && req.method === 'POST') {
      requireWriteAccess();
      sendJson(res, 200, await codex.archiveThread(decodeURIComponent(archiveMatch[1])));
      return;
    }

    const unarchiveMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/unarchive$/);
    if (unarchiveMatch && req.method === 'POST') {
      requireWriteAccess();
      sendJson(res, 200, await codex.unarchiveThread(decodeURIComponent(unarchiveMatch[1])));
      return;
    }

    const turnMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/turn$/);
    if (turnMatch && req.method === 'POST') {
      requireWriteAccess();
      const threadId = decodeURIComponent(turnMatch[1]);
      const data = await codex.readThread(threadId);
      const payload = await readTurnPayload(req);
      const input = await buildTurnInput(threadId, data.thread, payload);
      await codex.resumeThread(threadId);
      sendJson(res, 200, await codex.startTurn(threadId, input, turnOverridesFromPayload(payload)));
      return;
    }

    const queueActionMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/queue\/([^/]+)\/(remove|steer|move)$/);
    if (queueActionMatch && req.method === 'POST') {
      requireWriteAccess();
      const threadId = decodeURIComponent(queueActionMatch[1]);
      const queuedId = decodeURIComponent(queueActionMatch[2]);
      const action = queueActionMatch[3];
      if (action === 'remove') {
        sendJson(res, 200, { removed: codex.removeQueuedMessage(threadId, queuedId) });
        return;
      }
      if (action === 'move') {
        const body = await readJson(req);
        sendJson(res, 200, { queuedMessages: codex.moveQueuedMessage(threadId, queuedId, body.direction) });
        return;
      }
      sendJson(res, 200, await codex.steerQueuedMessage(threadId, queuedId));
      return;
    }

    const steerMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/steer$/);
    if (steerMatch && req.method === 'POST') {
      requireWriteAccess();
      const threadId = decodeURIComponent(steerMatch[1]);
      const data = await codex.readThread(threadId);
      const input = await buildTurnInput(threadId, data.thread, req);
      sendJson(res, 200, await codex.steerTurn(threadId, input));
      return;
    }

    const interruptMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/interrupt$/);
    if (interruptMatch && req.method === 'POST') {
      requireWriteAccess();
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
    sendError(res, error.statusCode || 500, error);
  }
});

server.listen(port, host, () => {
  console.log(`codex-control listening on http://${host}:${port}`);
});
