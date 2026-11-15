import type { RepoFile, Uploads, WorkState } from './types.ts';

export interface FileInfo {
  readonly size: number;
  /** Not in the repository yet (pending upload or rename target). */
  readonly pending: boolean;
  /** Path of the original file for a pending rename. */
  readonly renamedFrom: string | null;
}

/** The file set as it will look after publishing. */
export function effectiveFiles(
  base: ReadonlyMap<string, RepoFile>,
  work: Pick<WorkState, 'deletions' | 'renames'>,
  uploads: Uploads,
): Map<string, FileInfo> {
  const files = new Map<string, FileInfo>();
  for (const [path, file] of base) files.set(path, { size: file.size, pending: false, renamedFrom: null });
  for (const { from, to } of work.renames) {
    const source = files.get(from);
    if (!source) continue;
    files.delete(from);
    files.set(to, { size: source.size, pending: true, renamedFrom: source.renamedFrom ?? from });
  }
  for (const path of work.deletions) files.delete(path);
  for (const upload of Object.values(uploads)) {
    files.set(upload.path, { size: upload.size, pending: true, renamedFrom: null });
  }
  return files;
}

/** Original repository path to preview a file that only exists after publishing. */
export function previewSourcePath(path: string, files: ReadonlyMap<string, FileInfo>): string {
  return files.get(path)?.renamedFrom ?? path;
}
