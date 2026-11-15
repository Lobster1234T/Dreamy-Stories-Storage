import type { RepoFile } from '../core/types.ts';
import { encodePathForUrl } from '../core/paths.ts';
import { blobToBase64, decodeBase64Utf8 } from './encoding.ts';
import { GitHubError, NotFastForwardError, createGitHubClient, xhrUpload } from './client.ts';
import type { FetchLike, GitHubClientOptions, NewTreeEntry, ProgressFn, RepoCoords, UploadFn } from './client.ts';

/** `content` → text file, `sha` → existing blob, `sha: null` → delete. */
export interface TreeChange {
  readonly path: string;
  readonly content?: string;
  readonly sha?: string | null;
}

export interface CommitInput {
  readonly parentSha: string;
  readonly changes: readonly TreeChange[];
  readonly message: string;
}

export type BackendKind = 'github' | 'sandbox';

/** Storage the panel reads from and publishes to. */
export interface RepoBackend {
  readonly kind: BackendKind;
  readonly canWrite: boolean;
  readonly coords: RepoCoords;
  getHead(): Promise<string>;
  listFiles(commitSha: string): Promise<{ files: RepoFile[]; truncated: boolean }>;
  /** Text content of a file from the given commit. */
  readText(file: RepoFile, commitSha: string): Promise<string>;
  uploadBlob(data: Blob, onProgress?: ProgressFn): Promise<string>;
  commit(input: CommitInput): Promise<string>;
  mediaUrl(path: string, commitSha: string): string;
}

export function rawUrl(coords: RepoCoords, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/${ref}/${encodePathForUrl(path)}`;
}

function toTreeEntry(change: TreeChange): NewTreeEntry {
  return change.content !== undefined
    ? { path: change.path, mode: '100644', type: 'blob', content: change.content }
    : { path: change.path, mode: '100644', type: 'blob', sha: change.sha ?? null };
}

export interface GitHubBackendOptions {
  readonly token?: string | null;
  readonly fetchImpl?: FetchLike;
  readonly uploadImpl?: UploadFn;
}

/**
 * Without a token GitHub allows only 60 API calls per hour, so file contents
 * are read from the raw CDN instead (immutable per commit, no API quota).
 */
async function readRaw(fetchImpl: FetchLike, url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new GitHubError('Нет связи с GitHub. Проверьте интернет и попробуйте ещё раз.', 0);
  }
  if (!response.ok) throw new GitHubError(`Не удалось прочитать файл с GitHub (${response.status}).`, response.status);
  return response.text();
}

export function createGitHubBackend(coords: RepoCoords, options: GitHubBackendOptions = {}): RepoBackend {
  const clientOptions: GitHubClientOptions = {
    token: options.token ?? null,
    fetchImpl: options.fetchImpl,
    uploadImpl: options.uploadImpl ?? (typeof XMLHttpRequest !== 'undefined' && !options.fetchImpl ? xhrUpload : undefined),
  };
  const client = createGitHubClient(coords, clientOptions);
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  return {
    kind: 'github',
    canWrite: Boolean(options.token),
    coords,
    getHead: () => client.getBranchHead(coords.branch),
    async listFiles(commitSha) {
      const tree = await client.getTree(await client.getCommitTree(commitSha));
      const files = tree.entries
        .filter((entry) => entry.type === 'blob')
        .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size ?? 0 }));
      return { files, truncated: tree.truncated };
    },
    readText: async (file, commitSha) => (options.token
      ? decodeBase64Utf8(await client.getBlobBase64(file.sha))
      : readRaw(fetchImpl, rawUrl(coords, commitSha, file.path))),
    uploadBlob: async (data, onProgress) => client.createBlob(await blobToBase64(data), onProgress),
    async commit({ parentSha, changes, message }) {
      const baseTree = await client.getCommitTree(parentSha);
      const tree = await client.createTree(baseTree, changes.map(toTreeEntry));
      const commitSha = await client.createCommit(message, tree, [parentSha]);
      await client.updateBranch(coords.branch, commitSha);
      return commitSha;
    },
    mediaUrl: (path, commitSha) => rawUrl(coords, commitSha, path),
  };
}

/* ---------------- in-memory backend (sandbox and tests) ---------------- */

interface MemoryBlob {
  readonly size: number;
  readonly text?: string;
  readonly data?: Blob;
  /** Where to fetch a preview of a blob that came from upstream. */
  readonly upstreamPath?: string;
}

export interface MemoryBackend extends RepoBackend {
  /** Simulates someone else pushing to the branch. */
  pushExternal(changes: readonly TreeChange[], message?: string): Promise<string>;
  readonly commits: ReadonlyArray<{ sha: string; message: string }>;
}

export interface MemoryBackendOptions {
  readonly coords: RepoCoords;
  readonly files?: Readonly<Record<string, string | Blob>>;
  /** Read-only source the sandbox starts from (e.g. the real repository). */
  readonly upstream?: RepoBackend;
}

const textBytes = (text: string): number => new TextEncoder().encode(text).length;

export function createMemoryBackend(options: MemoryBackendOptions): MemoryBackend {
  const blobs = new Map<string, MemoryBlob>();
  const trees = new Map<string, Map<string, string>>();
  const commits: Array<{ sha: string; message: string }> = [];
  const objectUrls = new Map<string, string>();
  let counter = 0;
  let head: string | null = null;
  let upstreamHead: string | null = null;
  const nextSha = (kind: string): string => `mem-${kind}-${(counter += 1).toString(16).padStart(6, '0')}`;

  function storeText(text: string): string {
    const sha = nextSha('text');
    blobs.set(sha, { size: textBytes(text), text });
    return sha;
  }

  async function init(): Promise<string> {
    if (head) return head;
    const tree = new Map<string, string>();
    if (options.upstream) {
      upstreamHead = await options.upstream.getHead();
      const listing = await options.upstream.listFiles(upstreamHead);
      for (const file of listing.files) {
        tree.set(file.path, file.sha);
        blobs.set(file.sha, { size: file.size, upstreamPath: file.path });
      }
    }
    for (const [path, value] of Object.entries(options.files ?? {})) {
      if (typeof value === 'string') tree.set(path, storeText(value));
      else {
        const sha = nextSha('blob');
        blobs.set(sha, { size: value.size, data: value });
        tree.set(path, sha);
      }
    }
    const sha = nextSha('commit');
    trees.set(sha, tree);
    commits.push({ sha, message: 'initial' });
    head = sha;
    return sha;
  }

  function applyChanges(parent: string, changes: readonly TreeChange[], message: string): string {
    const tree = new Map(trees.get(parent));
    for (const change of changes) {
      if (change.content !== undefined) tree.set(change.path, storeText(change.content));
      else if (change.sha) {
        if (!blobs.has(change.sha)) throw new Error(`Неизвестный blob ${change.sha}`);
        tree.set(change.path, change.sha);
      } else tree.delete(change.path);
    }
    const sha = nextSha('commit');
    trees.set(sha, tree);
    commits.push({ sha, message });
    head = sha;
    return sha;
  }

  return {
    kind: 'sandbox',
    canWrite: true,
    coords: options.coords,
    commits,
    getHead: init,
    async listFiles(commitSha) {
      await init();
      const tree = trees.get(commitSha);
      if (!tree) throw new Error(`Коммит ${commitSha} не найден`);
      const files = [...tree.entries()].map(([path, sha]) => ({ path, sha, size: blobs.get(sha)?.size ?? 0 }));
      return { files, truncated: false };
    },
    async readText(file) {
      const blob = blobs.get(file.sha);
      if (blob?.text !== undefined) return blob.text;
      if (blob?.data) return blob.data.text();
      if (options.upstream && upstreamHead) {
        // Upstream blobs are read from the upstream commit under their original path.
        return options.upstream.readText({ ...file, path: blob?.upstreamPath ?? file.path }, upstreamHead);
      }
      throw new Error(`Файл ${file.path} не найден`);
    },
    async uploadBlob(data, onProgress) {
      onProgress?.(1);
      const sha = nextSha('blob');
      blobs.set(sha, { size: data.size, data });
      return sha;
    },
    async commit({ parentSha, changes, message }) {
      const current = await init();
      if (parentSha !== current) throw new NotFastForwardError();
      return applyChanges(parentSha, changes, message);
    },
    async pushExternal(changes, message = 'external') {
      return applyChanges(await init(), changes, message);
    },
    mediaUrl(path, commitSha) {
      const sha = trees.get(commitSha)?.get(path);
      const blob = sha ? blobs.get(sha) : undefined;
      if (blob?.upstreamPath && options.upstream && upstreamHead) return options.upstream.mediaUrl(blob.upstreamPath, upstreamHead);
      if (sha && blob?.data && typeof URL.createObjectURL === 'function') {
        try {
          if (!objectUrls.has(sha)) objectUrls.set(sha, URL.createObjectURL(blob.data));
          return objectUrls.get(sha)!;
        } catch {
          return '';
        }
      }
      return '';
    },
  };
}
