import type { RepoFile } from '../core/types.ts';
import type { FileChange } from '../core/changes.ts';
import { changedPaths } from '../core/changes.ts';
import { isSafeRepoPath } from '../core/paths.ts';
import { NotFastForwardError } from './client.ts';
import type { RepoBackend, TreeChange } from './backend.ts';

export class ConflictError extends Error {
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    super(`В репозитории изменились файлы: ${paths.join(', ')}`);
    this.name = 'ConflictError';
    this.paths = paths;
  }
}

export interface PublishInput {
  readonly baseCommitSha: string;
  readonly baseFiles: ReadonlyMap<string, RepoFile>;
  readonly changes: readonly FileChange[];
  readonly message: string;
  /** Overwrite files that changed upstream since loading. */
  readonly force?: boolean;
}

const MAX_ATTEMPTS = 3;

export function toTreeChanges(changes: readonly FileChange[]): TreeChange[] {
  return changes.flatMap((change): TreeChange[] => {
    switch (change.kind) {
      case 'text': return [{ path: change.path, content: change.content }];
      case 'blob': return [{ path: change.path, sha: change.sha }];
      case 'rename': return [{ path: change.to, sha: change.sha }, { path: change.from, sha: null }];
      case 'delete': return [{ path: change.path, sha: null }];
    }
  });
}

/** Paths we touch whose content changed upstream since `base`. */
export function findConflicts(
  base: ReadonlyMap<string, RepoFile>,
  latest: ReadonlyMap<string, RepoFile>,
  changes: readonly FileChange[],
): string[] {
  return [...new Set(changedPaths(changes))].filter((path) => (base.get(path)?.sha ?? null) !== (latest.get(path)?.sha ?? null));
}

export function validateChanges(changes: readonly FileChange[]): void {
  if (changes.length === 0) throw new Error('Нет изменений для публикации.');
  const unsafe = changedPaths(changes).filter((path) => !isSafeRepoPath(path));
  if (unsafe.length > 0) throw new Error(`Недопустимые пути: ${unsafe.join(', ')}`);
  const notUploaded = changes.filter((change) => change.kind === 'blob' && !change.sha);
  if (notUploaded.length > 0) throw new Error('Не все файлы загружены. Дождитесь окончания загрузки.');
}

/** One atomic commit; retries if the branch moved without touching our files. */
export async function publishChanges(backend: RepoBackend, input: PublishInput): Promise<string> {
  validateChanges(input.changes);
  for (let attempt = 1; ; attempt += 1) {
    const head = await backend.getHead();
    if (head !== input.baseCommitSha && !input.force) {
      const latest = await backend.listFiles(head);
      const conflicts = findConflicts(input.baseFiles, new Map(latest.files.map((f) => [f.path, f])), input.changes);
      if (conflicts.length > 0) throw new ConflictError(conflicts);
    }
    try {
      return await backend.commit({ parentSha: head, changes: toTreeChanges(input.changes), message: input.message });
    } catch (error) {
      if (!(error instanceof NotFastForwardError) || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}
