const CUSTOM_REPOS_KEY = 'codex-control.customRepos';
const SELECTED_REPO_KEY = 'codex-control.selectedRepo';
const SELECTED_REPO_TAB_KEY = 'codex-control.selectedRepo.tab';

export function customRepos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_REPOS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function savedSelectedRepo() {
  return sessionStorage.getItem(SELECTED_REPO_TAB_KEY) || localStorage.getItem(SELECTED_REPO_KEY) || '';
}

export function saveSelectedRepo(repo) {
  const value = String(repo ?? '').trim();
  if (value) {
    sessionStorage.setItem(SELECTED_REPO_TAB_KEY, value);
    localStorage.setItem(SELECTED_REPO_KEY, value);
  } else {
    sessionStorage.removeItem(SELECTED_REPO_TAB_KEY);
    localStorage.removeItem(SELECTED_REPO_KEY);
  }
}

export function saveCustomRepos(repos) {
  localStorage.setItem(CUSTOM_REPOS_KEY, JSON.stringify([...new Set(repos.map((repo) => String(repo).trim()).filter(Boolean))]));
}
