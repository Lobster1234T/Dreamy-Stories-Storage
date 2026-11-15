import type { ContentConfig, Docs, RepoFile, Rename, Uploads } from '../core/types.ts';
import type { BaseState, FileChange, LocaleSummary } from '../core/changes.ts';
import { changedUids, computeMediaChanges, computeTextChanges, summarizeDocs } from '../core/changes.ts';
import type { FileInfo } from '../core/files.ts';
import { effectiveFiles } from '../core/files.ts';
import type { Issue } from '../core/health.ts';
import { issueUids, runHealthChecks } from '../core/health.ts';
import type { LoadedRepo } from '../github/loader.ts';
import type { AppState } from './appStore.ts';

/** Single-slot memo keyed by argument identity — keeps zustand snapshots stable. */
export function memoize<A extends readonly unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let lastResult: R;
  return (...args: A): R => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((value, index) => value === args[index])) return lastResult;
    lastResult = fn(...args);
    lastArgs = args;
    return lastResult;
  };
}

const EMPTY_CHANGES: FileChange[] = [];
const EMPTY_SUMMARIES: LocaleSummary[] = [];
const EMPTY_ISSUES: Issue[] = [];
const EMPTY_FILES = new Map<string, FileInfo>();
const EMPTY_SET = new Set<string>();

const baseState = memoize((base: LoadedRepo): BaseState => ({
  docs: base.docs,
  config: base.config,
  configExists: base.configExists,
  files: base.files,
  lockDeletes: Object.keys(base.parseErrors).length > 0,
}));

// Split so upload progress ticks never re-serialize the JSON files.
const textChanges = memoize(computeTextChanges);
const mediaChanges = memoize(computeMediaChanges);
const allChanges = memoize((texts: FileChange[], media: FileChange[]): FileChange[] =>
  media.length === 0 ? texts : texts.length === 0 ? media : [...texts, ...media]);

export const localeCodes = memoize((config: ContentConfig): string[] => config.locales.map((locale) => locale.code));

const summaries = memoize((baseDocs: Docs, docs: Docs, order: readonly string[]) => summarizeDocs(baseDocs, docs, order));

const files = memoize((base: ReadonlyMap<string, RepoFile>, deletions: readonly string[], renames: readonly Rename[], uploads: Uploads) =>
  effectiveFiles(base, { deletions, renames }, uploads));

const issues = memoize((docs: Docs, config: ContentConfig, fileInfo: ReadonlyMap<string, FileInfo>, parseErrors: Readonly<Record<string, string>>) =>
  runHealthChecks({ docs, config, files: fileInfo, parseErrors }));

const changed = memoize((list: readonly LocaleSummary[]) => changedUids(list));
const problems = memoize((list: readonly Issue[]) => issueUids(list, new Set(['error', 'warning'])));

export function selectFileChanges(state: AppState): FileChange[] {
  if (!state.base) return EMPTY_CHANGES;
  const base = baseState(state.base);
  return allChanges(textChanges(base, state.work), mediaChanges(base, state.work, state.uploads));
}

export function selectSummaries(state: AppState): LocaleSummary[] {
  return state.base ? summaries(state.base.docs, state.work.docs, localeCodes(state.work.config)) : EMPTY_SUMMARIES;
}

export function selectEffectiveFiles(state: AppState): ReadonlyMap<string, FileInfo> {
  return state.base ? files(state.base.files, state.work.deletions, state.work.renames, state.uploads) : EMPTY_FILES;
}

export function selectIssues(state: AppState): Issue[] {
  return state.base ? issues(state.work.docs, state.work.config, selectEffectiveFiles(state), state.base.parseErrors) : EMPTY_ISSUES;
}

export function selectChangedUids(state: AppState): ReadonlySet<string> {
  return state.base ? changed(selectSummaries(state)) : EMPTY_SET;
}

export function selectProblemUids(state: AppState): ReadonlySet<string> {
  return state.base ? problems(selectIssues(state)) : EMPTY_SET;
}

export function selectChangeCount(state: AppState): number {
  return selectFileChanges(state).length;
}

export function selectHasUnpublished(state: AppState): boolean {
  return selectFileChanges(state).length > 0;
}

export function selectUploadsInFlight(state: AppState): number {
  return Object.values(state.uploads).filter((upload) => upload.status === 'uploading').length;
}
