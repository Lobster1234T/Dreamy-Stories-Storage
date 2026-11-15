import type { Rename, WorkState } from './types.ts';
import type { Fix } from './health.ts';
import { findItem, replacePath, updateDoc, updateItem } from './ops.ts';
import { newItemId } from './ids.ts';

export function applyFix(work: WorkState, fix: Fix): WorkState {
  switch (fix.type) {
    case 'relink':
      return { ...work, docs: replacePath(work.docs, fix.from, fix.to) };
    case 'delete-file':
      return markForDeletion(work, [fix.path]);
    case 'regenerate-id':
      return regenerateId(work, fix.locale, fix.uid);
    case 'rename-files':
      return fix.renames.reduce(renameFile, work);
  }
}

export function markForDeletion(work: WorkState, paths: readonly string[]): WorkState {
  const fresh = paths.filter((path) => !work.deletions.includes(path));
  return fresh.length === 0 ? work : { ...work, deletions: [...work.deletions, ...fresh] };
}

export function unmarkDeletion(work: WorkState, path: string): WorkState {
  return work.deletions.includes(path) ? { ...work, deletions: work.deletions.filter((p) => p !== path) } : work;
}

function regenerateId(work: WorkState, locale: string, uid: string): WorkState {
  const doc = work.docs[locale];
  const location = doc ? findItem(doc, uid) : null;
  if (!location) return work;
  const id = newItemId(work.docs, location.section, location.item.title);
  return { ...work, docs: updateDoc(work.docs, locale, (d) => updateItem(d, uid, { id })) };
}

/**
 * Moves a repository file to a new path without re-uploading it and updates
 * every reference. Chained renames collapse into one.
 */
export function renameFile(work: WorkState, rename: Rename): WorkState {
  if (rename.from === rename.to) return work;
  const chained = work.renames.find((r) => r.to === rename.from);
  const renames = chained
    ? work.renames.map((r) => (r === chained ? { from: r.from, to: rename.to } : r)).filter((r) => r.from !== r.to)
    : [...work.renames, rename];
  return { ...work, renames, docs: replacePath(work.docs, rename.from, rename.to) };
}
