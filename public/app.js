const statusEl = document.querySelector('#status');
const listEl = document.querySelector('#sessionList');
const detailEl = document.querySelector('#detail');
const filters = document.querySelector('#filters');
const repoFilter = document.querySelector('#repoFilter');
const filterToggle = document.querySelector('#filterToggle');
const filterClose = document.querySelector('#filterClose');
const filterDrawer = document.querySelector('#filterDrawer');
const splitter = document.querySelector('#splitter');
const collapseSidebar = document.querySelector('#collapseSidebar');
const expandSidebar = document.querySelector('#expandSidebar');
const newSessionButton = document.querySelector('#newSessionButton');
const newSessionDialog = document.querySelector('#newSessionDialog');
const newSessionForm = document.querySelector('#newSessionForm');
const newRepoSelect = document.querySelector('#newRepoSelect');
const newWorktreeSelect = document.querySelector('#newWorktreeSelect');
const newWorktreeHint = document.querySelector('#newWorktreeHint');
const createWorktreeButton = document.querySelector('#createWorktreeButton');
const closeNewSession = document.querySelector('#closeNewSession');
const cancelNewSession = document.querySelector('#cancelNewSession');
let activeId = null;
let debounceTimer = null;
let detailRefreshTimer = null;
let repoInitialized = false;
let isDraggingSidebar = false;

const CRASH_PARTY_REPO = 'git@github.com:OutOfTheBoxProductions/crash-party-prototype.git';
const CUSTOM_REPOS_KEY = 'codex-control.customRepos';
const SIDEBAR_WIDTH_KEY = 'codex-control.sidebarWidth';
const SIDEBAR_COLLAPSED_KEY = 'codex-control.sidebarCollapsed';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtTime = (seconds) => seconds ? new Date(seconds * 1000).toLocaleString() : '';
const updatedTitle = (seconds) => seconds ? `Updated ${fmtTime(seconds)}` : 'Updated time unknown';
const compactPath = (value) => String(value ?? '').replace(/^C:\\Users\\jeroe\\work\\personal\\/i, '');
const statusType = (thread) => thread?.status?.type || 'idle';
const statusClass = (thread) => statusType(thread).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
const busyStatusTypes = new Set(['externalactive', 'running', 'inprogress']);

function ageLabel(seconds) {
  const timestamp = Number(seconds) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const diff = Math.max(0, Date.now() - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < 30 * 1000) return 'now';
  if (diff < 90 * 1000) return '1m ago';
  if (diff < hour) return `${Math.round(diff / minute)}m ago`;
  if (diff < 90 * minute) return '1h ago';
  if (diff < day) return `${Math.round(diff / hour)}h ago`;
  if (diff < 2 * day) return '1d ago';
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusLabel(thread) {
  const raw = statusType(thread);
  const normalized = raw.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return ({
    notloaded: 'not loaded',
    idle: 'idle',
    externalactive: 'active',
    running: 'running',
    inprogress: 'running',
    waitingonapproval: 'needs approval',
    waitingonuserinput: 'needs input',
    failed: 'failed',
    error: 'error',
  }[raw.toLowerCase()] ?? normalized);
}

function isBusyThread(thread) {
  return busyStatusTypes.has(statusClass(thread));
}

function isNearBottom(el, threshold = 220) {
  if (!el) return false;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

function scrollDetailToBottom({ smooth = false } = {}) {
  const scroller = detailEl.querySelector('.detail-shell .detail');
  if (!scroller) return;
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  updateJumpBottomButton(scroller);
  requestAnimationFrame(() => updateJumpBottomButton(scroller));
}

function updateJumpBottomButton(scroller = detailEl.querySelector('.detail-shell .detail')) {
  const button = detailEl.querySelector('.jump-bottom');
  if (!button || !scroller) return;
  const canScroll = scroller.scrollHeight > scroller.clientHeight + 1;
  button.hidden = !canScroll;
  button.disabled = !canScroll || isNearBottom(scroller);
}

function bindDetailScrollControls() {
  const scroller = detailEl.querySelector('.detail-shell .detail');
  const button = detailEl.querySelector('.jump-bottom');
  if (!scroller || !button) return;
  scroller.addEventListener('scroll', () => updateJumpBottomButton(scroller), { passive: true });
  button.addEventListener('click', () => scrollDetailToBottom());
  updateJumpBottomButton(scroller);
  requestAnimationFrame(() => updateJumpBottomButton(scroller));
}

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

async function api(path, options = {}) {
  const res = await fetch(path, { cache: 'no-store', ...options });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
}

async function jsonApi(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    statusEl.textContent = `Codex home: ${health.codexHome}`;
  } catch (error) {
    statusEl.textContent = `Codex unavailable: ${error.message}`;
  }
}

async function loadSessions({ quiet = false } = {}) {
  if (!quiet) listEl.innerHTML = '<div class="empty">Loading sessions...</div>';
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
    refreshAgeIndicators();
    for (const button of listEl.querySelectorAll('.session')) {
      button.addEventListener('click', () => loadDetail(button.dataset.id));
    }
    if (!activeId && data[0]?.id) await loadDetail(data[0].id);
    else for (const el of listEl.querySelectorAll('.session')) el.classList.toggle('active', el.dataset.id === activeId);
  } catch (error) {
    listEl.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

async function startSessionFromSelectedWorktree(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const prompt = new FormData(form).get('prompt');
  const cwd = newWorktreeSelect.value;
  if (!cwd) return window.alert('Choose a worktree first.');

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Starting...';
  try {
    const data = await jsonApi('/api/threads', { cwd, prompt });
    form.reset();
    newSessionDialog.close();
    if (data.thread?.id) await loadDetail(data.thread.id);
    await loadSessions();
  } catch (error) {
    window.alert(error.message);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Start session';
  }
}

async function createFeatureWorktree() {
  const sourcePath = newWorktreeSelect.value;
  if (!sourcePath) return window.alert('Choose a source worktree first.');
  const branch = window.prompt('New lowercase hyphenated branch/worktree name:');
  if (!branch) return;
  try {
    const plan = await jsonApi('/api/worktree-plan', { sourcePath, branch });
    const ok = window.confirm(`Create this worktree?\n\n${plan.commands.map((command) => command.display).join('\n')}`);
    if (!ok) return;
    const created = await jsonApi('/api/worktrees', { sourcePath, branch, confirmed: true });
    await loadNewSessionWorktrees(created.worktree?.path || created.targetPath);
    await loadSessions();
  } catch (error) {
    window.alert(error.message);
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

  options.push('<option value="__add_repo__">+ Add repo...</option>');
  repoFilter.innerHTML = options.join('');
  if (previous && [...repoFilter.options].some((option) => option.value === previous)) repoFilter.value = previous;
  syncNewSessionRepoOptions();
}

function syncNewSessionRepoOptions() {
  const previous = newRepoSelect.value || repoFilter.value;
  const options = [...repoFilter.options]
    .filter((option) => option.value && option.value !== '__add_repo__')
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.textContent)}</option>`);
  newRepoSelect.innerHTML = options.join('');
  if (previous && [...newRepoSelect.options].some((option) => option.value === previous)) newRepoSelect.value = previous;
}

async function openNewSessionDialog() {
  syncNewSessionRepoOptions();
  if (!newRepoSelect.value && newRepoSelect.options[0]) newRepoSelect.value = newRepoSelect.options[0].value;
  newSessionDialog.showModal();
  await loadNewSessionWorktrees();
}

async function loadNewSessionWorktrees(preferredPath = '') {
  const repo = newRepoSelect.value.trim();
  newWorktreeSelect.innerHTML = '';
  newWorktreeHint.textContent = '';
  createWorktreeButton.disabled = true;
  if (!repo) {
    newWorktreeHint.textContent = 'Choose a repo first.';
    return;
  }

  try {
    newWorktreeSelect.innerHTML = '<option value="">Loading worktrees...</option>';
    const data = await api(`/api/repo-worktrees?repo=${encodeURIComponent(repo)}`);
    const worktrees = (data.worktrees ?? []).filter((item) => !item.bare);
    if (!worktrees.length) {
      newWorktreeSelect.innerHTML = '<option value="">No local worktrees found</option>';
      newWorktreeHint.textContent = 'No known local worktree yet. Open an existing Codex session for this repo first, or add the repo from a known lane.';
      return;
    }

    newWorktreeSelect.innerHTML = worktrees.map((item) => {
      const branch = item.branch || 'detached';
      return `<option value="${escapeHtml(item.path)}">${escapeHtml(branch)} — ${escapeHtml(compactPath(item.path))}</option>`;
    }).join('');
    if (preferredPath && [...newWorktreeSelect.options].some((option) => option.value === preferredPath)) newWorktreeSelect.value = preferredPath;
    createWorktreeButton.disabled = false;
    newWorktreeHint.textContent = `${worktrees.length} worktree${worktrees.length === 1 ? '' : 's'} available.`;
  } catch (error) {
    newWorktreeSelect.innerHTML = '<option value="">Worktrees unavailable</option>';
    newWorktreeHint.textContent = error.message;
  }
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
  const status = statusLabel(session);
  const statusCss = statusClass(session);
  const age = ageLabel(session.updatedAt);
  const info = [
    ['Source', source],
    ['Repo', repo],
    ['Branch', branch],
    ['Updated', fmtTime(session.updatedAt)],
    ['CWD', cwd],
    ['ID', session.id],
  ].map(([label, value]) => `${label}: ${value || '-'}`).join('\n');
  return `
    <button class="session${active}" data-id="${escapeHtml(session.id)}" title="${escapeHtml(info)}">
      <div class="session-title">
        <span>${escapeHtml(session.name || '(unnamed)')}</span>
        <span class="session-flags">
          <span class="badge status ${escapeHtml(statusCss)}">${escapeHtml(status)}</span>
          ${age ? `<span class="session-age" data-updated-at="${escapeHtml(session.updatedAt)}" title="${escapeHtml(updatedTitle(session.updatedAt))}">${escapeHtml(age)}</span>` : ''}
          <span class="info-dot" aria-label="Session info">i</span>
        </span>
      </div>
    </button>`;
}

function refreshAgeIndicators() {
  for (const el of document.querySelectorAll('.session-age[data-updated-at]')) {
    const seconds = Number(el.dataset.updatedAt);
    el.textContent = ageLabel(seconds);
    el.title = updatedTitle(seconds);
  }
}

async function loadDetail(id, { quiet = false } = {}) {
  const previousId = activeId;
  const previousScroller = detailEl.querySelector('.detail-shell .detail');
  const previousScrollTop = previousScroller?.scrollTop ?? 0;
  const shouldContinueFollowing = quiet && id === previousId && isNearBottom(previousScroller);
  activeId = id;
  for (const el of listEl.querySelectorAll('.session')) el.classList.toggle('active', el.dataset.id === id);
  if (!quiet) {
    detailEl.className = 'empty';
    detailEl.innerHTML = '<div class="empty">Loading thread...</div>';
  }
  try {
    const data = await api(`/api/threads/${encodeURIComponent(id)}`);
    detailEl.className = 'detail-host';
    detailEl.innerHTML = renderDetail(data);
    detailEl.querySelector('#promptForm')?.addEventListener('submit', (event) => submitPrompt(event, id));
    bindDetailScrollControls();
    requestAnimationFrame(() => {
      const scroller = detailEl.querySelector('.detail-shell .detail');
      if (!quiet || shouldContinueFollowing) scrollDetailToBottom();
      else if (quiet && scroller) scroller.scrollTop = previousScrollTop;
      updateJumpBottomButton(scroller);
    });
  } catch (error) {
    detailEl.className = 'error';
    detailEl.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function renderDetail({ thread, turns }) {
  const status = statusLabel(thread);
  const statusCss = statusClass(thread);
  return `<div class="detail-shell">
    <div class="detail">
      <div class="detail-head">
        <div>
          <h2>${escapeHtml(thread.name || '(unnamed)')}</h2>
          <div class="preview">${escapeHtml(thread.preview || '')}</div>
        </div>
        <span class="badge status ${escapeHtml(statusCss)}">${escapeHtml(status)}</span>
      </div>
      <div class="kv">
        <strong>ID</strong><span>${escapeHtml(thread.id)}</span>
        <strong>Status</strong><span>${escapeHtml(status)}</span>
        <strong>Source</strong><span>${escapeHtml(thread.source || '')}</span>
        <strong>Updated</strong><span>${escapeHtml(fmtTime(thread.updatedAt))}</span>
        <strong>Branch</strong><span>${escapeHtml(thread.gitInfo?.branch || '')}</span>
        <strong>Repo</strong><span>${escapeHtml(thread.gitInfo?.originUrl || '')}</span>
        <strong>CWD</strong><span>${escapeHtml(thread.cwd || '')}</span>
        <strong>Path</strong><span>${escapeHtml(thread.path || '')}</span>
      </div>
      ${[...turns].reverse().map(renderTurn).join('') || '<div class="empty">No turns returned.</div>'}
      ${renderBusyIndicator(thread)}
    </div>
    <button type="button" class="jump-bottom" hidden>Jump to bottom</button>
    <form class="prompt-bar" id="promptForm">
      <textarea name="prompt" rows="3" placeholder="Send a follow-up to this session"></textarea>
      <div class="prompt-actions">
        <label class="attach-button" title="Attach files">
          <input name="files" type="file" multiple>
          <span>+</span>
        </label>
        <button type="submit">Send</button>
      </div>
    </form>
  </div>`;
}

function renderBusyIndicator(thread) {
  if (!isBusyThread(thread)) return '';
  return `<div class="busy-indicator" role="status" aria-live="polite">
    <span class="busy-label">Agent working</span>
    <span class="busy-dots" aria-hidden="true"><span></span><span></span><span></span></span>
  </div>`;
}

async function submitPrompt(event, id) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  submit.disabled = true;
  submit.textContent = 'Sending...';
  try {
    await fetch(`/api/threads/${encodeURIComponent(id)}/turn`, { method: 'POST', body: formData }).then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      return json;
    });
    form.reset();
    scheduleDetailRefresh(id, 700);
    scheduleLoadSessions();
  } catch (error) {
    window.alert(error.message);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Send';
  }
}

function renderTurn(turn, index) {
  return `<section class="turn">
    <div class="meta"><span class="badge">Turn ${index + 1}</span><span class="badge">${escapeHtml(turn.id)}</span></div>
    ${turn.items.map(renderItem).join('')}
  </section>`;
}

function itemLabel(item) {
  if (item.type === 'userMessage') return 'You';
  if (item.type === 'agentMessage') return item.phase === 'commentary' ? 'Agent note' : 'Agent response';
  if (item.type === 'commandExecution') return 'Command';
  if (item.type === 'reasoning') return 'Reasoning summary';
  if (String(item.type).toLowerCase().includes('file')) return 'File change';
  return String(item.type ?? 'Item').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function looksNoisy(item, body) {
  if (hasRenderableMedia(item)) return false;
  if (item.type === 'commandExecution') return true;
  if (String(item.type).toLowerCase().includes('file')) return true;
  if (body.length > 1200) return true;
  const trimmed = body.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function hasRenderableMedia(item) {
  return Array.isArray(item.parts) && item.parts.some((part) => part.type === 'image');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function renderInlineMarkdown(text) {
  const codeSpans = [];
  let html = String(text ?? '').replace(/`([^`]+)`/g, (_match, code) => {
    const token = `@@CODE${codeSpans.length}@@`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });
  html = escapeHtml(html);
  html = html.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  for (const [index, code] of codeSpans.entries()) html = html.replace(`@@CODE${index}@@`, code);
  return html;
}

function renderMarkdownBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(`<${list.type}>${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 2;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2].trim())}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (!list || list.type !== 'ul') list = { type: 'ul', items: [] };
      list.items.push(bullet[1]);
      continue;
    }
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (!list || list.type !== 'ol') list = { type: 'ol', items: [] };
      list.items.push(numbered[1]);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks.join('') || '<p></p>';
}

function renderMarkdownText(text) {
  const segments = String(text ?? '').replace(/\r\n/g, '\n').split(/```/);
  return `<div class="markdown-body">${segments.map((segment, index) => {
    if (index % 2 === 1) return `<pre class="md-code"><code>${escapeHtml(segment.replace(/^\w+\n/, ''))}</code></pre>`;
    return renderMarkdownBlocks(segment);
  }).join('')}</div>`;
}

function shouldRenderMarkdown(item) {
  return item.type === 'userMessage' || item.type === 'agentMessage' || item.type === 'reasoning';
}

function renderContentParts(item, fallbackBody) {
  const renderText = (text) => shouldRenderMarkdown(item) ? renderMarkdownText(text) : `<pre>${escapeHtml(text)}</pre>`;
  if (!Array.isArray(item.parts) || !item.parts.length) return renderText(fallbackBody);
  return item.parts.map((part) => {
    if (part.type === 'text') return part.text ? renderText(part.text) : '';
    if (part.type === 'image') {
      return `<figure class="session-image"><img src="${escapeHtml(part.src)}" alt="Attached session image" loading="lazy"><figcaption>${escapeHtml(part.contentType || 'image')}</figcaption></figure>`;
    }
    if (part.type === 'unsupportedImage') return '<div class="unsupported-media">Image omitted: unsupported source</div>';
    return '';
  }).join('');
}

function renderItem(item) {
  const body = item.command
    ? `$ ${item.command}\n\n${item.output || ''}`
    : (item.text || '');
  const label = itemLabel(item);
  const noisy = looksNoisy(item, body);
  const preview = noisy ? body.slice(0, 220).replace(/\s+/g, ' ').trim() : body;

  if (noisy) {
    return `<article class="item ${escapeHtml(item.type)} compact-item">
      <details>
        <summary>
          <span>${escapeHtml(label)}</span>
          <small>${escapeHtml(preview || 'expand details')}</small>
        </summary>
        <pre>${escapeHtml(body)}</pre>
      </details>
    </article>`;
  }

  return `<article class="item ${escapeHtml(item.type)}">
    <div class="item-type">${escapeHtml(label)}</div>
    ${renderContentParts(item, body)}
  </article>`;
}

function scheduleLoadSessions() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => loadSessions({ quiet: true }), 180);
}

function scheduleDetailRefresh(id = activeId, delay = 500) {
  if (!id) return;
  clearTimeout(detailRefreshTimer);
  detailRefreshTimer = setTimeout(() => loadDetail(id, { quiet: true }), delay);
}

function connectEvents() {
  const refreshForThread = (threadId, { refreshDetailOnUnknown = false } = {}) => {
    scheduleLoadSessions();
    if (threadId === activeId) scheduleDetailRefresh(activeId, 150);
    else if (!threadId && refreshDetailOnUnknown) scheduleDetailRefresh(activeId, 500);
  };
  const events = new EventSource('/api/events');
  events.addEventListener('codex-notification', (event) => {
    const payload = JSON.parse(event.data || '{}');
    const params = payload.params ?? {};
    const threadId = params.threadId ?? params.thread?.id;
    refreshForThread(threadId, { refreshDetailOnUnknown: true });
  });
  events.addEventListener('threads-changed', (event) => {
    const payload = JSON.parse(event.data || '{}');
    const threadIds = Array.isArray(payload.threadIds) ? payload.threadIds : [];
    refreshForThread(threadIds.includes(activeId) ? activeId : payload.threadId);
  });
  events.addEventListener('codex-exit', () => {
    statusEl.textContent = 'Codex app-server exited';
    events.close();
  });
}

function setDrawerOpen(open) {
  filterDrawer.hidden = !open;
  filterToggle.setAttribute('aria-expanded', String(open));
  filterToggle.classList.toggle('active', open);
}

function applySavedLayout() {
  const savedWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const numericWidth = Number(String(savedWidth ?? '').replace('px', ''));
  if (numericWidth >= 360) document.documentElement.style.setProperty('--sidebar-width', `${numericWidth}px`);
  else localStorage.removeItem(SIDEBAR_WIDTH_KEY);
  setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
}

function resizeSidebar(clientX) {
  const min = 360;
  const max = Math.max(min, window.innerWidth - 420);
  const width = Math.min(max, Math.max(min, clientX));
  const value = `${width}px`;
  document.documentElement.style.setProperty('--sidebar-width', value);
  localStorage.setItem(SIDEBAR_WIDTH_KEY, value);
}

filters.addEventListener('input', scheduleLoadSessions);
filters.addEventListener('change', scheduleLoadSessions);
filters.addEventListener('submit', (event) => event.preventDefault());
filterToggle.addEventListener('click', () => setDrawerOpen(filterDrawer.hidden));
filterClose.addEventListener('click', () => setDrawerOpen(false));
repoFilter.addEventListener('change', () => {
  if (repoFilter.value !== '__add_repo__') return;
  const previous = [...repoFilter.options].find((option) => option.defaultSelected)?.value || '';
  const value = window.prompt('Paste a git repository URL to filter by:')?.trim();
  if (!value) {
    repoFilter.value = previous;
    return;
  }
  saveCustomRepos([...customRepos(), value]);
  updateRepoOptions([]);
  repoFilter.value = value;
  loadSessions();
});
newSessionButton.addEventListener('click', openNewSessionDialog);
newRepoSelect.addEventListener('change', () => loadNewSessionWorktrees());
newSessionForm.addEventListener('submit', startSessionFromSelectedWorktree);
createWorktreeButton.addEventListener('click', createFeatureWorktree);
closeNewSession.addEventListener('click', () => newSessionDialog.close());
cancelNewSession.addEventListener('click', () => newSessionDialog.close());
collapseSidebar.addEventListener('click', () => setSidebarCollapsed(true));
expandSidebar.addEventListener('click', () => setSidebarCollapsed(false));
splitter.addEventListener('pointerdown', (event) => {
  if (document.body.classList.contains('sidebar-collapsed')) return;
  isDraggingSidebar = true;
  splitter.setPointerCapture(event.pointerId);
  document.body.classList.add('resizing-sidebar');
});
splitter.addEventListener('pointermove', (event) => {
  if (!isDraggingSidebar) return;
  resizeSidebar(event.clientX);
});
splitter.addEventListener('pointerup', () => {
  isDraggingSidebar = false;
  document.body.classList.remove('resizing-sidebar');
});
applySavedLayout();
connectEvents();
setInterval(refreshAgeIndicators, 30 * 1000);
await loadHealth();
await loadSessions();
