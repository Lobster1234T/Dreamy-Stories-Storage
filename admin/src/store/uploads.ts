import type { UploadEntry } from '../core/types.ts';
import { referencedPaths } from '../core/ops.ts';
import { errorMessage, getBackend, setUploads, useAppStore } from './appStore.ts';
import { getBlob, putBlob } from './persistence.ts';

const inflight = new Map<string, Promise<void>>();
const PROGRESS_STEP = 0.02;

function patchUpload(path: string, patch: Partial<UploadEntry>): void {
  setUploads((uploads) => {
    const current = uploads[path];
    if (!current) return uploads;
    return { ...uploads, [path]: { ...current, ...patch } };
  });
}

function repo(): string {
  const { session } = useAppStore.getState();
  if (!session) throw new Error('Нет подключения к репозиторию.');
  return session.repoKey;
}

/**
 * Remembers the file locally (IndexedDB) and, when we can write, starts
 * uploading it to GitHub right away so publishing later is instant.
 */
export async function stageUpload(blob: Blob, path: string, options: { keep?: boolean } = {}): Promise<void> {
  await putBlob(repo(), path, blob);
  setUploads((uploads) => ({
    ...uploads,
    [path]: { path, status: 'local', progress: 0, size: blob.size, mime: blob.type, sha: null, error: null, keep: Boolean(options.keep) },
  }));
  if (getBackend().canWrite) void startUpload(path);
}

export function startUpload(path: string): Promise<void> {
  const running = inflight.get(path);
  if (running) return running;
  const task = runUpload(path).finally(() => inflight.delete(path));
  inflight.set(path, task);
  return task;
}

const MAX_ROUNDS = 3;

/**
 * Uploads the file currently staged under `path`. If it is staged again
 * while uploading, the newer file is uploaded instead of reporting the old sha.
 */
async function runUpload(path: string): Promise<void> {
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const blob = await getBlob(repo(), path);
    if (!blob) {
      patchUpload(path, { status: 'error', error: 'Файл не найден в браузере — выберите его заново.' });
      return;
    }
    const outcome = await uploadOnce(path, blob);
    if ((await getBlob(repo(), path)) === blob) {
      patchUpload(path, outcome);
      return;
    }
  }
  patchUpload(path, { status: 'error', error: 'Файл несколько раз заменили во время загрузки — попробуйте ещё раз.' });
}

async function uploadOnce(path: string, blob: Blob): Promise<Partial<UploadEntry>> {
  patchUpload(path, { status: 'uploading', progress: 0, error: null });
  let reported = 0;
  try {
    const sha = await getBackend().uploadBlob(blob, (fraction) => {
      if (fraction - reported < PROGRESS_STEP && fraction < 1) return;
      reported = fraction;
      patchUpload(path, { progress: fraction });
    });
    return { status: 'done', progress: 1, sha };
  } catch (error) {
    return { status: 'error', error: errorMessage(error) };
  }
}

/** Uploads everything that will be published; throws if something failed. */
export async function ensureUploaded(): Promise<void> {
  const { uploads, work } = useAppStore.getState();
  const referenced = referencedPaths(work.docs);
  const needed = Object.values(uploads).filter((u) => (u.keep || referenced.has(u.path)) && u.status !== 'done');
  await Promise.all(needed.map((u) => startUpload(u.path)));
  const after = useAppStore.getState().uploads;
  const failed = needed.filter((u) => after[u.path]?.status !== 'done');
  if (failed.length > 0) {
    throw new Error(`Не удалось загрузить: ${failed.map((u) => `${u.path} (${after[u.path]?.error ?? 'ошибка'})`).join('; ')}`);
  }
}

/** Uploads interrupted by a reload restart from scratch. */
export function resumeUploads(uploads: Readonly<Record<string, UploadEntry>>, canWrite: boolean): Record<string, UploadEntry> {
  return Object.fromEntries(Object.entries(uploads).map(([path, upload]) => {
    const interrupted = upload.status === 'uploading' || (upload.status === 'done' && !canWrite);
    return [path, interrupted ? { ...upload, status: 'local', progress: 0, sha: null } : upload];
  }));
}
