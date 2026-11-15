export interface RepoCoords {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
}

export class GitHubError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

/** The branch moved while we were committing. */
export class NotFastForwardError extends GitHubError {
  constructor() {
    super('Ветка изменилась во время публикации.', 422);
    this.name = 'NotFastForwardError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type ProgressFn = (fraction: number) => void;
export type UploadFn = (url: string, init: RequestInit & { body: string }, onProgress: ProgressFn) => Promise<Response>;

export interface GitHubClientOptions {
  readonly token?: string | null;
  readonly fetchImpl?: FetchLike;
  readonly uploadImpl?: UploadFn;
  readonly apiBase?: string;
}

export interface TreeEntry {
  readonly path: string;
  readonly type: string;
  readonly sha: string;
  readonly size?: number;
}

export interface NewTreeEntry {
  readonly path: string;
  readonly mode: '100644';
  readonly type: 'blob';
  readonly sha?: string | null;
  readonly content?: string;
}

export interface RepoInfo {
  readonly defaultBranch: string;
  readonly canPush: boolean;
  readonly isPrivate: boolean;
}

const DEFAULT_API = 'https://api.github.com';

function encodeSegments(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function resetTime(header: string | null): string {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'чуть позже';
  return new Date(seconds * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export async function toGitHubError(response: Response): Promise<GitHubError> {
  let detail = '';
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
      detail = (body as { message: string }).message;
    }
  } catch {
    detail = '';
  }
  const { status } = response;
  if (status === 401) return new GitHubError('Токен не подходит или истёк. Создайте новый токен на GitHub.', status);
  if ((status === 403 || status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
    return new GitHubError(`Исчерпан лимит запросов к GitHub. Попробуйте после ${resetTime(response.headers.get('x-ratelimit-reset'))}.`, status);
  }
  if (status === 403) return new GitHubError('Нет доступа. У токена должно быть право «Contents: Read and write» для этого репозитория.', status);
  if (status === 404) return new GitHubError('Не найдено: проверьте владельца, репозиторий, ветку и доступ токена к репозиторию.', status);
  if (status === 413) return new GitHubError('Файл слишком большой для GitHub API.', status);
  if (status === 422 && /fast.?forward/i.test(detail)) return new NotFastForwardError();
  return new GitHubError(`GitHub вернул ошибку ${status}${detail ? `: ${detail}` : ''}`, status);
}

/** XHR-based POST so large uploads can report progress. */
export const xhrUpload: UploadFn = (url, init, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method ?? 'POST', url);
    Object.entries((init.headers ?? {}) as Record<string, string>).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status, headers: parseHeaders(xhr.getAllResponseHeaders()) }));
    xhr.onerror = () => reject(new GitHubError('Нет связи с GitHub. Проверьте интернет и попробуйте ещё раз.', 0));
    xhr.send(init.body);
  });

function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  raw.trim().split(/[\r\n]+/).forEach((line) => {
    const index = line.indexOf(':');
    if (index > 0) headers.append(line.slice(0, index).trim(), line.slice(index + 1).trim());
  });
  return headers;
}

export function createGitHubClient(coords: RepoCoords, options: GitHubClientOptions = {}) {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const repoBase = `${options.apiBase ?? DEFAULT_API}/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}`;
  const headers = (json: boolean): Record<string, string> => ({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  });

  async function request<T>(method: string, path: string, body?: unknown, onProgress?: ProgressFn): Promise<T> {
    const url = `${repoBase}${path}`;
    const init = { method, headers: headers(body !== undefined), cache: 'no-store' as RequestCache };
    let response: Response;
    try {
      if (body !== undefined && onProgress && options.uploadImpl !== undefined) {
        response = await options.uploadImpl(url, { ...init, body: JSON.stringify(body) }, onProgress);
      } else {
        response = await fetchImpl(url, body === undefined ? init : { ...init, body: JSON.stringify(body) });
      }
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError('Нет связи с GitHub. Проверьте интернет и попробуйте ещё раз.', 0);
    }
    if (!response.ok) throw await toGitHubError(response);
    return (await response.json()) as T;
  }

  return {
    async getRepo(): Promise<RepoInfo> {
      const data = await request<{ default_branch: string; private: boolean; permissions?: { push?: boolean } }>('GET', '');
      return { defaultBranch: data.default_branch, canPush: Boolean(data.permissions?.push), isPrivate: data.private };
    },
    async getBranchHead(branch: string): Promise<string> {
      const data = await request<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeSegments(branch)}`);
      return data.object.sha;
    },
    async getCommitTree(commitSha: string): Promise<string> {
      const data = await request<{ tree: { sha: string } }>('GET', `/git/commits/${commitSha}`);
      return data.tree.sha;
    },
    async getTree(treeSha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
      const data = await request<{ tree: TreeEntry[]; truncated: boolean }>('GET', `/git/trees/${treeSha}?recursive=1`);
      return { entries: data.tree, truncated: data.truncated };
    },
    async getBlobBase64(sha: string): Promise<string> {
      const data = await request<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`);
      return data.content;
    },
    async createBlob(base64: string, onProgress?: ProgressFn): Promise<string> {
      const data = await request<{ sha: string }>('POST', '/git/blobs', { content: base64, encoding: 'base64' }, onProgress);
      return data.sha;
    },
    async createTree(baseTree: string, tree: readonly NewTreeEntry[]): Promise<string> {
      const data = await request<{ sha: string }>('POST', '/git/trees', { base_tree: baseTree, tree });
      return data.sha;
    },
    async createCommit(message: string, tree: string, parents: readonly string[]): Promise<string> {
      const data = await request<{ sha: string }>('POST', '/git/commits', { message, tree, parents });
      return data.sha;
    },
    async updateBranch(branch: string, sha: string): Promise<void> {
      await request('PATCH', `/git/refs/heads/${encodeSegments(branch)}`, { sha, force: false });
    },
  };
}

export type GitHubClient = ReturnType<typeof createGitHubClient>;
