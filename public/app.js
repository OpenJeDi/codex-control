const statusEl = document.querySelector('#status');
const listEl = document.querySelector('#sessionList');
const detailEl = document.querySelector('#detail');
const filters = document.querySelector('#filters');
const repoFilter = document.querySelector('#repoFilter');
const addRepo = document.querySelector('#addRepo');
const filterToggle = document.querySelector('#filterToggle');
const filterClose = document.querySelector('#filterClose');
const filterDrawer = document.querySelector('#filterDrawer');
const refresh = document.querySelector('#refresh');
let activeId = null;
let debounceTimer = null;
let repoInitialized = false;

const CRASH_PARTY_REPO = 'git@github.com:OutOfTheBoxProductions/crash-party-prototype.git';
const CUSTOM_REPOS_KEY = 'codex-control.customRepos';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtTime = (seconds) => seconds ? new Date(seconds * 1000).toLocaleString() : '';
const compactPath = (value) => String(value ?? '').replace(/^C:\\Users\\jeroe\\work\\personal\\/i, '');

function displayRepo(originUrl) {
  const text = String(originUrl ?? '').trim();
  if (!text) return 'no repo';
  const match = text.match(/[:/]([^/:/]+\/[^/:/]+?)(?:\.git)?$/);
  if (match) return match[1];
  return text.replace(/\.git$/, '');
}

function customRepos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_REPOS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveCustomRepos(repos) {
  localStorage.setItem(CUSTOM_REPOS_KEY, JSON.stringify([...new Set(repos.map((repo) => String(repo).trim()).filter(Boolean))]));
}

function paramsFromForm() {
  const data = new FormData(filters);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (key === 'groupBranch') continue;
    const trimmed = String(value).trim();
    if (trimmed) params.set(key, trimmed);
  }
  if (filters.archived.checked) params.set('archived', '1');
  params.set('limit', '200');
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
  listEl.innerHTML = '<div class="empty">Loading sessions...</div>';
  try {
    const params = paramsFromForm();
    const { data, facets } = await api(`/api/threads?${params}`);
    updateRepoOptions(facets?.repos ?? []);

    if (!repoInitialized) {
      repoInitialized = true;
      const crashParty = (facets?.repos ?? []).find((repo) => repo.value === CRASH_PARTY_REPO || repo.value.includes('crash-party-prototype'));
      if (crashParty && !repoFilter.value) {
        repoFilter.value = crashParty.value;
        return loadSessions();
      }
    }

    if (!data.length) {
      const archiveHint = filters.archived.checked ? '' : ' Try "search archive" in Filters for older sessions.';
      listEl.innerHTML = `<div class="empty">No sessions match.${archiveHint}</div>`;
      return;
    }

    listEl.innerHTML = filters.groupBranch.checked ? renderBranchGroups(data) : data.map(renderSession).join('');
    for (const button of listEl.querySelectorAll('.session')) {
      button.addEventListener('click', () => loadDetail(button.dataset.id));
    }
  } catch (error) {
    listEl.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function updateRepoOptions(repos) {
  const previous = repoFilter.value;
  const seen = new Set();
  const options = ['<option value="">all repos</option>'];

  for (const repo of repos) {
    seen.add(repo.value);
    const selected = repo.value === previous ? ' selected' : '';
    options.push(`<option value="${escapeHtml(repo.value)}"${selected}>${escapeHtml(displayRepo(repo.value))} (${repo.count})</option>`);
  }

  for (const repo of customRepos()) {
    if (seen.has(repo)) continue;
    const selected = repo === previous ? ' selected' : '';
    options.push(`<option value="${escapeHtml(repo)}"${selected}>${escapeHtml(displayRepo(repo))} (custom)</option>`);
  }

  repoFilter.innerHTML = options.join('');
  if (previous && [...repoFilter.options].some((option) => option.value === previous)) repoFilter.value = previous;
}

function renderBranchGroups(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const branch = session.gitInfo?.branch || 'no branch';
    if (!groups.has(branch)) groups.set(branch, []);
    groups.get(branch).push(session);
  }

  return [...groups.entries()]
    .sort(([, a], [, b]) => (b[0]?.updatedAt ?? 0) - (a[0]?.updatedAt ?? 0))
    .map(([branch, items]) => `
      <section class="session-group">
        <div class="group-title"><span>${escapeHtml(branch)}</span><span>${items.length}</span></div>
        ${items.map(renderSession).join('')}
      </section>`)
    .join('');
}

function renderSession(session) {
  const active = session.id === activeId ? ' active' : '';
  const branch = session.gitInfo?.branch || 'no branch';
  const source = session.source || 'unknown';
  const cwd = compactPath(session.cwd);
  const repo = displayRepo(session.gitInfo?.originUrl);
  return `
    <button class="session${active}" data-id="${escapeHtml(session.id)}">
      <div class="session-title">
        <span>${escapeHtml(session.name || '(unnamed)')}</span>
        <span class="badge">${escapeHtml(source)}</span>
      </div>
      <div class="session-preview">${escapeHtml(session.preview || '')}</div>
      <div class="meta">
        <span class="badge">${escapeHtml(repo)}</span>
        <span class="badge">${escapeHtml(branch)}</span>
        <span class="badge">${escapeHtml(fmtTime(session.updatedAt))}</span>
        <span class="badge">${escapeHtml(cwd)}</span>
      </div>
    </button>`;
}

async function loadDetail(id) {
  activeId = id;
  for (const el of listEl.querySelectorAll('.session')) el.classList.toggle('active', el.dataset.id === id);
  detailEl.innerHTML = '<div class="empty">Loading thread...</div>';
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
  const phase = item.phase ? ` / ${item.phase}` : '';
  return `<article class="item ${escapeHtml(item.type)}">
    <div class="item-type">${escapeHtml(item.type)}${escapeHtml(phase)}</div>
    <pre>${escapeHtml(body)}</pre>
  </article>`;
}

function scheduleLoadSessions() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadSessions, 180);
}

function setDrawerOpen(open) {
  filterDrawer.hidden = !open;
  filterToggle.setAttribute('aria-expanded', String(open));
  filterToggle.classList.toggle('active', open);
}

filters.addEventListener('input', scheduleLoadSessions);
filters.addEventListener('change', scheduleLoadSessions);
filters.addEventListener('submit', (event) => event.preventDefault());
refresh.addEventListener('click', () => { loadHealth(); loadSessions(); });
filterToggle.addEventListener('click', () => setDrawerOpen(filterDrawer.hidden));
filterClose.addEventListener('click', () => setDrawerOpen(false));
addRepo.addEventListener('click', () => {
  const value = window.prompt('Paste a git repository URL to filter by:')?.trim();
  if (!value) return;
  saveCustomRepos([...customRepos(), value]);
  repoFilter.value = value;
  updateRepoOptions([]);
  repoFilter.value = value;
  loadSessions();
});

await loadHealth();
await loadSessions();
