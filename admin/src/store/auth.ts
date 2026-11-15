import type { RepoCoords } from '../github/client.ts';
import { isRecord } from '../core/guards.ts';

export type SessionMode = 'github' | 'readonly' | 'sandbox';

export interface SavedAuth {
  readonly coords: RepoCoords;
  readonly mode: SessionMode;
  readonly token: string | null;
}

const KEY = 'dreamy-admin:auth:v1';
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\-/]{1,200}(?<!\/)$/;
const MODES: ReadonlySet<string> = new Set<SessionMode>(['github', 'readonly', 'sandbox']);

export function isValidCoords(coords: RepoCoords): boolean {
  return OWNER.test(coords.owner) && REPO.test(coords.repo) && coords.repo !== '.' && coords.repo !== '..' && BRANCH.test(coords.branch);
}

export function repoKey(coords: RepoCoords, mode: SessionMode): string {
  const base = `${coords.owner}/${coords.repo}@${coords.branch}`.toLowerCase();
  return mode === 'sandbox' ? `sandbox:${base}` : base;
}

export function parseSavedAuth(value: unknown): SavedAuth | null {
  if (!isRecord(value) || !isRecord(value.coords)) return null;
  const coords = {
    owner: String(value.coords.owner ?? ''),
    repo: String(value.coords.repo ?? ''),
    branch: String(value.coords.branch ?? ''),
  };
  const mode = String(value.mode ?? '');
  const token = typeof value.token === 'string' && value.token.trim() ? value.token.trim() : null;
  if (!isValidCoords(coords) || !MODES.has(mode)) return null;
  return { coords, mode: mode as SessionMode, token };
}

/** Browser storage can be unavailable (private mode, blocked site data); the panel then simply forgets the login. */
function storages(): Storage[] {
  const list: Storage[] = [];
  try {
    list.push(window.localStorage);
  } catch {
    /* storage blocked */
  }
  try {
    list.push(window.sessionStorage);
  } catch {
    /* storage blocked */
  }
  return list;
}

export function loadSavedAuth(): SavedAuth | null {
  for (const storage of storages()) {
    try {
      const raw = storage.getItem(KEY);
      const parsed = raw ? parseSavedAuth(JSON.parse(raw)) : null;
      if (parsed) return parsed;
    } catch {
      /* unreadable entry: ignore it */
    }
  }
  return null;
}

/** True when the login was saved with "remember on this device". */
export function isAuthRemembered(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function clearAuth(): void {
  for (const storage of storages()) {
    try {
      storage.removeItem(KEY);
    } catch {
      /* storage blocked */
    }
  }
}

export function saveAuth(auth: SavedAuth, remember: boolean): void {
  clearAuth();
  try {
    const target = remember ? window.localStorage : window.sessionStorage;
    target.setItem(KEY, JSON.stringify(auth));
  } catch {
    /* storage blocked: the session works until the tab is closed */
  }
}

/**
 * On GitHub Pages (`<owner>.github.io/<repo>/`) the repository is known from the URL.
 * Locally it comes from VITE_DEFAULT_REPO ("owner/repo").
 */
export function defaultCoords(hostname: string, pathname: string, fallback: string | undefined): RepoCoords {
  const pages = /^([a-z0-9-]+)\.github\.io$/i.exec(hostname);
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  if (pages && firstSegment && REPO.test(firstSegment)) {
    return { owner: pages[1], repo: firstSegment, branch: 'main' };
  }
  const [owner = '', repo = ''] = (fallback ?? '').split('/');
  return { owner, repo, branch: 'main' };
}
