const statusEl = document.querySelector('#status');
const listEl = document.querySelector('#sessionList');
const detailEl = document.querySelector('#detail');
const filters = document.querySelector('#filters');
const refresh = document.querySelector('#refresh');
let activeId = null;
let debounceTimer = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtTime = (seconds) => seconds ? new Date(seconds * 1000).toLocaleString() : '';
const compactPath = (value) => String(value ?? '').replace(/^C:\\Users\\jeroe\\work\\personal\\/i, '');

function paramsFromForm() {
  const data = new FormData(filters);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (value) params.set(key, value);
  }
  if (filters.archived.checked) params.set('archived', '1');
  params.set('limit', '100');
  return params;
}

async function api(path) {
  const res = await fetch(path, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    statusEl.textContent = `Codex home: ${health.codexHome}`;
  } catch (error) {
    statusEl.textContent = `Codex unavailable: ${error.message}`;
  }
}

async function loadSessions() {
  listEl.innerHTML = '<div class="empty">Loading sessions…</div>';
  try {
    const params = paramsFromForm();
    const { data } = await api(`/api/threads?${params}`);
    if (!data.length) {
      listEl.innerHTML = '<div class="empty">No sessions match.</div>';
      return;
    }
    listEl.innerHTML = data.map(renderSession).join('');
    for (const button of listEl.querySelectorAll('.session')) {
      button.addEventListener('click', () => loadDetail(button.dataset.id));
    }
  } catch (error) {
    listEl.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function renderSession(session) {
  const active = session.id === activeId ? ' active' : '';
  const branch = session.gitInfo?.branch || 'no branch';
  const source = session.source || 'unknown';
  const cwd = compactPath(session.cwd);
  return `
    <button class="session${active}" data-id="${escapeHtml(session.id)}">
      <div class="session-title">
        <span>${escapeHtml(session.name || '(unnamed)')}</span>
        <span class="badge">${escapeHtml(source)}</span>
      </div>
      <div class="session-preview">${escapeHtml(session.preview || '')}</div>
      <div class="meta">
        <span class="badge">${escapeHtml(branch)}</span>
        <span class="badge">${escapeHtml(fmtTime(session.updatedAt))}</span>
        <span class="badge">${escapeHtml(cwd)}</span>
      </div>
    </button>`;
}

async function loadDetail(id) {
  activeId = id;
  for (const el of listEl.querySelectorAll('.session')) el.classList.toggle('active', el.dataset.id === id);
  detailEl.innerHTML = '<div class="empty">Loading thread…</div>';
  try {
    const data = await api(`/api/threads/${encodeURIComponent(id)}`);
    detailEl.innerHTML = renderDetail(data);
  } catch (error) {
    detailEl.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function renderDetail({ thread, turns }) {
  return `<div class="detail">
    <h2>${escapeHtml(thread.name || '(unnamed)')}</h2>
    <div class="preview">${escapeHtml(thread.preview || '')}</div>
    <div class="kv">
      <strong>ID</strong><span>${escapeHtml(thread.id)}</span>
      <strong>Status</strong><span>${escapeHtml(thread.status?.type || '')}</span>
      <strong>Source</strong><span>${escapeHtml(thread.source || '')}</span>
      <strong>Updated</strong><span>${escapeHtml(fmtTime(thread.updatedAt))}</span>
      <strong>Branch</strong><span>${escapeHtml(thread.gitInfo?.branch || '')}</span>
      <strong>Repo</strong><span>${escapeHtml(thread.gitInfo?.originUrl || '')}</span>
      <strong>CWD</strong><span>${escapeHtml(thread.cwd || '')}</span>
      <strong>Path</strong><span>${escapeHtml(thread.path || '')}</span>
    </div>
    ${turns.map(renderTurn).join('') || '<div class="empty">No turns returned.</div>'}
  </div>`;
}

function renderTurn(turn, index) {
  return `<section class="turn">
    <div class="meta"><span class="badge">Turn ${index + 1}</span><span class="badge">${escapeHtml(turn.id)}</span></div>
    ${turn.items.map(renderItem).join('')}
  </section>`;
}

function renderItem(item) {
  const body = item.command
    ? `$ ${item.command}\n\n${item.output || ''}`
    : (item.text || '');
  const phase = item.phase ? ` · ${item.phase}` : '';
  return `<article class="item ${escapeHtml(item.type)}">
    <div class="item-type">${escapeHtml(item.type)}${escapeHtml(phase)}</div>
    <pre>${escapeHtml(body)}</pre>
  </article>`;
}

filters.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadSessions, 180);
});
filters.addEventListener('submit', (event) => event.preventDefault());
refresh.addEventListener('click', () => { loadHealth(); loadSessions(); });

await loadHealth();
await loadSessions();
