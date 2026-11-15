import { useEffect, useMemo, useState } from 'react';
import { previewSourcePath } from '../core/files.ts';
import { getBackend, hasBackend, useAppStore } from '../store/appStore.ts';
import { localPreviewUrl } from '../store/persistence.ts';
import { selectEffectiveFiles, selectUploadsInFlight } from '../store/selectors.ts';

/** URL to preview a media path: local file for pending uploads, raw GitHub otherwise. */
export function mediaUrlFor(path: string): string {
  if (!path) return '';
  const state = useAppStore.getState();
  const local = state.session ? localPreviewUrl(state.session.repoKey, path) : null;
  if (local) return local;
  if (!state.base || !hasBackend()) return '';
  const source = previewSourcePath(path, selectEffectiveFiles(state));
  if (!state.base.files.has(source)) return '';
  return getBackend().mediaUrl(source, state.base.commitSha);
}

export function useMediaUrl(path: string): string {
  const commit = useAppStore((s) => s.base?.commitSha);
  const uploads = useAppStore((s) => s.uploads);
  const renames = useAppStore((s) => s.work.renames);
  return useMemo(() => mediaUrlFor(path), [path, commit, uploads, renames]);
}

/** Small per-browser preference; storage failures just fall back to the default. */
export function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const storageKey = `dreamy-admin:pref:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey) as T | null;
      return stored && allowed.includes(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });
  const update = (next: T): void => {
    setValue(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      /* storage blocked: keep the value for this session only */
    }
  };
  return [value, update];
}

/** Warns before closing the tab while files are still uploading. */
export function useUploadUnloadGuard(): void {
  const inFlight = useAppStore(selectUploadsInFlight);
  useEffect(() => {
    if (inFlight === 0) return undefined;
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [inFlight]);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
