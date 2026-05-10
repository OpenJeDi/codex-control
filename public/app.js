import { createTranscriptBlockRenderer, createTranscriptItemRenderer } from './transcript/registry.js';
import {
  bindCodeCopyControls,
  bindSessionImageViewer,
  createTranscriptRenderContext,
  escapeAttribute,
  escapeHtml,
  renderCompactDetailsItem,
  renderContentParts,
  renderMarkdownText,
} from './transcript/rendering.js';

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
const runtimeButton = document.querySelector('#runtimeButton');
const runtimeDialog = document.querySelector('#runtimeDialog');
const runtimeContent = document.querySelector('#runtimeContent');
const closeRuntime = document.querySelector('#closeRuntime');
const imageLightbox = document.querySelector('#imageLightbox');
const lightboxImage = document.querySelector('#lightboxImage');
const newSessionDialog = document.querySelector('#newSessionDialog');
const newSessionForm = document.querySelector('#newSessionForm');
const newRepoSelect = document.querySelector('#newRepoSelect');
const addRepoButton = document.querySelector('#addRepoButton');
const addRepoDialog = document.querySelector('#addRepoDialog');
const addRepoForm = document.querySelector('#addRepoForm');
const closeAddRepo = document.querySelector('#closeAddRepo');
const cancelAddRepo = document.querySelector('#cancelAddRepo');
const confirmAddRepo = document.querySelector('#confirmAddRepo');
const repoUrlInput = document.querySelector('#repoUrlInput');
const repoDisplayPreview = document.querySelector('#repoDisplayPreview');
const repoValuePreview = document.querySelector('#repoValuePreview');
const repoError = document.querySelector('#repoError');
const newSessionNameInput = document.querySelector('#newSessionNameInput');
const newWorktreeSelect = document.querySelector('#newWorktreeSelect');
const newWorktreeHint = document.querySelector('#newWorktreeHint');
const createWorktreeButton = document.querySelector('#createWorktreeButton');
const createWorktreeDialog = document.querySelector('#createWorktreeDialog');
const createWorktreeForm = document.querySelector('#createWorktreeForm');
const closeCreateWorktree = document.querySelector('#closeCreateWorktree');
const cancelCreateWorktree = document.querySelector('#cancelCreateWorktree');
const confirmCreateWorktree = document.querySelector('#confirmCreateWorktree');
const worktreeNameInput = document.querySelector('#worktreeNameInput');
const worktreeRootInput = document.querySelector('#worktreeRootInput');
const planSource = document.querySelector('#planSource');
const planBranch = document.querySelector('#planBranch');
const planWorktree = document.querySelector('#planWorktree');
const planCommand = document.querySelector('#planCommand');
const planError = document.querySelector('#planError');
const closeNewSession = document.querySelector('#closeNewSession');
const cancelNewSession = document.querySelector('#cancelNewSession');
let activeId = null;
let debounceTimer = null;
let detailRefreshTimer = null;
let isDraggingSidebar = false;
let lightboxState = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 };
let newSessionWorktrees = [];

const CUSTOM_REPOS_KEY = 'codex-control.customRepos';
const SELECTED_REPO_KEY = 'codex-control.selectedRepo';
const ACTIVE_SESSION_KEY = 'codex-control.activeSession';
const SIDEBAR_WIDTH_KEY = 'codex-control.sidebarWidth';
const SIDEBAR_COLLAPSED_KEY = 'codex-control.sidebarCollapsed';
const PERMISSION_DEFAULTS_KEY = 'codex-control.permissionDefaults';
const PERMISSION_THREADS_KEY = 'codex-control.permissionThreads';
const MODEL_DEFAULTS_KEY = 'codex-control.modelDefaults';
const MODEL_THREADS_KEY = 'codex-control.modelThreads';
const MODEL_OPTIONS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2'];
const EFFORT_OPTIONS = ['low', 'medium', 'high', 'xhigh'];
const PERMISSION_PRESETS = [
  { id: 'review', label: 'review only', sandboxPolicy: 'readOnly', approvalPolicy: 'on-request', networkAccess: false },
  { id: 'normal', label: 'normal coding', sandboxPolicy: 'workspaceWrite', approvalPolicy: 'on-request', networkAccess: false },
  { id: 'trusted', label: 'trusted local', sandboxPolicy: 'dangerFullAccess', approvalPolicy: 'untrusted', networkAccess: false },
  { id: 'full', label: 'full autonomous', sandboxPolicy: 'dangerFullAccess', approvalPolicy: 'never', networkAccess: false },
];
let appSettings = { config: {}, models: [], readOnly: false, fileServingMode: 'session' };

const transcriptRenderContext = createTranscriptRenderContext();
let transcriptBlockRenderer;
let transcriptItemRenderer;
function getTranscriptBlockRenderer() {
  if (transcriptBlockRenderer) return transcriptBlockRenderer;
  transcriptBlockRenderer = createTranscriptBlockRenderer(transcriptRenderContext);
  return transcriptBlockRenderer;
}
function getTranscriptItemRenderer() {
  if (transcriptItemRenderer) return transcriptItemRenderer;
  transcriptItemRenderer = createTranscriptItemRenderer(transcriptRenderContext);
  return transcriptItemRenderer;
}

const truncate = (value, max = 12000) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}\n... truncated ...` : text;
};
const fmtTime = (seconds) => seconds ? new Date(seconds * 1000).toLocaleString() : '';
const fmtMillis = (millis) => millis ? new Date(millis).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const updatedTitle = (seconds) => seconds ? `Updated ${fmtTime(seconds)}` : 'Updated time unknown';
const compactPath = (value) => String(value ?? '')
  .replace(/^[A-Z]:\\Users\\[^\\]+\\/i, '~\\')
  .replace(/^\/home\/[^/]+\//i, '~/')
  .replace(/^\/Users\/[^/]+\//i, '~/');
const statusType = (thread) => thread?.status?.type || 'idle';
const statusClass = (thread) => statusType(thread).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
const busyStatusTypes = new Set(['active', 'externalactive', 'running', 'inprogress']);

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
    notloaded: 'inactive',
    active: 'active',
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

function normalizeModelValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return '';
  return text;
}

function modelFromValue(value) {
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
    value.currentModel,
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
    value.modelId,
    value.modelName,
  ];
  for (const candidate of candidates) {
    const normalized = modelFromValue(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function effortFromValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    return ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(text.toLowerCase()) ? text : '';
  }
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
    const effort = effortFromValue(candidate);
    if (effort) return effort;
  }
  return '';
}

function effortFromThread(thread = {}, turns = []) {
  const direct = effortFromValue(thread) || effortFromValue(thread.config) || effortFromValue(thread.settings) || effortFromValue(thread.metadata);
  if (direct) return direct;
  for (const turn of [...turns].reverse()) {
    const effort = effortFromValue(turn);
    if (effort) return effort;
  }
  return '';
}

function modelFromThread(thread = {}, turns = []) {

  const direct = modelFromValue(thread.model)
    || modelFromValue(thread.currentModel)
    || modelFromValue(thread.config?.model)
    || modelFromValue(thread.settings?.model)
    || modelFromValue(thread.metadata?.model)
    || modelFromValue(thread.provider?.model);
  if (direct) return direct;
  for (const turn of [...turns].reverse()) {
    const model = modelFromValue(turn);
    if (model) return model;
  }
  return '';
}

function inferredModelEvents(thread, turns = [], events = []) {
  const existing = new Set(
    (events ?? [])
      .filter((event) => event.modelFrom || event.modelTo)
      .map((event) => `${event.modelFrom || ''}|${event.modelTo || ''}|${event.turnId || ''}`),
  );
  const inferred = [];
  const chronological = [...turns]
    .slice()
    .sort((a, b) => (Number(a.startedAt) || 0) - (Number(b.startedAt) || 0));
  let previousModel = '';
  for (const turn of chronological) {
    const model = modelFromValue(turn);
    if (!model) continue;
    if (!previousModel) {
      previousModel = model;
      continue;
    }
    if (model === previousModel) continue;
    const key = `${previousModel}|${model}|${turn.id || ''}`;
    if (!existing.has(key)) {
      inferred.push({
        at: Number(turn.startedAt) || Date.now(),
        method: 'turn/model/changed',
        turnId: turn.id || null,
        message: `Model changed: ${previousModel || 'unknown'} -> ${model}`,
        modelFrom: previousModel,
        modelTo: model,
      });
    }
    previousModel = model;
  }
  return inferred;
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
  const atBottom = isNearBottom(scroller);
  const shouldShowButton = canScroll && !atBottom;
  button.hidden = !shouldShowButton;
  button.disabled = !shouldShowButton;
}

function captureOpenTurnDetails() {
  const open = new Set();
  detailEl.querySelectorAll('.turn[data-turn-id]').forEach((turn, index) => {
    const details = turn.querySelector('.turn-details');
    if (details?.open) open.add(turn.dataset.turnId || String(index));
  });
  return open;
}

function restoreOpenTurnDetails(open) {
  if (!open?.size) return;
  detailEl.querySelectorAll('.turn[data-turn-id]').forEach((turn, index) => {
    const details = turn.querySelector('.turn-details');
    if (details && open.has(turn.dataset.turnId || String(index))) details.open = true;
  });
}

function restoreSessionDetailsOpen(open) {
  const details = detailEl.querySelector('.session-meta');
  if (details) details.open = Boolean(open);
}
function captureScrollAnchor(scroller) {
  if (!scroller) return null;
  const turns = [...scroller.querySelectorAll('.turn[data-turn-id]')];
  const top = scroller.getBoundingClientRect().top;
  let best = null;
  for (const turn of turns) {
    const rect = turn.getBoundingClientRect();
    if (rect.bottom < top) continue;
    best = {
      turnId: turn.dataset.turnId,
      offset: rect.top - top,
    };
    break;
  }
  return best;
}

function restoreScrollAnchor(scroller, anchor, fallbackScrollTop = 0) {
  if (!scroller) return;
  if (!anchor?.turnId) {
    scroller.scrollTop = fallbackScrollTop;
    return;
  }
  const target = scroller.querySelector(`.turn[data-turn-id="${CSS.escape(anchor.turnId)}"]`);
  if (!target) {
    scroller.scrollTop = fallbackScrollTop;
    return;
  }
  const top = scroller.getBoundingClientRect().top;
  const rect = target.getBoundingClientRect();
  scroller.scrollTop += rect.top - top - anchor.offset;
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

function repoWebUrl(originUrl) {
  const text = String(originUrl ?? '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text.replace(/\.git$/, '');
  const ssh = text.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const sshUrl = text.match(/^ssh:\/\/git@([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshUrl) return `https://${sshUrl[1]}/${sshUrl[2]}`;
  return '';
}

function renderRepoLink(originUrl) {
  const label = displayRepo(originUrl);
  const url = repoWebUrl(originUrl);
  if (!url) return escapeHtml(originUrl || '');
  return `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function customRepos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_REPOS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function savedSelectedRepo() {
  return localStorage.getItem(SELECTED_REPO_KEY) || '';
}

function saveSelectedRepo(repo) {
  const value = String(repo ?? '').trim();
  if (value) localStorage.setItem(SELECTED_REPO_KEY, value);
  else localStorage.removeItem(SELECTED_REPO_KEY);
}

function savedActiveSession() {
  return localStorage.getItem(ACTIVE_SESSION_KEY) || '';
}

function saveActiveSession(id) {
  const value = String(id ?? '').trim();
  if (value) localStorage.setItem(ACTIVE_SESSION_KEY, value);
  else localStorage.removeItem(ACTIVE_SESSION_KEY);
}

function saveCustomRepos(repos) {
  localStorage.setItem(CUSTOM_REPOS_KEY, JSON.stringify([...new Set(repos.map((repo) => String(repo).trim()).filter(Boolean))]));
}
function readJsonLocalStorage(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function permissionDefaults() {
  return normalizePermissionPreference(readJsonLocalStorage(PERMISSION_DEFAULTS_KEY, {}));
}

function permissionThreadPrefs() {
  return readJsonLocalStorage(PERMISSION_THREADS_KEY, {});
}

function permissionForThread(threadId) {
  const prefs = permissionThreadPrefs();
  return Object.prototype.hasOwnProperty.call(prefs, String(threadId)) ? normalizePermissionPreference(prefs[String(threadId)]) : null;
}

function normalizePermissionPreference(value = {}) {
  const sandboxPolicy = String(typeof value.sandboxPolicy === 'object' ? value.sandboxPolicy?.type : value.sandboxPolicy ?? '').trim();
  const approvalPolicy = String(value.approvalPolicy ?? '').trim();
  return {
    sandboxPolicy: ['readOnly', 'workspaceWrite', 'dangerFullAccess'].includes(sandboxPolicy) ? sandboxPolicy : '',
    approvalPolicy: ['untrusted', 'on-failure', 'on-request', 'granular', 'never'].includes(approvalPolicy) ? approvalPolicy : '',
    networkAccess: Boolean(value.networkAccess),
  };
}

function configPermissionPreference() {
  return normalizePermissionPreference(appSettings.config ?? {});
}

function preferenceFromServerSettings(settings = {}) {
  return normalizePermissionPreference({
    sandboxPolicy: settings.sandboxPolicy?.type || '',
    approvalPolicy: settings.approvalPolicy || '',
    networkAccess: Boolean(settings.sandboxPolicy?.networkAccess),
  });
}

function effectivePermissionPreference(threadId = '', serverSettings = {}) {
  const defaults = permissionDefaults();
  const server = preferenceFromServerSettings(serverSettings);
  const thread = threadId ? permissionForThread(threadId) ?? {} : {};
  const config = configPermissionPreference();
  const effective = {
    ...config,
    ...defaults,
    ...server,
    ...thread,
  };
  return {
    ...effective,
    explicit: isPermissionExplicit(effective, config),
  };
}

function preferenceFromControls(root) {
  const explicit = root?.querySelector('[name="permissionPreset"]')?.dataset.explicit === '1';
  return normalizePermissionPreference({
    sandboxPolicy: root?.querySelector('[name="sandboxPolicy"]')?.value || '',
    approvalPolicy: root?.querySelector('[name="approvalPolicy"]')?.value || '',
    networkAccess: explicit && Boolean(root?.querySelector('[name="networkAccess"]')?.checked),
  });
}

function applyPermissionPreference(root, pref = permissionDefaults()) {
  const normalized = normalizePermissionPreference(pref);
  const config = configPermissionPreference();
  const effective = { ...config, ...normalized };
  const explicit = isPermissionExplicit(effective, config);
  const sandbox = root?.querySelector('[name="sandboxPolicy"]');
  const approval = root?.querySelector('[name="approvalPolicy"]');
  const network = root?.querySelector('[name="networkAccess"]');
  const rawSandbox = root?.querySelector('[name="sandboxPolicyRaw"]');
  const rawApproval = root?.querySelector('[name="approvalPolicyRaw"]');
  const preset = root?.querySelector('[name="permissionPreset"]');
  if (sandbox) sandbox.value = explicit ? normalized.sandboxPolicy : '';
  if (approval) approval.value = explicit ? normalized.approvalPolicy : '';
  if (rawSandbox) rawSandbox.value = effective.sandboxPolicy;
  if (rawApproval) rawApproval.value = effective.approvalPolicy;
  if (network) network.checked = effective.networkAccess;
  if (preset) {
    ensurePermissionPresetOption(preset, effective);
    preset.value = permissionPresetId(effective);
    preset.dataset.explicit = explicit ? '1' : '0';
  }
  updateSettingSource(root?.querySelector('[data-source-for="permission"]'), explicit);
}

function savePermissionDefaults(pref) {
  localStorage.setItem(PERMISSION_DEFAULTS_KEY, JSON.stringify(normalizePermissionPreference(pref)));
}

function saveThreadPermission(threadId, pref) {
  if (!threadId) return;
  const current = permissionThreadPrefs();
  current[String(threadId)] = normalizePermissionPreference(pref);
  localStorage.setItem(PERMISSION_THREADS_KEY, JSON.stringify(current));
}

function permissionPayload(pref = permissionDefaults()) {
  const normalized = normalizePermissionPreference(pref);
  return {
    sandboxPolicy: normalized.sandboxPolicy,
    approvalPolicy: normalized.approvalPolicy,
    networkAccess: normalized.networkAccess,
  };
}

function bindPermissionPreferenceControls(root, threadId = '') {
  const bindingKey = threadId || 'global';
  root?.querySelectorAll('[name="permissionPreset"], [name="sandboxPolicyRaw"], [name="approvalPolicyRaw"], [name="networkAccess"]').forEach((control) => {
    if (control.dataset.permissionBinding === bindingKey) return;
    control.dataset.permissionBinding = bindingKey;
    control.addEventListener('change', () => {
      syncPermissionControls(root, control);
      const pref = preferenceFromControls(root);
      savePermissionDefaults(pref);
      if (threadId) saveThreadPermission(threadId, pref);
    });
  });
  syncPermissionControls(root);
}

function isPermissionExplicit(pref = {}, config = configPermissionPreference()) {
  const normalized = normalizePermissionPreference(pref);
  const base = normalizePermissionPreference(config);
  return Boolean(
    normalized.sandboxPolicy && normalized.sandboxPolicy !== base.sandboxPolicy ||
    normalized.approvalPolicy && normalized.approvalPolicy !== base.approvalPolicy ||
    Boolean(normalized.networkAccess) !== Boolean(base.networkAccess)
  );
}

function permissionPresetId(pref = {}) {
  const normalized = normalizePermissionPreference(pref);
  const match = PERMISSION_PRESETS.find((preset) =>
    preset.sandboxPolicy === normalized.sandboxPolicy &&
    preset.approvalPolicy === normalized.approvalPolicy &&
    Boolean(preset.networkAccess) === Boolean(normalized.networkAccess)
  );
  return match?.id ?? 'custom';
}

function permissionPresetLabel(pref = {}) {
  const normalized = normalizePermissionPreference(pref);
  const preset = PERMISSION_PRESETS.find((entry) => entry.id === permissionPresetId(normalized));
  if (preset) return preset.label;
  const sandbox = normalized.sandboxPolicy || 'config sandbox';
  const approval = normalized.approvalPolicy || 'config approvals';
  return `${sandbox} / ${approval}${normalized.networkAccess ? ' / network' : ''}`;
}

function permissionPresetById(id) {
  return PERMISSION_PRESETS.find((preset) => preset.id === id) ?? null;
}

function ensurePermissionPresetOption(select, pref = {}) {
  const id = permissionPresetId(pref);
  if (id !== 'custom' || !select || [...select.options].some((option) => option.value === 'custom')) return;
  select.insertAdjacentHTML('beforeend', `<option value="custom">${escapeHtml(permissionPresetLabel(pref))}</option>`);
}

function syncPermissionControls(root, changedControl = null) {
  if (!root) return;
  const preset = root.querySelector('[name="permissionPreset"]');
  const sandbox = root.querySelector('[name="sandboxPolicy"]');
  const approval = root.querySelector('[name="approvalPolicy"]');
  const network = root.querySelector('[name="networkAccess"]');
  const rawSandbox = root.querySelector('[name="sandboxPolicyRaw"]');
  const rawApproval = root.querySelector('[name="approvalPolicyRaw"]');
  if (!preset || !sandbox || !approval) return;

  let explicit = preset.dataset.explicit === '1';
  if (changedControl) explicit = true;

  if (changedControl === preset) {
    const selected = permissionPresetById(preset.value);
    if (selected) {
      if (rawSandbox) rawSandbox.value = selected.sandboxPolicy;
      if (rawApproval) rawApproval.value = selected.approvalPolicy;
      if (network) network.checked = selected.networkAccess;
    }
  } else if (changedControl === rawSandbox || changedControl === rawApproval || changedControl === network) {
    const rawPref = normalizePermissionPreference({
      sandboxPolicy: rawSandbox?.value || '',
      approvalPolicy: rawApproval?.value || '',
      networkAccess: Boolean(network?.checked),
    });
    ensurePermissionPresetOption(preset, rawPref);
    preset.value = permissionPresetId(rawPref);
  }

  const current = normalizePermissionPreference({
    sandboxPolicy: rawSandbox?.value || '',
    approvalPolicy: rawApproval?.value || '',
    networkAccess: Boolean(network?.checked),
  });
  explicit = explicit && isPermissionExplicit(current);
  ensurePermissionPresetOption(preset, current);
  preset.value = permissionPresetId(current);
  preset.dataset.explicit = explicit ? '1' : '0';
  sandbox.value = explicit ? current.sandboxPolicy : '';
  approval.value = explicit ? current.approvalPolicy : '';
  updateSettingSource(root.querySelector('[data-source-for="permission"]'), explicit);
}

function modelDefaults() {
  return normalizeModelPreference(readJsonLocalStorage(MODEL_DEFAULTS_KEY, {}));
}

function modelThreadPrefs() {
  return readJsonLocalStorage(MODEL_THREADS_KEY, {});
}

function modelForThread(threadId) {
  const prefs = modelThreadPrefs();
  return Object.prototype.hasOwnProperty.call(prefs, String(threadId)) ? normalizeModelPreference(prefs[String(threadId)]) : null;
}

function normalizeModelPreference(value = {}) {
  const model = normalizeModelValue(value.model);
  const effort = String(value.effort ?? '').trim().toLowerCase();
  return {
    model,
    effort: EFFORT_OPTIONS.includes(effort) ? effort : '',
  };
}

function configModelPreference() {
  const fromConfig = normalizeModelPreference(appSettings.config ?? {});
  const firstModel = modelOptions()[0]?.id || MODEL_OPTIONS[0] || '';
  return {
    model: fromConfig.model || firstModel,
    effort: fromConfig.effort || effortOptionsForModel(fromConfig.model || firstModel)[0] || 'medium',
  };
}

function effectiveModelPreference(threadId = '') {
  const defaults = modelDefaults();
  const thread = threadId ? modelForThread(threadId) ?? {} : {};
  const config = configModelPreference();
  const selectedModel = thread.model || defaults.model || config.model;
  const selectedEffort = thread.effort || defaults.effort || config.effort;
  const explicitModel = isModelExplicit(selectedModel, config.model);
  const explicitEffort = isEffortExplicit(selectedEffort, config.effort);
  return {
    model: explicitModel ? selectedModel : config.model,
    effort: explicitEffort ? selectedEffort : config.effort,
    explicitModel,
    explicitEffort,
  };
}

function modelPreferenceFromControls(root) {
  return normalizeModelPreference({
    model: root?.querySelector('[name="model"]')?.value || '',
    effort: root?.querySelector('[name="effort"]')?.value || '',
  });
}

function applyModelPreference(root, pref = modelDefaults()) {
  const normalized = normalizeModelPreference(pref);
  const config = configModelPreference();
  const effective = { ...config, ...normalized };
  const explicitModel = isModelExplicit(effective.model, config.model);
  const explicitEffort = isEffortExplicit(effective.effort, config.effort);
  const model = root?.querySelector('[data-setting-kind="model"]');
  const effort = root?.querySelector('[data-setting-kind="effort"]');
  const modelValue = root?.querySelector('[name="model"]');
  const effortValue = root?.querySelector('[name="effort"]');
  if (model) {
    renderModelOptions(model, effective.model);
    model.value = effective.model;
    model.dataset.explicit = explicitModel ? '1' : '0';
  }
  if (effort) {
    renderEffortOptions(effort, effective.model, effective.effort);
    effort.value = effective.effort;
    effort.dataset.explicit = explicitEffort ? '1' : '0';
  }
  if (modelValue) modelValue.value = explicitModel ? normalized.model : '';
  if (effortValue) effortValue.value = explicitEffort ? normalized.effort : '';
  updateSettingSource(root?.querySelector('[data-source-for="model"]'), explicitModel);
  updateSettingSource(root?.querySelector('[data-source-for="effort"]'), explicitEffort);
}

function isModelExplicit(model, configModel = configModelPreference().model) {
  const value = normalizeModelValue(model);
  const base = normalizeModelValue(configModel);
  return Boolean(value && value !== base);
}

function isEffortExplicit(effort, configEffort = configModelPreference().effort) {
  const value = effortFromValue(effort);
  const base = effortFromValue(configEffort);
  return Boolean(value && value !== base);
}

function saveModelDefaults(pref) {
  localStorage.setItem(MODEL_DEFAULTS_KEY, JSON.stringify(normalizeModelPreference(pref)));
}

function saveThreadModel(threadId, pref) {
  if (!threadId) return;
  const current = modelThreadPrefs();
  current[String(threadId)] = normalizeModelPreference(pref);
  localStorage.setItem(MODEL_THREADS_KEY, JSON.stringify(current));
}

function modelPayload(pref = modelDefaults()) {
  const normalized = normalizeModelPreference(pref);
  return {
    model: normalized.model,
    effort: normalized.effort,
  };
}

function bindModelPreferenceControls(root, threadId = '') {
  const bindingKey = threadId || 'global';
  root?.querySelectorAll('[data-setting-kind="model"], [data-setting-kind="effort"]').forEach((control) => {
    if (control.dataset.modelBinding === bindingKey) return;
    control.dataset.modelBinding = bindingKey;
    control.addEventListener('change', () => {
      syncModelControls(root, control);
      const pref = modelPreferenceFromControls(root);
      saveModelDefaults(pref);
      if (threadId) saveThreadModel(threadId, pref);
    });
  });
  syncModelControls(root);
}

function ensureModelOption(select, model) {
  if (!select || !model || [...select.options].some((option) => option.value === model)) return;
  select.insertAdjacentHTML('beforeend', `<option value="${escapeAttribute(model)}">${escapeHtml(model)}</option>`);
}

function modelOptions() {
  const fromServer = (appSettings.models ?? []).map((model) => ({
    id: normalizeModelValue(model.id ?? model.model),
    label: model.displayName && model.displayName !== (model.id ?? model.model) ? `${model.displayName} (${model.id ?? model.model})` : (model.id ?? model.model),
    defaultReasoningEffort: effortFromValue(model.defaultReasoningEffort),
    supportedReasoningEfforts: (model.supportedReasoningEfforts ?? []).map(effortFromValue).filter(Boolean),
  })).filter((model) => model.id);
  const fallback = MODEL_OPTIONS.map((model) => ({ id: model, label: model, defaultReasoningEffort: '', supportedReasoningEfforts: EFFORT_OPTIONS }));
  const seen = new Set();
  return [...fromServer, ...fallback].filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function effortOptionsForModel(model) {
  const found = modelOptions().find((entry) => entry.id === model);
  const efforts = found?.supportedReasoningEfforts?.length ? found.supportedReasoningEfforts : EFFORT_OPTIONS;
  return efforts.filter((effort) => EFFORT_OPTIONS.includes(effort));
}

function renderModelOptions(select, selected = '') {
  if (!select) return;
  const options = modelOptions();
  select.innerHTML = options.map((model) => `<option value="${escapeAttribute(model.id)}"${model.id === selected ? ' selected' : ''}>${escapeHtml(model.label)}</option>`).join('');
  ensureModelOption(select, selected);
}

function renderEffortOptions(select, model, selected = '') {
  if (!select) return;
  const efforts = [...new Set([...effortOptionsForModel(model), selected].filter(Boolean))];
  select.innerHTML = efforts.map((effort) => `<option value="${escapeAttribute(effort)}"${effort === selected ? ' selected' : ''}>${escapeHtml(effort)}</option>`).join('');
}

function syncModelControls(root, changedControl = null) {
  if (!root) return;
  const model = root.querySelector('[data-setting-kind="model"]');
  const effort = root.querySelector('[data-setting-kind="effort"]');
  const modelValue = root.querySelector('[name="model"]');
  const effortValue = root.querySelector('[name="effort"]');
  if (!model || !effort || !modelValue || !effortValue) return;
  if (changedControl === model) {
    model.dataset.explicit = '1';
    if (effort.dataset.explicit !== '1') {
      const options = effortOptionsForModel(model.value);
      const defaultEffort = modelOptions().find((entry) => entry.id === model.value)?.defaultReasoningEffort || options[0] || effort.value;
      renderEffortOptions(effort, model.value, defaultEffort);
      effort.value = defaultEffort;
    } else {
      renderEffortOptions(effort, model.value, effort.value);
    }
  }
  if (changedControl === effort) effort.dataset.explicit = '1';
  const config = configModelPreference();
  const explicitModel = model.dataset.explicit === '1' && isModelExplicit(model.value, config.model);
  const explicitEffort = effort.dataset.explicit === '1' && isEffortExplicit(effort.value, config.effort);
  model.dataset.explicit = explicitModel ? '1' : '0';
  effort.dataset.explicit = explicitEffort ? '1' : '0';
  modelValue.value = explicitModel ? model.value : '';
  effortValue.value = explicitEffort ? effort.value : '';
  updateSettingSource(root.querySelector('[data-source-for="model"]'), explicitModel);
  updateSettingSource(root.querySelector('[data-source-for="effort"]'), explicitEffort);
}

function updateSettingSource(dot, explicit) {
  if (!dot) return;
  dot.classList.toggle('explicit', Boolean(explicit));
  dot.classList.toggle('inherited', !explicit);
  dot.title = explicit ? 'Explicit override' : 'Using config value';
}

function isReadOnly() {
  return Boolean(appSettings.readOnly);
}

function applyAccessMode() {
  document.body.classList.toggle('read-only-mode', isReadOnly());
  if (newSessionButton) newSessionButton.hidden = isReadOnly();
  if (addRepoButton) addRepoButton.hidden = isReadOnly();
  if (createWorktreeButton) createWorktreeButton.hidden = isReadOnly();
}

function normalizeRepoInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^(https?:\/\/|git@|ssh:\/\/)/i.test(text) && /^[^\s/]+\/[^\s/]+$/.test(text) && !text.includes(':')) return `git@github.com:${text.replace(/\.git$/, '')}.git`;
  return text;
}

function openAddRepoDialog() {
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  addRepoForm.reset();
  repoError.textContent = '';
  repoDisplayPreview.textContent = '-';
  repoValuePreview.textContent = '-';
  confirmAddRepo.disabled = true;
  addRepoDialog.showModal();
  repoUrlInput.focus();
}

function bindBackdropClose(dialog) {
  dialog?.addEventListener('click', (event) => {
    const card = dialog.querySelector('.modal-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (outside) dialog.close();
  });
}

function updateRepoPreview() {
  const repo = normalizeRepoInput(repoUrlInput.value);
  repoError.textContent = '';
  repoDisplayPreview.textContent = repo ? displayRepo(repo) : '-';
  repoValuePreview.textContent = repo || '-';
  confirmAddRepo.disabled = !repo;
}

async function addRepository(event) {
  event.preventDefault();
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  const repo = normalizeRepoInput(repoUrlInput.value);
  if (!repo) return;
  saveCustomRepos([...customRepos(), repo]);
  updateRepoOptions([]);
  repoFilter.value = repo;
  newRepoSelect.value = repo;
  saveSelectedRepo(repo);
  addRepoDialog.close();
  await loadNewSessionWorktrees();
  await loadSessions();
}


function paramsFromForm() {
  const data = new FormData(filters);
  const params = new URLSearchParams();
  for (const [key, value] of data.entries()) {
    if (key === 'groupBranch') continue;
    const trimmed = String(value).trim();
    if (trimmed) params.set(key, trimmed);
  }
  if (!params.has('repo') && savedSelectedRepo()) params.set('repo', savedSelectedRepo());
  if (filters.archived.checked) params.set('archived', '1');
  params.set('limit', '200');
  return params;
}

async function api(path, options = {}) {
  const res = await fetch(path, { cache: 'no-store', ...options });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text || res.statusText };
  }
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

async function loadSettings() {
  try {
    const settings = await api('/api/settings');
    appSettings = {
      config: settings.config ?? {},
      models: Array.isArray(settings.models) ? settings.models : [],
      readOnly: Boolean(settings.readOnly),
      fileServingMode: settings.fileServingMode || 'session',
    };
  } catch {
    appSettings = { config: {}, models: [], readOnly: false, fileServingMode: 'session' };
  }
  applyAccessMode();
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    statusEl.textContent = `Codex home: ${health.codexHome}`;
  } catch (error) {
    statusEl.textContent = `Codex unavailable: ${error.message}`;
  }
}

async function openRuntimeDialog() {
  runtimeDialog.showModal();
  runtimeContent.innerHTML = '<div class="empty">Loading runtime diagnostics...</div>';
  try {
    runtimeContent.innerHTML = renderRuntimeDiagnostics(await api('/api/runtime'));
    bindRuntimeCopyButtons();
  } catch (error) {
    runtimeContent.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function renderRuntimeDiagnostics(data) {
  const access = data.access ?? {};
  const git = data.git ?? {};
  const server = data.server ?? {};
  const commands = data.commands ?? {};
  const gitStatus = String(git.status ?? '').trim();
  const canChangePermissions = Boolean(access.currentSessionCanChangePermissions);
  const canCommit = Boolean(access.canCommit);
  const serverReadOnly = Boolean(server.readOnly);
  const hasGitError = Boolean(git.error);
  const hasNeededAccessCommand = Boolean(String(commands.neededAccess || '').trim());
  const hasRestartCommand = Boolean(String(commands.restartFromCmd || '').trim());
  const statusTone = hasGitError || !canCommit ? 'bad' : (serverReadOnly || !canChangePermissions ? 'warn' : 'ok');
  const statusText = statusTone === 'ok'
    ? 'Everything needed for normal local use is available.'
    : statusTone === 'warn'
      ? 'Usable, but some access is limited.'
      : 'Commits or writes are blocked.';
  return `
    <section class="runtime-summary ${escapeHtml(statusTone)}">
      <strong>${escapeHtml(statusText)}</strong>
      <span>${escapeHtml(git.branch || 'No branch detected')}</span>
    </section>
    <section class="runtime-section">
      <dl class="runtime-basics">
        <dt>Server</dt><dd>${escapeHtml(serverReadOnly ? 'read only' : 'read/write')} at ${escapeHtml(`${server.host || '127.0.0.1'}:${server.port || ''}`)}</dd>
        <dt>File serving</dt><dd>${escapeHtml(server.fileServingMode === 'system' ? 'system files' : 'session policy')}</dd>
        <dt>Worktree</dt><dd>${escapeHtml(git.worktreeRoot || '-')}</dd>
        <dt>Commit access</dt><dd>${escapeHtml(canCommit ? 'ready' : 'blocked')}</dd>
        <dt>Permissions</dt><dd>${escapeHtml(canChangePermissions ? 'adjustable for future turns' : access.permissionMutationReason || 'fixed for this session')}</dd>
      </dl>
    </section>
    ${!canCommit && hasNeededAccessCommand ? renderRuntimeCommand('Grant needed access', commands.neededAccess) : ''}
    ${hasRestartCommand ? renderRuntimeCommand('Restart command', commands.restartFromCmd) : ''}
    ${gitStatus ? `<details class="runtime-section runtime-details"><summary>Show git status</summary><pre>${escapeHtml(gitStatus)}</pre></details>` : ''}
  `;
}

function renderRuntimeCard(title, state, tone, rows) {
  return `<section class="runtime-card ${escapeHtml(tone)}">
    <div class="runtime-card-head">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(state)}</span>
    </div>
    <dl>
      ${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}
    </dl>
  </section>`;
}

function renderRuntimeCommand(title, command) {
  const value = String(command ?? '').trim();
  return `<section class="runtime-section runtime-command">
    <div class="runtime-section-head">
      <strong>${escapeHtml(title)}</strong>
      <button type="button" class="runtime-copy" data-copy="${escapeAttribute(value)}"${value ? '' : ' disabled'}>Copy</button>
    </div>
    <pre>${escapeHtml(value || 'No command available.')}</pre>
  </section>`;
}

function bindRuntimeCopyButtons() {
  runtimeContent.querySelectorAll('.runtime-copy').forEach((button) => {
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy || '');
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy'; }, 1200);
      } catch {
        window.alert('Could not copy text.');
      }
    };
  });
}

async function loadSessions({ quiet = false } = {}) {
  if (!quiet) listEl.innerHTML = '<div class="empty">Loading sessions...</div>';
  try {
    const params = paramsFromForm();
    const { data, facets } = await api(`/api/threads?${params}`);
    updateRepoOptions(facets?.repos ?? []);

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
    if (!activeId) {
      const savedId = savedActiveSession();
      const targetId = data.some((thread) => thread.id === savedId) ? savedId : data[0]?.id;
      if (targetId) await loadDetail(targetId);
    }
    else for (const el of listEl.querySelectorAll('.session')) el.classList.toggle('active', el.dataset.id === activeId);
  } catch (error) {
    listEl.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

async function startSessionFromSelectedWorktree(event) {
  event.preventDefault();
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  const form = event.currentTarget;
  const pref = preferenceFromControls(form);
  const modelPref = modelPreferenceFromControls(form);
  savePermissionDefaults(pref);
  saveModelDefaults(modelPref);
  const formData = new FormData(form);
  const cwd = newWorktreeSelect.value;
  const sessionName = newSessionNameInput.value.trim();
  if (cwd === '__chat__') formData.delete('cwd');
  else {
    if (!cwd) return window.alert('Choose a worktree first, or choose chat-only.');
    const selected = newSessionWorktrees.find((item) => item.path === cwd);
    if (selected?.session) return window.alert('This worktree already has a session. Open that session or create a new worktree.');
    formData.set('cwd', cwd);
  }

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Starting...';
  try {
    const data = await fetch('/api/threads', { method: 'POST', body: formData }).then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      return json;
    });
    if (data.thread?.id) saveThreadPermission(data.thread.id, pref);
    if (data.thread?.id) saveThreadModel(data.thread.id, modelPref);
    if (data.thread?.id && sessionName) await jsonApi(`/api/threads/${encodeURIComponent(data.thread.id)}/name`, { name: sessionName });
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

let currentWorktreePlan = null;
let planTimer = null;

function openCreateWorktreeDialog() {
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  const sourcePath = selectedWorktreeSourcePath();
  if (!sourcePath) return window.alert('Choose a source worktree first.');
  currentWorktreePlan = null;
  createWorktreeForm.reset();
  worktreeNameInput.value = newSessionNameInput.value.trim();
  planSource.textContent = compactPath(sourcePath);
  planBranch.textContent = '-';
  planWorktree.textContent = '-';
  planCommand.textContent = 'Enter a lane name to preview the command.';
  planError.textContent = '';
  confirmCreateWorktree.disabled = true;
  createWorktreeDialog.showModal();
  if (worktreeNameInput.value.trim()) updateWorktreePlan();
  worktreeNameInput.focus();
}

function scheduleWorktreePlan() {
  clearTimeout(planTimer);
  planTimer = setTimeout(updateWorktreePlan, 180);
}

async function updateWorktreePlan() {
  if (isReadOnly()) return;
  const sourcePath = selectedWorktreeSourcePath();
  const branch = worktreeNameInput.value.trim();
  const targetRoot = worktreeRootInput.value.trim();
  currentWorktreePlan = null;
  planError.textContent = '';
  confirmCreateWorktree.disabled = true;
  if (!sourcePath || !branch) {
    planBranch.textContent = '-';
    planWorktree.textContent = '-';
    planCommand.textContent = 'Enter a lane name to preview the command.';
    return;
  }
  try {
    const plan = await jsonApi('/api/worktree-plan', { sourcePath, branch, targetRoot });
    currentWorktreePlan = plan;
    planSource.textContent = compactPath(plan.sourcePath);
    planBranch.textContent = plan.branch;
    planWorktree.textContent = plan.targetPath;
    planCommand.textContent = plan.commands.map((command) => command.display).join('\n');
    confirmCreateWorktree.disabled = false;
  } catch (error) {
    planBranch.textContent = '-';
    planWorktree.textContent = '-';
    planCommand.textContent = 'Cannot create a command preview.';
    planError.textContent = error.message;
  }
}

async function createFeatureWorktree(event) {
  event?.preventDefault();
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  if (!currentWorktreePlan) await updateWorktreePlan();
  if (!currentWorktreePlan) return;
  confirmCreateWorktree.disabled = true;
  confirmCreateWorktree.textContent = 'Creating...';
  try {
    const sessionName = currentWorktreePlan.branch || worktreeNameInput.value.trim();
    const created = await jsonApi('/api/worktrees', {
      sourcePath: currentWorktreePlan.sourcePath,
      branch: currentWorktreePlan.branch,
      targetRoot: currentWorktreePlan.targetRoot,
      confirmed: true,
    });
    const createdPath = created.worktree?.path || created.targetPath;
    createWorktreeDialog.close();
    await loadNewSessionWorktrees(createdPath);
    newWorktreeSelect.value = createdPath;
    newSessionDialog.close();
    const pref = preferenceFromControls(newSessionForm);
    const modelPref = modelPreferenceFromControls(newSessionForm);
    savePermissionDefaults(pref);
    saveModelDefaults(modelPref);
    const started = await jsonApi('/api/threads', { cwd: createdPath, ...permissionPayload(pref), ...modelPayload(modelPref) });
    if (started.thread?.id) saveThreadPermission(started.thread.id, pref);
    if (started.thread?.id) saveThreadModel(started.thread.id, modelPref);
    if (started.thread?.id && sessionName) await jsonApi(`/api/threads/${encodeURIComponent(started.thread.id)}/name`, { name: sessionName });
    if (started.thread?.id) await loadDetail(started.thread.id);
    await loadSessions();
  } catch (error) {
    planError.textContent = error.message;
  } finally {
    confirmCreateWorktree.disabled = false;
    confirmCreateWorktree.textContent = 'Create worktree';
  }
}

function updateRepoOptions(repos) {
  const previous = repoFilter.value || savedSelectedRepo();
  const seen = new Set();
  const options = ['<option value="">all repos</option>'];

  for (const repo of repos) {
    seen.add(repo.value);
    const selected = repo.value === previous ? ' selected' : '';
    options.push(`<option value="${escapeHtml(repo.value)}"${selected}>${escapeHtml(displayRepo(repo.value))} (${repo.count})</option>`);
  }

  for (const repo of [...customRepos(), savedSelectedRepo()].filter(Boolean)) {
    if (seen.has(repo)) continue;
    const selected = repo === previous ? ' selected' : '';
    options.push(`<option value="${escapeHtml(repo)}"${selected}>${escapeHtml(displayRepo(repo))} (saved)</option>`);
  }

  if (!isReadOnly()) options.push('<option value="__add_repo__">+ Add repo...</option>');
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
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  syncNewSessionRepoOptions();
  if (!newRepoSelect.value && newRepoSelect.options[0]) newRepoSelect.value = newRepoSelect.options[0].value;
  applyPermissionPreference(newSessionForm, permissionDefaults());
  applyModelPreference(newSessionForm, modelDefaults());
  newSessionDialog.showModal();
  await loadNewSessionWorktrees();
}

async function loadNewSessionWorktrees(preferredPath = '') {
  const repo = newRepoSelect.value.trim();
  const startButton = newSessionForm.querySelector('button[type="submit"]');
  newSessionWorktrees = [];
  newWorktreeSelect.innerHTML = '';
  newWorktreeHint.textContent = '';
  createWorktreeButton.disabled = true;
  createWorktreeButton.hidden = isReadOnly();
  createWorktreeButton.title = isReadOnly() ? 'Read-only mode is enabled.' : 'Choose a source worktree first.';
  if (startButton) startButton.disabled = true;
  if (!repo) {
    newWorktreeHint.textContent = 'Choose a repo first.';
    return;
  }

  try {
    newWorktreeSelect.innerHTML = '<option value="">Loading worktrees...</option>';
    const data = await api(`/api/repo-worktrees?repo=${encodeURIComponent(repo)}`);
    const worktrees = (data.worktrees ?? []).filter((item) => !item.bare);
    newSessionWorktrees = worktrees;
    if (!worktrees.length) {
      newWorktreeSelect.innerHTML = '<option value="">No local worktrees found</option>';
      newWorktreeHint.textContent = 'No known local worktree yet. Open an existing Codex session for this repo first, or add the repo from a known lane.';
      return;
    }

    const chatOption = '<option value="__chat__">No worktree - chat only</option>';
    newWorktreeSelect.innerHTML = worktrees.map((item) => {
      const branch = item.branch || 'detached';
      const attached = Boolean(item.session);
      const sessionName = item.session?.name || item.session?.id || 'session';
      const suffix = attached ? ` - has session: ${sessionName}` : '';
      return `<option value="${escapeHtml(item.path)}"${attached ? ' disabled' : ''}>${escapeHtml(branch)} - ${escapeHtml(compactPath(item.path))}${escapeHtml(suffix)}</option>`;
    }).join('') + chatOption;
    const available = worktrees.filter((item) => !item.session);
    if (preferredPath && [...newWorktreeSelect.options].some((option) => option.value === preferredPath && !option.disabled)) newWorktreeSelect.value = preferredPath;
    else {
      const suggested = suggestedWorktreeForSessionName();
      if (suggested) newWorktreeSelect.value = suggested.path;
      else if (available[0]) newWorktreeSelect.value = available[0].path;
      else newWorktreeSelect.value = '__chat__';
    }
    createWorktreeButton.disabled = isReadOnly();
    createWorktreeButton.hidden = isReadOnly();
    createWorktreeButton.title = isReadOnly() ? 'Read-only mode is enabled.' : 'Create a new worktree from this repo.';
    updateNewSessionStartState();
    newWorktreeHint.textContent = available.length
      ? `${available.length} of ${worktrees.length} worktree${worktrees.length === 1 ? '' : 's'} can start a new session. Attached worktrees are disabled.`
      : `All ${worktrees.length} known worktree${worktrees.length === 1 ? '' : 's'} already have sessions. Create a new worktree to start another session.`;
  } catch (error) {
    newWorktreeSelect.innerHTML = '<option value="">Worktrees unavailable</option>';
    newWorktreeHint.textContent = error.message;
  }
}

function selectedWorktreeSourcePath() {
  return newWorktreeSelect.value === '__chat__' ? (newSessionWorktrees.find((item) => item.path)?.path || '') : (newWorktreeSelect.value || newSessionWorktrees.find((item) => item.path)?.path || '');
}

function updateNewSessionStartState() {
  const startButton = newSessionForm.querySelector('button[type="submit"]');
  if (!startButton) return;
  if (newWorktreeSelect.value === '__chat__') {
    startButton.disabled = false;
    startButton.title = '';
    newWorktreeHint.textContent = 'This will start a chat-only Codex session without a repository worktree.';
    return;
  }
  const selected = newSessionWorktrees.find((item) => item.path === newWorktreeSelect.value);
  const canStart = Boolean(selected && !selected.session);
  startButton.disabled = !canStart;
  startButton.title = canStart ? '' : 'Choose a worktree without an existing session, or create a new worktree.';
}

function slugFromSessionName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function suggestedWorktreeForSessionName() {
  const slug = slugFromSessionName(newSessionNameInput.value);
  if (!slug) return null;
  return newSessionWorktrees.find((item) => !item.session && (
    String(item.branch ?? '').toLowerCase().includes(slug) ||
    compactPath(item.path).toLowerCase().includes(slug)
  )) ?? null;
}

function applySessionNameWorktreeSuggestion() {
  const suggested = suggestedWorktreeForSessionName();
  if (suggested) {
    newWorktreeSelect.value = suggested.path;
    newWorktreeHint.textContent = `Selected matching worktree: ${compactPath(suggested.path)}`;
  } else if (newSessionNameInput.value.trim()) {
    createWorktreeButton.title = 'No matching free worktree found. Create one from this session name.';
  }
  updateNewSessionStartState();
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
  if (quiet && activeId && id !== activeId) return;
  if (!quiet) clearTimeout(detailRefreshTimer);
  const previousId = activeId;
  const previousScroller = detailEl.querySelector('.detail-shell .detail');
  const previousScrollTop = previousScroller?.scrollTop ?? 0;
  const scrollAnchor = quiet && id === previousId ? captureScrollAnchor(previousScroller) : null;
  const openTurnDetails = quiet && id === previousId ? captureOpenTurnDetails() : new Set();
  const sessionDetailsOpen = quiet && id === previousId && Boolean(detailEl.querySelector('.session-meta')?.open);
  const shouldContinueFollowing = quiet && id === previousId && !openTurnDetails.size && isNearBottom(previousScroller);
  const previousForm = detailEl.querySelector('#promptForm');
  const preservePromptForm = quiet && id === previousId && previousForm;
  const draftPrompt = quiet && id === previousId ? previousForm?.elements?.prompt?.value ?? '' : '';
  const draftFiles = quiet && id === previousId ? [...(previousForm?.elements?.files?.files ?? [])] : [];
  const previousTextarea = previousForm?.querySelector('textarea[name="prompt"]');
  const restoreComposerFocus = quiet && id === previousId && document.activeElement === previousTextarea;
  const draftSelection = restoreComposerFocus ? {
    start: previousTextarea.selectionStart,
    end: previousTextarea.selectionEnd,
    direction: previousTextarea.selectionDirection,
  } : null;
  activeId = id;
  saveActiveSession(id);
  for (const el of listEl.querySelectorAll('.session')) el.classList.toggle('active', el.dataset.id === id);
  if (!quiet) {
    detailEl.className = 'empty';
    detailEl.innerHTML = '<div class="empty">Loading thread...</div>';
  }
  try {
    const data = await api(`/api/threads/${encodeURIComponent(id)}`);
    detailEl.className = 'detail-host';
    const rendered = renderDetail(data);
    const patched = preservePromptForm && patchDetailPreservingComposer(rendered, data.thread);
    let promptForm = patched ? previousForm : null;
    if (!patched) {
      detailEl.innerHTML = rendered;
      promptForm = detailEl.querySelector('#promptForm');
      promptForm?.addEventListener('submit', (event) => submitPrompt(event, id));
      bindPromptKeyboard(promptForm);
      bindPromptPaste(promptForm);
      restorePromptDraft(promptForm, draftPrompt, draftFiles);
      restorePromptFocus(promptForm, draftSelection);
    }
    bindPermissionPreferenceControls(promptForm, id);
    bindModelPreferenceControls(promptForm, id);
    detailEl.querySelector('[data-action=rename-thread]')?.addEventListener('click', () => renameThread(id, data.thread));
    detailEl.querySelector('[data-action=archive-thread]')?.addEventListener('click', () => toggleArchiveThread(id, data.thread));
    detailEl.querySelector('[data-action=interrupt-turn]')?.addEventListener('click', () => interruptTurn(id));
    detailEl.querySelectorAll('[data-action=steer-turn]').forEach((button) => { button.onclick = () => steerTurn(id, button); });
    bindQueuedMessageControls(id);
    restoreOpenTurnDetails(openTurnDetails);
    restoreSessionDetailsOpen(sessionDetailsOpen);
    bindCodeCopyControls(detailEl);
    bindSessionImageViewer(detailEl, openImageLightbox);
    bindDetailScrollControls();
    requestAnimationFrame(() => {
      const scroller = detailEl.querySelector('.detail-shell .detail');
      if (!quiet || shouldContinueFollowing) scrollDetailToBottom();
      else if (quiet && scroller) restoreScrollAnchor(scroller, scrollAnchor, previousScrollTop);
      updateJumpBottomButton(scroller);
    });
  } catch (error) {
    detailEl.className = 'error';
    detailEl.innerHTML = `<div class="error">${escapeHtml(error.message)}</div>`;
  }
}

function patchDetailPreservingComposer(renderedHtml, thread) {
  if (isReadOnly()) return false;
  const currentShell = detailEl.querySelector('.detail-shell');
  const currentForm = currentShell?.querySelector('#promptForm');
  if (!currentShell || !currentForm) return false;

  const container = document.createElement('div');
  container.innerHTML = renderedHtml;
  const nextShell = container.querySelector('.detail-shell');
  if (!nextShell) return false;
  if (!nextShell.querySelector('#promptForm')) return false;

  for (const selector of ['.session-header', '.detail', '.jump-bottom']) {
    const current = currentShell.querySelector(selector);
    const next = nextShell.querySelector(selector);
    if (current && next) current.replaceWith(next);
  }

  const currentQueue = currentShell.querySelector('.queued-messages');
  const nextQueue = nextShell.querySelector('.queued-messages');
  if (currentQueue && nextQueue) currentQueue.replaceWith(nextQueue);
  else if (currentQueue && !nextQueue) currentQueue.remove();
  else if (!currentQueue && nextQueue) currentForm.before(nextQueue);

  syncPromptComposerState(currentForm, thread);
  return true;
}

function renderDetail({ thread, turns, queuedMessages = [], events = [], permissionSettings = {} }) {
  const status = statusLabel(thread);
  const statusCss = statusClass(thread);
  const model = modelFromThread(thread, turns);
  const effort = effortFromThread(thread, turns);
  const modelSource = thread?.modelSource || 'unknown';
  const timelineEvents = [...events, ...inferredModelEvents(thread, turns, events)].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const isArchived = Boolean(thread?.archived || thread?.isArchived || thread?.archivedAt || thread?.archived_at);
  const archiveLabel = isArchived ? 'Unarchive' : 'Archive';
  const writable = !isReadOnly();
  return `<div class="detail-shell">
    <div class="session-header">
      <details class="session-meta">
        <summary class="session-summary">
          <h2>${escapeHtml(thread.name || '(unnamed)')}</h2>
          <span class="badge status ${escapeHtml(statusCss)}">${escapeHtml(status)}</span>
        </summary>
        <div class="session-details">
          <div class="preview">${escapeHtml(thread.preview || '')}</div>
          <div class="kv">
            <strong>ID</strong><span>${escapeHtml(thread.id)}</span>
            <strong>Status</strong><span>${escapeHtml(status)}</span>
            <strong>Model</strong><span>${escapeHtml(model || 'unknown')}</span>
            <strong>Thinking</strong><span>${escapeHtml(effort || 'unknown')}</span>
            <strong>Model source</strong><span>${escapeHtml(modelSource)}</span>
            <strong>Source</strong><span>${escapeHtml(thread.source || '')}</span>
            <strong>Updated</strong><span>${escapeHtml(fmtTime(thread.updatedAt))}</span>
            <strong>Branch</strong><span>${escapeHtml(thread.gitInfo?.branch || '')}</span>
            <strong>Repo</strong><span>${renderRepoLink(thread.gitInfo?.originUrl)}</span>
            <strong>CWD</strong><span>${escapeHtml(thread.cwd || '')}</span>
            <strong>Path</strong><span>${escapeHtml(thread.path || '')}</span>
          </div>
          ${renderEventTimeline(timelineEvents)}
        </div>
      </details>
      ${writable ? `<div class="detail-actions">
        <button type="button" data-action="rename-thread">Rename</button>
        <button type="button" data-action="archive-thread">${archiveLabel}</button>
      </div>` : ''}
    </div>
    <div class="detail">
      ${[...turns].reverse().map((turn, index) => renderTurn(turn, index, thread)).join('') || '<div class="empty">No turns returned.</div>'}
      ${renderApprovalBlockedIndicator(thread)}
      ${renderBusyIndicator(thread)}
    </div>
    <button type="button" class="jump-bottom" hidden>Jump to bottom</button>
    ${renderQueuedMessages(queuedMessages)}
    ${writable ? `<form class="prompt-bar" id="promptForm">
      <textarea name="prompt" rows="3" placeholder="Send a follow-up to this session"></textarea>
      <div class="prompt-actions">
        <label class="attach-button" title="Attach files">
          <input name="files" type="file" multiple>
          <span>+</span>
        </label>
        <span class="attachment-status" aria-live="polite"></span>
        ${renderPermissionControls(effectivePermissionPreference(thread.id, permissionSettings))}
        <span class="prompt-spacer"></span>
        ${renderModelControls(effectiveModelPreference(thread.id), 'prompt-model-controls')}
        ${isBusyThread(thread) ? '<button type="button" class="danger-button" data-action="interrupt-turn">Stop</button><button type="button" data-action="steer-turn">Steer now</button>' : ''}
        <button type="submit">${isBusyThread(thread) ? 'Send after current' : 'Send'}</button>
      </div>
      <div class="attachment-preview" aria-live="polite"></div>
    </form>` : ''}
  </div>`;
}

function renderApprovalBlockedIndicator(thread) {
  if (statusClass(thread) !== 'waitingonapproval') return '';
  return `<div class="blocked-indicator">
    <strong>Approval required</strong>
    <span>Codex Control cannot answer approval prompts yet. Use never approve, or continue this session in Codex app/CLI.</span>
  </div>`;
}

function selectedAttribute(value, expected) {
  return value === expected ? ' selected' : '';
}

function checkedAttribute(value) {
  return value ? ' checked' : '';
}

function renderModelControls(settings = {}, extraClass = '') {
  const normalized = normalizeModelPreference(settings);
  const selectedModel = normalized.model || configModelPreference().model;
  const selectedEffort = normalized.effort || configModelPreference().effort;
  const explicitModel = Boolean(settings.explicitModel);
  const explicitEffort = Boolean(settings.explicitEffort);
  return `<div class="model-controls ${escapeHtml(extraClass)}" title="Applies to the next normal turn. Steer cannot change model or thinking.">
    <span class="setting-source ${explicitModel ? 'explicit' : 'inherited'}" data-source-for="model" title="${explicitModel ? 'Explicit override' : 'Using config value'}" aria-hidden="true"></span>
    <select data-setting-kind="model" aria-label="Model" data-explicit="${explicitModel ? '1' : '0'}">
      ${modelOptions().map((model) => `<option value="${escapeAttribute(model.id)}"${model.id === selectedModel ? ' selected' : ''}>${escapeHtml(model.label)}</option>`).join('')}
    </select>
    <input type="hidden" name="model" value="${explicitModel ? escapeAttribute(selectedModel) : ''}">
    <span class="setting-source ${explicitEffort ? 'explicit' : 'inherited'}" data-source-for="effort" title="${explicitEffort ? 'Explicit override' : 'Using config value'}" aria-hidden="true"></span>
    <select data-setting-kind="effort" aria-label="Thinking level" data-explicit="${explicitEffort ? '1' : '0'}">
      ${[...new Set([...effortOptionsForModel(selectedModel), selectedEffort].filter(Boolean))].map((effort) => `<option value="${escapeAttribute(effort)}"${effort === selectedEffort ? ' selected' : ''}>${escapeHtml(effort)}</option>`).join('')}
    </select>
    <input type="hidden" name="effort" value="${explicitEffort ? escapeAttribute(selectedEffort) : ''}">
  </div>`;
}

function renderPermissionControls(settings = {}) {
  const normalized = normalizePermissionPreference(settings);
  const sandbox = normalized.sandboxPolicy || configPermissionPreference().sandboxPolicy;
  const approval = normalized.approvalPolicy || configPermissionPreference().approvalPolicy;
  const network = normalized.networkAccess;
  const explicit = Boolean(settings.explicit);
  const presetId = permissionPresetId({ sandboxPolicy: sandbox, approvalPolicy: approval, networkAccess: network });
  return `<div class="permission-controls" title="Applies to the next normal turn. Steer cannot change permissions.">
    <span class="setting-source ${explicit ? 'explicit' : 'inherited'}" data-source-for="permission" title="${explicit ? 'Explicit override' : 'Using config value'}" aria-hidden="true"></span>
    <select name="permissionPreset" aria-label="Permission preset" data-explicit="${explicit ? '1' : '0'}">
      ${PERMISSION_PRESETS.map((preset) => `<option value="${escapeAttribute(preset.id)}"${preset.id === presetId ? ' selected' : ''}>${escapeHtml(preset.label)}</option>`).join('')}
      ${presetId === 'custom' ? `<option value="custom" selected>${escapeHtml(permissionPresetLabel({ sandboxPolicy: sandbox, approvalPolicy: approval, networkAccess: network }))}</option>` : ''}
    </select>
    <input type="hidden" name="sandboxPolicy" value="${explicit ? escapeAttribute(normalized.sandboxPolicy) : ''}">
    <input type="hidden" name="approvalPolicy" value="${explicit ? escapeAttribute(normalized.approvalPolicy) : ''}">
    <label class="network-toggle"><input type="checkbox" name="networkAccess" value="true"${checkedAttribute(network)}> network</label>
    <details class="permission-advanced">
      <summary>Advanced</summary>
      <select name="sandboxPolicyRaw" aria-label="Advanced sandbox policy">
        <option value="readOnly"${selectedAttribute(sandbox, 'readOnly')}>read only</option>
        <option value="workspaceWrite"${selectedAttribute(sandbox, 'workspaceWrite')}>workspace write</option>
        <option value="dangerFullAccess"${selectedAttribute(sandbox, 'dangerFullAccess')}>danger full access</option>
      </select>
      <select name="approvalPolicyRaw" aria-label="Advanced approval policy">
        <option value="untrusted"${selectedAttribute(approval, 'untrusted')}>untrusted only</option>
        <option value="on-failure"${selectedAttribute(approval, 'on-failure')}>on failure</option>
        <option value="on-request"${selectedAttribute(approval, 'on-request')}>on request</option>
        <option value="granular"${selectedAttribute(approval, 'granular')}>granular</option>
        <option value="never"${selectedAttribute(approval, 'never')}>never approve</option>
      </select>
    </details>
  </div>`;
}

function renderEventTimeline(events = []) {
  const visible = events.slice(-10).reverse();
  if (!visible.length) return '';
  const rowForModel = (event) => {
    if (!event.modelFrom && !event.modelTo) return '';
    const from = event.modelFrom ? `from ${escapeHtml(event.modelFrom)}` : '';
    const to = event.modelTo ? `to ${escapeHtml(event.modelTo)}` : '';
    return `<small class="event-model">${from}${from && to ? ' ' : ''}${to}</small>`;
  };
  return `<section class="event-timeline" aria-label="Recent session events">
    <div class="event-title">Recent events</div>
    ${visible.map((event) => {
      const isModel = String(event.method ?? '').toLowerCase().includes('model') || !!(event.modelFrom || event.modelTo);
      return `<div class="event-row${isModel ? ' model-change' : ''}">
      <time>${escapeHtml(fmtMillis(event.at))}</time>
      <span>${escapeHtml(event.message || event.method || 'Event')}</span>
      ${rowForModel(event)}
      ${event.turnId ? `<code title="${escapeHtml(event.turnId)}">${escapeHtml(event.turnId.slice(0, 8))}</code>` : ''}
    </div>`;}).join('')}
  </section>`;
}

function renderBusyIndicator(thread) {
  if (!isBusyThread(thread)) return '';
  return `<div class="busy-indicator" role="status" aria-live="polite">
    <span class="busy-label">Agent working</span>
    <span class="busy-dots" aria-hidden="true"><span></span><span></span><span></span></span>
  </div>`;
}

function renderQueuedMessages(messages = []) {
  if (!messages.length) return '';
  const controls = !isReadOnly();
  return `<div class="queued-messages" aria-live="polite">
    <div class="queued-title">Queued messages</div>
    ${messages.map((message, index) => `<div class="queued-message" data-queued-id="${escapeHtml(message.turnId || '')}">
      <div class="queued-head">
        <span></span>
        ${controls ? `<div class="queued-actions">
          <button type="button" data-queue-action="up" ${index === 0 ? 'disabled' : ''}>Up</button>
          <button type="button" data-queue-action="down" ${index === messages.length - 1 ? 'disabled' : ''}>Down</button>
          <button type="button" data-queue-action="steer">Steer now</button>
          <button type="button" data-queue-action="remove">Remove</button>
        </div>` : ''}
      </div>
      ${renderQueuedAttachments(message.attachments)}
      ${renderMarkdownText(message.text || '(attachment-only prompt)')}
    </div>`).join('')}
  </div>`;
}

function renderQueuedAttachments(attachments = []) {
  const images = attachments.filter((attachment) => attachment.type === 'image' && attachment.src);
  if (!images.length) return '';
  return `<div class="queued-attachments">
    ${images.map((image) => `<img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.filename || 'queued image')}" loading="lazy">`).join('')}
  </div>`;
}

function bindQueuedMessageControls(threadId) {
  detailEl.querySelectorAll('.queued-message[data-queued-id]').forEach((row) => {
    row.querySelectorAll('[data-queue-action]').forEach((button) => {
      button.addEventListener('click', () => updateQueuedMessage(threadId, row.dataset.queuedId, button.dataset.queueAction, button));
    });
  });
}

async function updateQueuedMessage(threadId, queuedId, action, button) {
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  if (!threadId || !queuedId || !action) return;
  button.disabled = true;
  const label = button.textContent;
  button.textContent = '...';
  try {
    const body = action === 'up' || action === 'down' ? { direction: action } : {};
    await jsonApi(`/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(queuedId)}/${action === 'up' || action === 'down' ? 'move' : action}`, body);
    scheduleDetailRefresh(threadId, 100);
    scheduleLoadSessions();
  } catch (error) {
    window.alert(error.message);
    button.disabled = false;
    button.textContent = label;
  }
}

async function renameThread(id, thread) {
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  const current = thread?.name || '';
  const name = window.prompt('Session name:', current);
  if (name === null) return;
  await jsonApi(`/api/threads/${encodeURIComponent(id)}/name`, { name });
  scheduleDetailRefresh(id, 150);
  scheduleLoadSessions();
}

async function toggleArchiveThread(id, thread = {}) {
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  const isArchived = Boolean(thread?.archived || thread?.isArchived || thread?.archivedAt || thread?.archived_at);
  if (isArchived) {
    await jsonApi(`/api/threads/${encodeURIComponent(id)}/unarchive`, {});
    scheduleDetailRefresh(id, 150);
    scheduleLoadSessions();
    return;
  }
  const ok = window.confirm('Archive this session? You can include archived sessions from the filter drawer later.');
  if (!ok) return;
  await jsonApi(`/api/threads/${encodeURIComponent(id)}/archive`, {});
  activeId = null;
  saveActiveSession('');
  detailEl.className = 'detail empty';
  detailEl.textContent = 'Session archived.';
  scheduleLoadSessions();
}

async function steerTurn(id, button = detailEl.querySelector('[data-action=steer-turn]')) {
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  const form = detailEl.querySelector('#promptForm');
  const pref = preferenceFromControls(form);
  const modelPref = modelPreferenceFromControls(form);
  savePermissionDefaults(pref);
  saveThreadPermission(id, pref);
  saveModelDefaults(modelPref);
  saveThreadModel(id, modelPref);
  const formData = new FormData(form);
  if (!String(formData.get('prompt') ?? '').trim() && !formData.getAll('files').some((file) => file?.size)) {
    window.alert('Enter guidance or attach a file to steer.');
    return;
  }
  if (button) {
    button.disabled = true;
    button.textContent = 'Steering...';
  }
  try {
    await fetch(`/api/threads/${encodeURIComponent(id)}/steer`, { method: 'POST', body: formData }).then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      return json;
    });
    clearPromptComposerContent(form);
    scheduleDetailRefresh(id, 250);
  } catch (error) {
    window.alert(error.message);
    if (button) {
      button.disabled = false;
      button.textContent = 'Steer';
    }
  }
}

async function interruptTurn(id) {
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  const button = detailEl.querySelector('[data-action=interrupt-turn]');
  if (button) {
    button.disabled = true;
    button.textContent = 'Stopping...';
  }
  try {
    await jsonApi(`/api/threads/${encodeURIComponent(id)}/interrupt`, {});
    scheduleDetailRefresh(id, 250);
    scheduleLoadSessions();
  } catch (error) {
    window.alert(error.message);
    if (button) {
      button.disabled = false;
      button.textContent = 'Stop';
    }
  }
}

async function submitPrompt(event, id) {
  event.preventDefault();
  if (isReadOnly()) return window.alert('Codex Control is running in read-only mode.');
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const pref = preferenceFromControls(form);
  const modelPref = modelPreferenceFromControls(form);
  savePermissionDefaults(pref);
  saveThreadPermission(id, pref);
  saveModelDefaults(modelPref);
  saveThreadModel(id, modelPref);
  const formData = new FormData(form);
  const wasQueuedSend = submit.textContent.includes('after current');
  submit.disabled = true;
  submit.textContent = 'Sending...';
  try {
    await fetch(`/api/threads/${encodeURIComponent(id)}/turn`, { method: 'POST', body: formData }).then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      return json;
    });
    clearPromptComposerContent(form);
    scheduleDetailRefresh(id, 700);
    scheduleLoadSessions();
  } catch (error) {
    window.alert(error.message);
  } finally {
    submit.disabled = false;
    submit.textContent = wasQueuedSend ? 'Send after current' : 'Send';
  }
}

function bindPromptKeyboard(form) {
  const textarea = form?.querySelector('textarea[name="prompt"]');
  if (!form || !textarea) return;
  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    form.requestSubmit();
  });
}

function bindPromptPaste(form) {
  const textarea = form?.querySelector('textarea[name="prompt"]');
  const fileInput = form?.querySelector('input[name="files"]');
  if (!form || !textarea || !fileInput) return;

  fileInput.addEventListener('change', () => updateAttachmentStatus(form));
  textarea.addEventListener('paste', (event) => {
    const files = imageFilesFromClipboard(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    appendFiles(fileInput, files);
    updateAttachmentStatus(form);
  });
}

function imageFilesFromClipboard(clipboardData) {
  if (!clipboardData) return [];
  const fromItems = [...(clipboardData.items ?? [])]
    .filter((item) => item.kind === 'file' && String(item.type).toLowerCase().startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (fromItems.length) return fromItems;
  return [...(clipboardData.files ?? [])].filter((file) => String(file.type).toLowerCase().startsWith('image/'));
}

function appendFiles(input, files) {
  if (!input || !files.length) return;
  const transfer = new DataTransfer();
  for (const file of input.files ?? []) transfer.items.add(file);
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
}

function updateAttachmentStatus(form) {
  const status = form?.querySelector('.attachment-status');
  const preview = form?.querySelector('.attachment-preview');
  const fileInput = form?.querySelector('input[name="files"]');
  if (!status || !fileInput) return;
  const files = [...(fileInput.files ?? [])];
  const count = files.length;
  status.textContent = count ? `${count} attachment${count === 1 ? '' : 's'} ready` : '';
  if (!preview) return;
  preview.innerHTML = files.map((file) => {
    const isImage = String(file.type).toLowerCase().startsWith('image/');
    if (isImage) {
      const src = URL.createObjectURL(file);
      return `<figure class="attachment-thumb">
        <button type="button" class="attachment-remove" data-index="${escapeAttribute(files.indexOf(file))}" aria-label="Remove attachment">x</button>
        <img src="${escapeAttribute(src)}" alt="${escapeAttribute(file.name || 'pasted image')}" loading="lazy">
        <figcaption>${escapeHtml(file.name || 'pasted image')}</figcaption>
      </figure>`;
    }
    return `<div class="attachment-file">
      <button type="button" class="attachment-remove" data-index="${escapeAttribute(files.indexOf(file))}" aria-label="Remove attachment">x</button>
      <span>${escapeHtml(file.name || 'attachment')}</span>
      <small>${escapeHtml(file.type || 'file')}</small>
    </div>`;
  }).join('');
  preview.querySelectorAll('.attachment-remove').forEach((button) => {
    button.addEventListener('click', () => {
      removeAttachmentAt(fileInput, Number(button.dataset.index));
      updateAttachmentStatus(form);
    });
  });
}

function removeAttachmentAt(input, removeIndex) {
  if (!input || !Number.isInteger(removeIndex)) return;
  const transfer = new DataTransfer();
  [...(input.files ?? [])].forEach((file, index) => {
    if (index !== removeIndex) transfer.items.add(file);
  });
  input.files = transfer.files;
}

function syncPromptComposerState(form, thread) {
  if (isReadOnly()) return;
  if (!form) return;
  const busy = isBusyThread(thread);
  const submit = form.querySelector('button[type="submit"]');
  const actions = form.querySelector('.prompt-actions');
  if (submit) submit.textContent = busy ? 'Send after current' : 'Send';
  if (!actions) return;
  const steer = actions.querySelector('[data-action="steer-turn"]');
  const stop = actions.querySelector('[data-action="interrupt-turn"]');
  if (busy && !stop) submit?.insertAdjacentHTML('beforebegin', '<button type="button" class="danger-button" data-action="interrupt-turn">Stop</button>');
  if (busy && !steer) submit?.insertAdjacentHTML('beforebegin', '<button type="button" data-action="steer-turn">Steer now</button>');
  if (!busy && stop) stop.remove();
  if (!busy && steer) steer.remove();
}

function restorePromptDraft(form, prompt, files = []) {
  if (!form || (!prompt && !files.length)) return;
  const textarea = form.querySelector('textarea[name="prompt"]');
  const fileInput = form.querySelector('input[name="files"]');
  if (textarea && prompt) textarea.value = prompt;
  if (fileInput && files.length) {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    fileInput.files = transfer.files;
  }
  updateAttachmentStatus(form);
}

function restorePromptFocus(form, selection) {
  if (!form || !selection) return;
  const textarea = form.querySelector('textarea[name="prompt"]');
  if (!textarea) return;
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(selection.start ?? textarea.value.length, selection.end ?? textarea.value.length, selection.direction ?? 'none');
}

function clearPromptComposerContent(form) {
  const textarea = form?.querySelector('textarea[name="prompt"]');
  const fileInput = form?.querySelector('input[name="files"]');
  if (textarea) textarea.value = '';
  if (fileInput) fileInput.value = '';
  updateAttachmentStatus(form);
}

function renderTurn(turn, index, thread) {
  const threadBusy = isBusyThread(thread);
  const turnStatus = String(turn.status ?? '').toLowerCase();
  const activeLatestTurn = index === 0 && threadBusy;
  const statusValue = activeLatestTurn
    ? statusLabel(thread)
    : (threadBusy && turnStatus === 'interrupted' ? '' : turn.status);
  const status = String(statusValue ?? '').toLowerCase();
  const model = modelFromValue(turn);
  const effort = effortFromValue(turn);
  const summary = turnSummary(turn);
  const innerItems = [
    `<div class="meta"><span class="badge">${escapeHtml(turn.id)}</span></div>`,
    ...(summary.hiddenItems ?? []).map(renderItem),
    renderTurnBreak(turn, statusValue, threadBusy),
  ].filter(Boolean);
  const visibleSteeredMessages = (turn.steeredMessages ?? []).map(renderSteeredMessage).join('');
  const hasInnerItems = (summary.hiddenItems?.length ?? 0) > 0 || Boolean(renderTurnBreak(turn, statusValue, threadBusy));
  const hasResponse = Boolean(summary.responseItem || String(summary.response ?? '').trim());
  return `<section class="turn ${escapeHtml(status)}" data-turn-id="${escapeHtml(turn.id || index)}">
    <div class="meta"><span class="badge">Turn ${index + 1}</span>${model ? `<span class="badge model">${escapeHtml(model)}</span>` : ''}${effort ? `<span class="badge effort">${escapeHtml(effort)}</span>` : ''}${statusValue ? `<span class="badge turn-status ${escapeHtml(status)}">${escapeHtml(statusValue)}</span>` : ''}</div>
    <div class="turn-compact">
      <article>
        <div class="item-type">Prompt</div>
        ${summary.promptItem ? renderContentParts(summary.promptItem, summary.prompt || '(no prompt text)') : renderMarkdownText(summary.prompt || '(no prompt text)')}
      </article>
      ${visibleSteeredMessages}
      ${hasInnerItems ? `<details class="turn-details">
        <summary>Intermediate activity</summary>
        <div class="turn-full">${innerItems.join('')}</div>
      </details>` : ''}
      ${hasResponse ? `<article>
        <div class="item-type">Response</div>
        ${summary.responseItem ? renderContentParts(summary.responseItem, summary.response) : renderMarkdownText(summary.response)}
      </article>` : ''}
    </div>
  </section>`;
}

function textForItem(item) {
  if (!item) return '';
  if (Array.isArray(item.parts) && item.parts.length) {
    return item.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text || '')
      .filter(Boolean)
      .join('\n');
  }
  return item.text || '';
}

function turnSummary(turn) {
  const items = turn.items ?? [];
  const userItem = items.find((item) => item.type === 'userMessage');
  const agentItems = items.filter((item) => item.type === 'agentMessage');
  const finalAgent = [...agentItems].reverse().find((item) => item.phase !== 'commentary') ?? agentItems[agentItems.length - 1];
  return {
    prompt: textForItem(userItem),
    response: textForItem(finalAgent),
    promptItem: userItem,
    responseItem: finalAgent,
    hiddenItems: items.filter((item) => item !== userItem && item !== finalAgent),
  };
}

function renderSteeredMessage(message) {
  return `<article class="steer-note">
    <div class="item-type">Steered prompt</div>
    ${renderMarkdownText(message.text)}
  </article>`;
}

function renderTurnBreak(turn, statusOverride = turn.status, suppressInterrupted = false) {
  const status = String(statusOverride ?? '').toLowerCase();
  if (suppressInterrupted && status === 'interrupted') return '';
  if (status === 'interrupted') return '<div class="turn-break interrupted">Run stopped</div>';
  if (status === 'failed' || status === 'error') return '<div class="turn-break error">Run failed</div>';
  return '';
}

function itemLabel(item) {
  if (item.type === 'userMessage') return 'You';
  if (item.type === 'agentMessage') return item.phase === 'commentary' ? 'Agent note' : 'Agent response';
  if (item.type === 'commandExecution') return 'Command';
  if (item.type === 'reasoning') return 'Reasoning summary';
  if (String(item.type).toLowerCase() === 'imagegeneration') return 'Image generation';
  if (
    Array.isArray(item?.renderBlocks)
    && item.renderBlocks.some((block) => String(block?.kind || block?.type || '').toLowerCase() === 'imagegeneration')
  ) {
    return 'Image generation';
  }
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

function openImageLightbox(src, alt = '') {
  lightboxState = { scale: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 };
  lightboxImage.src = src;
  lightboxImage.alt = alt;
  lightboxImage.ondragstart = () => false;
  imageLightbox.hidden = false;
  updateLightboxTransform();
}

function closeImageLightbox() {
  imageLightbox.hidden = true;
  lightboxImage.removeAttribute('src');
}

function updateLightboxTransform() {
  lightboxImage.style.transform = `translate(${lightboxState.x}px, ${lightboxState.y}px) scale(${lightboxState.scale})`;
}

function zoomLightbox(delta, origin = { x: 0, y: 0 }) {
  const previous = lightboxState.scale;
  const next = Math.min(8, Math.max(0.25, previous * delta));
  if (next === previous) return;
  lightboxState.x = origin.x - ((origin.x - lightboxState.x) * next / previous);
  lightboxState.y = origin.y - ((origin.y - lightboxState.y) * next / previous);
  lightboxState.scale = next;
  updateLightboxTransform();
}

function resetLightbox() {
  lightboxState.scale = 1;
  lightboxState.x = 0;
  lightboxState.y = 0;
  updateLightboxTransform();
}

function bindImageLightbox() {
  imageLightbox.addEventListener('click', (event) => {
    const action = event.target?.dataset?.action;
    if (action === 'close-lightbox') closeImageLightbox();
    if (action === 'zoom-in') zoomLightbox(1.25);
    if (action === 'zoom-out') zoomLightbox(0.8);
    if (action === 'zoom-reset') resetLightbox();
  });
  imageLightbox.addEventListener('wheel', (event) => {
    if (imageLightbox.hidden) return;
    event.preventDefault();
    const rect = lightboxImage.getBoundingClientRect();
    zoomLightbox(event.deltaY < 0 ? 1.12 : 0.89, {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    });
  }, { passive: false });
  lightboxImage.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    lightboxState.dragging = true;
    lightboxState.startX = event.clientX;
    lightboxState.startY = event.clientY;
    lightboxState.originX = lightboxState.x;
    lightboxState.originY = lightboxState.y;
    lightboxImage.setPointerCapture(event.pointerId);
  });
  lightboxImage.addEventListener('pointermove', (event) => {
    if (!lightboxState.dragging) return;
    event.preventDefault();
    event.stopPropagation();
    lightboxState.x = lightboxState.originX + event.clientX - lightboxState.startX;
    lightboxState.y = lightboxState.originY + event.clientY - lightboxState.startY;
    updateLightboxTransform();
  });
  lightboxImage.addEventListener('pointerup', (event) => {
    event.preventDefault();
    event.stopPropagation();
    lightboxState.dragging = false;
  });
  lightboxImage.addEventListener('dblclick', resetLightbox);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !imageLightbox.hidden) closeImageLightbox();
  });
}

function renderItem(item) {
  const body = item.command
    ? `$ ${item.command}\n\n${item.output || ''}`
    : (item.text || '');
  const customItem = renderSingleItem(item);
  const customBlocks = renderItemBlocks(item);
  const label = itemLabel(item);
  const noisy = looksNoisy(item, body);
  const preview = noisy ? body.slice(0, 220).replace(/\s+/g, ' ').trim() : body;

  if (customItem) return customItem;

  if (customBlocks) {
    return `<article class="item ${escapeHtml(item.type)}">
      <div class="item-type">${escapeHtml(label)}</div>
      ${customBlocks}
    </article>`;
  }

  if (noisy) {
    return renderCompactDetailsItem({
      type: item.type,
      label,
      body,
      preview,
    });
  }

  return `<article class="item ${escapeHtml(item.type)}">
    <div class="item-type">${escapeHtml(label)}</div>
    ${renderContentParts(item, body)}
  </article>`;
}

function renderItemBlocks(item) {
  const blocks = Array.isArray(item?.renderBlocks) ? item.renderBlocks : [];
  if (!blocks.length) return '';
  const renderer = getTranscriptBlockRenderer();
  return renderer(blocks);
}

function renderSingleItem(item) {
  const parser = getTranscriptItemRenderer();
  return parser([item]);
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
  const refreshForThread = (threadId) => {
    scheduleLoadSessions();
    if (threadId === activeId) scheduleDetailRefresh(activeId, 150);
  };
  const events = new EventSource('/api/events');
  events.addEventListener('codex-notification', (event) => {
    const payload = JSON.parse(event.data || '{}');
    const params = payload.params ?? {};
    const threadId = params.threadId ?? params.thread?.id;
    refreshForThread(threadId);
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
  if (isReadOnly() && repoFilter.value === '__add_repo__') {
    repoFilter.value = savedSelectedRepo();
    return;
  }
  if (repoFilter.value !== '__add_repo__') {
    saveSelectedRepo(repoFilter.value);
    return;
  }
  const previous = savedSelectedRepo();
  const value = window.prompt('Paste a git repository URL to filter by:')?.trim();
  if (!value) {
    repoFilter.value = previous;
    return;
  }
  saveCustomRepos([...customRepos(), value]);
  updateRepoOptions([]);
  repoFilter.value = value;
  saveSelectedRepo(value);
  loadSessions();
});
newSessionButton.addEventListener('click', openNewSessionDialog);
bindPermissionPreferenceControls(newSessionForm);
bindModelPreferenceControls(newSessionForm);
bindBackdropClose(newSessionDialog);
bindBackdropClose(addRepoDialog);
bindBackdropClose(createWorktreeDialog);
bindBackdropClose(runtimeDialog);
addRepoButton.addEventListener('click', openAddRepoDialog);
addRepoForm.addEventListener('submit', addRepository);
repoUrlInput.addEventListener('input', updateRepoPreview);
closeAddRepo.addEventListener('click', () => addRepoDialog.close());
cancelAddRepo.addEventListener('click', () => addRepoDialog.close());
runtimeButton.addEventListener('click', openRuntimeDialog);
closeRuntime.addEventListener('click', () => runtimeDialog.close());
newRepoSelect.addEventListener('change', () => loadNewSessionWorktrees());
newSessionNameInput.addEventListener('input', applySessionNameWorktreeSuggestion);
newWorktreeSelect.addEventListener('change', updateNewSessionStartState);
newSessionForm.addEventListener('submit', startSessionFromSelectedWorktree);
createWorktreeButton.addEventListener('click', openCreateWorktreeDialog);
createWorktreeForm.addEventListener('submit', createFeatureWorktree);
worktreeNameInput.addEventListener('input', scheduleWorktreePlan);
worktreeRootInput.addEventListener('input', scheduleWorktreePlan);
closeCreateWorktree.addEventListener('click', () => createWorktreeDialog.close());
cancelCreateWorktree.addEventListener('click', () => createWorktreeDialog.close());
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
bindImageLightbox();
connectEvents();
setInterval(refreshAgeIndicators, 30 * 1000);
await loadHealth();
await loadSettings();
await loadSessions();
