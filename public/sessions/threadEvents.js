export function threadPatchFromEvent(method, params = {}) {
  const thread = params.thread && typeof params.thread === 'object' ? params.thread : null;
  const threadId = params.threadId ?? params.id ?? thread?.id;
  if (!threadId) return null;
  const lower = String(method ?? '').toLowerCase();
  const status = params.status ?? thread?.status;
  const patch = { ...(thread ?? {}), id: String(threadId) };
  if (params.name !== undefined) patch.name = params.name;
  if (status) patch.status = status;
  else if (lower.includes('turn/started') || lower.includes('turnstarted') || lower.includes('turn/pending') || lower.includes('turn/queued')) patch.status = { type: 'running' };
  else if (lower.includes('turn/completed') || lower.includes('turncompleted') || lower.includes('turn/idle') || lower.includes('interrupt')) patch.status = { type: 'idle' };
  return Object.keys(patch).length > 1 ? patch : null;
}

export function eventNeedsActiveDetailState(method, params = {}) {
  const lower = String(method ?? '').toLowerCase();
  const turnId = params.turnId ?? params.turn?.id;
  if (lower.includes('thread/name') || lower.includes('thread/archive') || lower.includes('thread/unarchive')) return false;
  if (!turnId && params.status && !lower.includes('turn')) return false;
  if (!turnId && params.thread && !lower.includes('turn')) return false;
  return true;
}

export function createThreadEventRouter({
  activeSession,
  isVisibleThread,
  replaceSessionRow,
  patchActiveDetailStatus,
  scheduleSessionRowRefresh,
  scheduleBackgroundLoadSessions,
  scheduleEventDetailRefresh,
  setStatusText,
  createEventSource = (url) => new EventSource(url),
}) {
  function refreshForThread(threadId, eventInfo = {}) {
    const id = String(threadId ?? '');
    const patch = threadPatchFromEvent(eventInfo.method, eventInfo.params);
    if (id && activeSession.is(id)) {
      if (patch) {
        replaceSessionRow(patch);
        patchActiveDetailStatus(patch);
      } else {
        scheduleSessionRowRefresh(id);
      }
      if (eventNeedsActiveDetailState(eventInfo.method, eventInfo.params)) scheduleEventDetailRefresh(id);
      return;
    }
    if (id && isVisibleThread(id)) {
      if (patch) replaceSessionRow(patch);
      else scheduleSessionRowRefresh(id);
      return;
    }
    scheduleBackgroundLoadSessions();
  }

  function refreshForThreads(threadIds = [], eventInfo = {}) {
    const ids = threadIds.map((id) => String(id ?? '')).filter(Boolean);
    if (!ids.length) {
      scheduleBackgroundLoadSessions();
      return;
    }
    const patch = threadPatchFromEvent(eventInfo.method, eventInfo.params);
    const currentId = activeSession.id;
    if (currentId && ids.includes(currentId)) {
      if (patch) {
        replaceSessionRow(patch);
        patchActiveDetailStatus(patch);
      }
      if (eventNeedsActiveDetailState(eventInfo.method, eventInfo.params)) scheduleEventDetailRefresh(currentId);
    }
    const visibleIds = ids.filter((id) => id === currentId || isVisibleThread(id));
    if (visibleIds.length) {
      for (const id of visibleIds) {
        if (patch && String(patch.id) === id) replaceSessionRow(patch);
        else scheduleSessionRowRefresh(id);
      }
    } else {
      scheduleBackgroundLoadSessions();
    }
  }

  function connect() {
    const events = createEventSource('/api/events');
    events.addEventListener('ready', () => {
      scheduleBackgroundLoadSessions();
      if (activeSession.id) scheduleEventDetailRefresh(activeSession.id);
    });
    events.addEventListener('codex-notification', (event) => {
      const payload = JSON.parse(event.data || '{}');
      const params = payload.params ?? {};
      const threadId = params.threadId ?? params.thread?.id;
      refreshForThread(threadId, { method: payload.method, params });
    });
    events.addEventListener('threads-changed', (event) => {
      const payload = JSON.parse(event.data || '{}');
      const threadIds = Array.isArray(payload.threadIds) ? payload.threadIds : [];
      refreshForThreads(threadIds.length ? threadIds : [payload.threadId], { method: payload.source, params: payload });
    });
    events.addEventListener('codex-exit', () => {
      setStatusText('Codex app-server exited');
      events.close();
    });
    return events;
  }

  return {
    connect,
    refreshForThread,
    refreshForThreads,
  };
}
