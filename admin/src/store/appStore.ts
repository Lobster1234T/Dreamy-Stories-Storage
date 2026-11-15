import { create } from 'zustand';
import type { Uploads, WorkState } from '../core/types.ts';
import { defaultConfig } from '../core/config.ts';
import type { RepoBackend } from '../github/backend.ts';
import type { LoadedRepo } from '../github/loader.ts';
import type { RepoCoords } from '../github/client.ts';
import type { DraftRecord } from './persistence.ts';
import type { SessionMode } from './auth.ts';

export interface SessionInfo {
  readonly coords: RepoCoords;
  readonly mode: SessionMode;
  readonly repoKey: string;
}

export type Phase = 'disconnected' | 'loading' | 'ready' | 'error';

export interface DraftConflict {
  readonly paths: readonly string[];
  readonly draft: DraftRecord;
}

export interface AppState {
  readonly session: SessionInfo | null;
  readonly phase: Phase;
  readonly error: string | null;
  /** Reload or publish in progress. */
  readonly busy: boolean;
  readonly base: LoadedRepo | null;
  readonly work: WorkState;
  readonly uploads: Uploads;
  readonly past: readonly WorkState[];
  readonly future: readonly WorkState[];
  readonly draftConflict: DraftConflict | null;
  readonly lastPublished: { readonly sha: string; readonly at: string } | null;
}

export const EMPTY_WORK: WorkState = { docs: {}, config: defaultConfig([]), deletions: [], renames: [] };

export const INITIAL_STATE: AppState = {
  session: null,
  phase: 'disconnected',
  error: null,
  busy: false,
  base: null,
  work: EMPTY_WORK,
  uploads: {},
  past: [],
  future: [],
  draftConflict: null,
  lastPublished: null,
};

export const useAppStore = create<AppState>()(() => INITIAL_STATE);

const HISTORY_LIMIT = 100;

/* ---------- backend registry (not serializable, kept outside the state) ---------- */

let currentBackend: RepoBackend | null = null;

export function setBackend(backend: RepoBackend | null): void {
  currentBackend = backend;
}

export function getBackend(): RepoBackend {
  if (!currentBackend) throw new Error('Нет подключения к репозиторию.');
  return currentBackend;
}

export function hasBackend(): boolean {
  return currentBackend !== null;
}

/* ---------- work history ---------- */

/** Applies an edit and records it for undo. No-op edits are ignored. */
export function applyWork(updater: (work: WorkState) => WorkState): void {
  const state = useAppStore.getState();
  const next = updater(state.work);
  if (next === state.work) return;
  useAppStore.setState({ work: next, past: [...state.past, state.work].slice(-HISTORY_LIMIT), future: [] });
}

export function undo(): void {
  const { past, work, future } = useAppStore.getState();
  if (past.length === 0) return;
  useAppStore.setState({ work: past[past.length - 1], past: past.slice(0, -1), future: [work, ...future] });
}

export function redo(): void {
  const { past, work, future } = useAppStore.getState();
  if (future.length === 0) return;
  useAppStore.setState({ work: future[0], past: [...past, work], future: future.slice(1) });
}

export function setUploads(updater: (uploads: Uploads) => Uploads): void {
  const { uploads } = useAppStore.getState();
  const next = updater(uploads);
  if (next !== uploads) useAppStore.setState({ uploads: next });
}

export function stateFromLoaded(loaded: LoadedRepo): Partial<AppState> {
  return {
    base: loaded,
    work: { docs: loaded.docs, config: loaded.config, deletions: [], renames: [] },
    uploads: {},
    past: [],
    future: [],
    draftConflict: null,
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
