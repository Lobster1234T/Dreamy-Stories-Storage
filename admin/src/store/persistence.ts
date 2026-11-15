import { createStore, del, get, set } from 'idb-keyval';
import type { UseStore } from 'idb-keyval';
import type { ContentConfig, Docs, Uploads, WorkState } from '../core/types.ts';
import { isRecord } from '../core/guards.ts';

/**
 * Drafts (unpublished edits) and the files waiting for upload are kept in
 * IndexedDB, so closing the tab never loses work. Separate databases: one
 * idb-keyval store per database.
 */
const hasIndexedDb = typeof indexedDB !== 'undefined';
const draftStore: UseStore | null = hasIndexedDb ? createStore('dreamy-admin-drafts', 'drafts') : null;
const blobStore: UseStore | null = hasIndexedDb ? createStore('dreamy-admin-blobs', 'blobs') : null;

export interface DraftRecord {
  readonly version: 1;
  readonly savedAt: string;
  readonly baseCommitSha: string;
  readonly baseTexts: Readonly<Record<string, string | null>>;
  readonly baseDocs: Docs;
  readonly baseConfig: ContentConfig;
  readonly work: WorkState;
  readonly uploads: Uploads;
}

export async function saveDraft(key: string, record: DraftRecord): Promise<void> {
  if (draftStore) await set(key, record, draftStore);
}

export async function loadDraft(key: string): Promise<DraftRecord | null> {
  if (!draftStore) return null;
  const value: unknown = await get(key, draftStore);
  return isDraftRecord(value) ? value : null;
}

/** Drafts come from an older version of the panel at worst: reject anything malformed. */
function isDraftRecord(value: unknown): value is DraftRecord {
  if (!isRecord(value) || value.version !== 1 || typeof value.baseCommitSha !== 'string') return false;
  const { work } = value;
  return isRecord(work) && isRecord(work.docs) && isRecord(work.config) && Array.isArray(work.deletions) &&
    Array.isArray(work.renames) && isRecord(value.baseDocs) && isRecord(value.baseConfig) &&
    isRecord(value.baseTexts) && isRecord(value.uploads);
}

export async function clearDraft(key: string): Promise<void> {
  if (draftStore) await del(key, draftStore);
}

/* ---------- pending upload files ---------- */

/** In-memory caches are keyed like IndexedDB: per repository (and mode) and path. */
const memoryBlobs = new Map<string, Blob>();
const objectUrls = new Map<string, string>();

const blobKey = (repo: string, path: string): string => `${repo}::${path}`;

export async function putBlob(repo: string, path: string, blob: Blob): Promise<void> {
  const key = blobKey(repo, path);
  memoryBlobs.set(key, blob);
  revokeUrl(key);
  if (blobStore) await set(key, blob, blobStore);
}

export async function getBlob(repo: string, path: string): Promise<Blob | null> {
  const key = blobKey(repo, path);
  const cached = memoryBlobs.get(key);
  if (cached) return cached;
  if (!blobStore) return null;
  const stored: unknown = await get(key, blobStore);
  if (!(stored instanceof Blob)) return null;
  memoryBlobs.set(key, stored);
  return stored;
}

/** Loads stored files back into memory so previews work after a reload. */
export async function restoreBlobs(repo: string, paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => getBlob(repo, path)));
}

export async function clearBlobs(repo: string, paths: readonly string[]): Promise<void> {
  const keys = paths.map((path) => blobKey(repo, path));
  for (const key of keys) {
    memoryBlobs.delete(key);
    revokeUrl(key);
  }
  if (blobStore) await Promise.all(keys.map((key) => del(key, blobStore)));
}

function revokeUrl(key: string): void {
  const url = objectUrls.get(key);
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  objectUrls.delete(key);
}

/** Object URL for a file that is not in the repository yet. */
export function localPreviewUrl(repo: string, path: string): string | null {
  const key = blobKey(repo, path);
  const blob = memoryBlobs.get(key);
  if (!blob || typeof URL.createObjectURL !== 'function') return null;
  if (!objectUrls.has(key)) {
    try {
      objectUrls.set(key, URL.createObjectURL(blob));
    } catch {
      return null;
    }
  }
  return objectUrls.get(key) ?? null;
}
