import type { ContentConfig, Docs, WorkState } from '../core/types.ts';
import { CONFIG_PATH, serializeConfig } from '../core/config.ts';
import { localeFilePath, serializeLocaleDoc } from '../core/serialize.ts';
import { buildCommitMessage } from '../core/changes.ts';
import { createGitHubBackend, createMemoryBackend } from '../github/backend.ts';
import type { RepoBackend } from '../github/backend.ts';
import { createGitHubClient } from '../github/client.ts';
import type { RepoCoords } from '../github/client.ts';
import { loadRepo } from '../github/loader.ts';
import type { LoadedRepo } from '../github/loader.ts';
import { ConflictError, publishChanges } from '../github/publisher.ts';
import type { SessionMode } from './auth.ts';
import { clearAuth, repoKey, saveAuth } from './auth.ts';
import {
  INITIAL_STATE,
  errorMessage,
  getBackend,
  hasBackend,
  setBackend,
  stateFromLoaded,
  useAppStore,
} from './appStore.ts';
import type { AppState } from './appStore.ts';
import { clearBlobs, clearDraft, loadDraft, restoreBlobs, saveDraft } from './persistence.ts';
import type { DraftRecord } from './persistence.ts';
import { selectFileChanges, selectSummaries } from './selectors.ts';
import { ensureUploaded, resumeUploads } from './uploads.ts';

export interface ConnectInput {
  readonly coords: RepoCoords;
  readonly mode: SessionMode;
  readonly token: string | null;
  readonly remember: boolean;
  /** Injected in tests. */
  readonly backend?: RepoBackend;
}

function createBackend(input: ConnectInput): RepoBackend {
  if (input.backend) return input.backend;
  if (input.mode === 'sandbox') {
    return createMemoryBackend({ coords: input.coords, upstream: createGitHubBackend(input.coords, { token: input.token }) });
  }
  return createGitHubBackend(input.coords, { token: input.mode === 'github' ? input.token : null });
}

async function verifyWriteAccess(input: ConnectInput): Promise<void> {
  if (input.mode !== 'github' || !input.token || input.backend) return;
  const info = await createGitHubClient(input.coords, { token: input.token }).getRepo();
  if (!info.canPush) {
    throw new Error('Токен подключён, но у вашей учётной записи нет права записи в этот репозиторий.');
  }
}

export async function connect(input: ConnectInput): Promise<void> {
  if (input.mode === 'github' && !input.token) throw new Error('Укажите токен или выберите режим «Только просмотр».');
  const key = repoKey(input.coords, input.mode);
  setBackend(createBackend(input));
  useAppStore.setState({ ...INITIAL_STATE, session: { coords: input.coords, mode: input.mode, repoKey: key }, phase: 'loading' });
  try {
    await verifyWriteAccess(input);
    const loaded = await loadRepo(getBackend());
    useAppStore.setState(stateFromLoaded(loaded));
    if (input.mode !== 'sandbox') await restoreDraft(key, loaded);
    useAppStore.setState({ phase: 'ready' });
    saveAuth({ coords: input.coords, mode: input.mode, token: input.token }, input.remember);
  } catch (error) {
    useAppStore.setState({ phase: 'error', error: errorMessage(error) });
  }
}

export function disconnect(forgetLogin = true): void {
  if (forgetLogin) clearAuth();
  setBackend(null);
  useAppStore.setState(INITIAL_STATE);
}

/**
 * Reloads from the repository; unpublished edits survive via the draft.
 * The sandbox lives in memory and never changes upstream, so there is
 * nothing to reload and the current edits are kept as they are.
 */
export async function reload(): Promise<void> {
  const { session } = useAppStore.getState();
  if (!session || !hasBackend() || session.mode === 'sandbox') return;
  useAppStore.setState({ busy: true });
  try {
    await saveDraftNow();
    const loaded = await loadRepo(getBackend());
    useAppStore.setState(stateFromLoaded(loaded));
    await restoreDraft(session.repoKey, loaded);
  } catch (error) {
    useAppStore.setState({ error: errorMessage(error) });
    throw error;
  } finally {
    useAppStore.setState({ busy: false });
  }
}

/* ---------- drafts ---------- */

function touchedPaths(baseDocs: Docs, baseConfig: ContentConfig, work: WorkState): Set<string> {
  const paths = new Set<string>();
  for (const [code, doc] of Object.entries(work.docs)) {
    const before = baseDocs[code];
    if (!before || serializeLocaleDoc(before, baseConfig) !== serializeLocaleDoc(doc, work.config)) paths.add(localeFilePath(code));
  }
  if (serializeConfig(baseConfig) !== serializeConfig(work.config)) paths.add(CONFIG_PATH);
  return paths;
}

async function restoreDraft(key: string, loaded: LoadedRepo): Promise<void> {
  const draft = await loadDraft(key);
  if (!draft) return;
  const canWrite = getBackend().canWrite;
  await restoreBlobs(key, Object.keys(draft.uploads));
  const uploads = resumeUploads(draft.uploads, canWrite);
  if (draft.baseCommitSha === loaded.commitSha) {
    useAppStore.setState({ base: { ...loaded, docs: draft.baseDocs, config: draft.baseConfig }, work: draft.work, uploads });
    return;
  }
  const touched = touchedPaths(draft.baseDocs, draft.baseConfig, draft.work);
  const changedUpstream = [...touched].filter((path) => (draft.baseTexts[path] ?? null) !== (loaded.texts[path] ?? null));
  useAppStore.setState({
    work: rebaseWork(draft.work, loaded, touched),
    uploads,
    draftConflict: changedUpstream.length > 0 ? { paths: changedUpstream, draft } : null,
  });
}

/**
 * The branch moved while the draft waited: files the draft never touched are
 * taken from the repository, so publishing can never revert someone else's
 * newer version with a stale copy from the draft.
 */
export function rebaseWork(work: WorkState, loaded: LoadedRepo, touched: ReadonlySet<string>): WorkState {
  const codes = new Set([...Object.keys(loaded.docs), ...Object.keys(work.docs)]);
  const docs = Object.fromEntries([...codes].flatMap((code) => {
    const mine = work.docs[code];
    const pick = mine && touched.has(localeFilePath(code)) ? mine : loaded.docs[code];
    return pick ? [[code, pick]] : [];
  }));
  return { ...work, docs, config: touched.has(CONFIG_PATH) ? work.config : loaded.config };
}

/** "theirs" replaces the conflicting files of the draft with the repository version. */
export function resolveDraftConflict(choice: 'mine' | 'theirs'): void {
  const { draftConflict, base, work } = useAppStore.getState();
  if (!draftConflict || !base) return;
  if (choice === 'mine') {
    useAppStore.setState({ draftConflict: null });
    return;
  }
  const conflicted = new Set(draftConflict.paths);
  const docs = Object.fromEntries(Object.entries(work.docs).map(([code, doc]) =>
    [code, conflicted.has(localeFilePath(code)) && base.docs[code] ? base.docs[code] : doc]));
  const config = conflicted.has(CONFIG_PATH) ? base.config : work.config;
  useAppStore.setState({ work: { ...work, docs, config }, draftConflict: null, past: [], future: [] });
}

function buildDraft(state: AppState): DraftRecord | null {
  if (!state.base) return null;
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    baseCommitSha: state.base.commitSha,
    baseTexts: state.base.texts,
    baseDocs: state.base.docs,
    baseConfig: state.base.config,
    work: state.work,
    uploads: state.uploads,
  };
}

export async function saveDraftNow(): Promise<void> {
  const state = useAppStore.getState();
  if (!state.session || state.session.mode === 'sandbox' || !state.base) return;
  const hasWork = selectFileChanges(state).length > 0;
  if (!hasWork) {
    await clearDraft(state.session.repoKey);
    return;
  }
  const draft = buildDraft(state);
  if (draft) await saveDraft(state.session.repoKey, draft);
}

const DRAFT_DEBOUNCE_MS = 400;

/** Saves the draft shortly after every edit. Returns an unsubscribe function. */
export function startDraftPersistence(onError: (message: string) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return useAppStore.subscribe((state, previous) => {
    if (state.work === previous.work && state.uploads === previous.uploads) return;
    if (state.phase !== 'ready') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      saveDraftNow().catch((error) => onError(`Черновик не сохранён: ${errorMessage(error)}`));
    }, DRAFT_DEBOUNCE_MS);
  });
}

/* ---------- discard & publish ---------- */

export function discardAll(): void {
  const { base } = useAppStore.getState();
  if (!base) return;
  useAppStore.setState(stateFromLoaded(base));
}

export function discardLocale(code: string): void {
  const { base, work, past } = useAppStore.getState();
  if (!base) return;
  const restored = base.docs[code];
  const docs = Object.fromEntries(Object.entries(work.docs).flatMap(([c, doc]) => (c === code ? (restored ? [[c, restored]] : []) : [[c, doc]])));
  useAppStore.setState({ work: { ...work, docs }, past: [...past, work], future: [] });
}

export type PublishOutcome =
  | { readonly status: 'ok'; readonly sha: string }
  | { readonly status: 'nothing' }
  | { readonly status: 'conflict'; readonly paths: readonly string[] }
  | { readonly status: 'error'; readonly message: string };

export async function publish(options: { force?: boolean; message?: string } = {}): Promise<PublishOutcome> {
  if (!hasBackend() || !getBackend().canWrite) return { status: 'error', message: 'Режим только для просмотра: подключите токен, чтобы публиковать.' };
  useAppStore.setState({ busy: true });
  try {
    await ensureUploaded();
    const state = useAppStore.getState();
    const changes = selectFileChanges(state);
    if (changes.length === 0 || !state.base || !state.session) return { status: 'nothing' };
    if (state.base.truncated) {
      return { status: 'error', message: 'GitHub отдал неполный список файлов репозитория — публиковать небезопасно. Обновите данные и попробуйте ещё раз.' };
    }
    const message = options.message?.trim() || buildCommitMessage(selectSummaries(state), changes);
    const sha = await publishChanges(getBackend(), {
      baseCommitSha: state.base.commitSha,
      baseFiles: state.base.files,
      changes,
      message,
      force: options.force,
    });
    await afterPublish(state.session.repoKey, sha, Object.keys(state.uploads));
    return { status: 'ok', sha };
  } catch (error) {
    if (error instanceof ConflictError) return { status: 'conflict', paths: error.paths };
    return { status: 'error', message: errorMessage(error) };
  } finally {
    useAppStore.setState({ busy: false });
  }
}

const RELOAD_ATTEMPTS = 3;
const RELOAD_DELAY_MS = 1000;
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The commit already exists here, so this must never report the publish as
 * failed: on a persistent network error the user gets a reload screen.
 */
async function afterPublish(key: string, sha: string, uploadPaths: readonly string[]): Promise<void> {
  const lastPublished = { sha, at: new Date().toISOString() };
  try {
    await clearDraft(key);
    await clearBlobs(key, uploadPaths);
  } catch {
    // Best-effort cleanup: a leftover draft is detected and offered for review on the next load.
  }
  for (let attempt = 1; attempt <= RELOAD_ATTEMPTS; attempt += 1) {
    try {
      const loaded = await loadRepo(getBackend(), undefined, sha);
      useAppStore.setState({ ...stateFromLoaded(loaded), lastPublished });
      return;
    } catch (error) {
      if (attempt === RELOAD_ATTEMPTS) {
        useAppStore.setState({
          lastPublished,
          phase: 'error',
          error: `Опубликовано (коммит ${sha.slice(0, 7)}), но не удалось загрузить свежие данные: ${errorMessage(error)}. Нажмите «Повторить».`,
        });
        return;
      }
      await wait(RELOAD_DELAY_MS * attempt);
    }
  }
}
