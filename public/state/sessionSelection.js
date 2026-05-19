const ACTIVE_SESSION_KEY = 'codex-control.activeSession';
const ACTIVE_SESSION_TAB_KEY = 'codex-control.activeSession.tab';

function normalizeSessionId(id) {
  return String(id ?? '').trim();
}

export function savedActiveSession() {
  return sessionStorage.getItem(ACTIVE_SESSION_TAB_KEY) || '';
}

export function saveActiveSession(id) {
  const value = normalizeSessionId(id);
  if (value) sessionStorage.setItem(ACTIVE_SESSION_TAB_KEY, value);
  else sessionStorage.removeItem(ACTIVE_SESSION_TAB_KEY);

  // Older builds stored this cross-tab. Keep clearing it so one tab cannot
  // silently activate another tab's last selected session.
  localStorage.removeItem(ACTIVE_SESSION_KEY);
}

export function createActiveSessionState(initialId = '') {
  let currentId = normalizeSessionId(initialId) || null;

  return {
    get id() {
      return currentId;
    },
    set(id) {
      currentId = normalizeSessionId(id) || null;
      saveActiveSession(currentId);
      return currentId;
    },
    clear() {
      return this.set('');
    },
    is(id) {
      return Boolean(currentId && String(id ?? '') === currentId);
    },
  };
}
