/**
 * Minimal in-memory imitation of the GitHub Git Database REST API,
 * exposed as a `fetch` function. Enough for load/upload/commit/ref flows.
 */
interface Commit {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
}

interface FakeOptions {
  readonly owner?: string;
  readonly repo?: string;
  readonly branch?: string;
  readonly requireTokenForWrites?: boolean;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const toBase64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

export function createFakeGitHub(initial: Record<string, string>, options: FakeOptions = {}) {
  const owner = options.owner ?? 'owner';
  const repo = options.repo ?? 'repo';
  const branch = options.branch ?? 'main';
  const blobs = new Map<string, string>();
  const trees = new Map<string, Map<string, string>>();
  const commits = new Map<string, Commit>();
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  let counter = 0;
  let head = '';
  let beforeRefUpdate: (() => void) | null = null;
  const id = (kind: string) => `${kind}${(counter += 1).toString(16).padStart(8, '0')}`;

  const putBlob = (base64: string): string => {
    const sha = id('b');
    blobs.set(sha, base64);
    return sha;
  };
  const putTree = (entries: Map<string, string>): string => {
    const sha = id('t');
    trees.set(sha, entries);
    return sha;
  };
  const putCommit = (commit: Commit): string => {
    const sha = id('c');
    commits.set(sha, commit);
    return sha;
  };

  head = putCommit({
    tree: putTree(new Map(Object.entries(initial).map(([path, text]) => [path, putBlob(toBase64(text))]))),
    parents: [],
    message: 'init',
  });

  function readFiles(commitSha = head): Record<string, string> {
    const tree = trees.get(commits.get(commitSha)!.tree)!;
    return Object.fromEntries([...tree.entries()].map(([path, sha]) => [path, Buffer.from(blobs.get(sha)!, 'base64').toString('utf8')]));
  }

  function applyTree(base: string, entries: Array<{ path: string; sha?: string | null; content?: string }>): string {
    const next = new Map(trees.get(base));
    for (const entry of entries) {
      if (entry.content !== undefined) next.set(entry.path, putBlob(toBase64(entry.content)));
      else if (entry.sha) next.set(entry.path, entry.sha);
      else next.delete(entry.path);
    }
    return putTree(next);
  }

  /** Simulates a push from another machine. */
  function pushExternal(files: Record<string, string | null>): string {
    const entries = Object.entries(files).map(([path, text]) => (text === null ? { path, sha: null } : { path, content: text }));
    head = putCommit({ tree: applyTree(commits.get(head)!.tree, entries), parents: [head], message: 'external' });
    return head;
  }

  async function route(method: string, path: string, body: any, authorized: boolean): Promise<Response> {
    const prefix = `/repos/${owner}/${repo}`;
    if (!path.startsWith(prefix)) return json(404, { message: 'Not Found' });
    const rest = path.slice(prefix.length);
    if (method !== 'GET' && options.requireTokenForWrites && !authorized) return json(401, { message: 'Requires authentication' });
    let match: RegExpExecArray | null;
    if (method === 'GET' && rest === '') return json(200, { default_branch: branch, private: false, permissions: { push: authorized } });
    if (method === 'GET' && rest === `/git/ref/heads/${branch}`) return json(200, { object: { sha: head } });
    if (method === 'GET' && (match = /^\/git\/commits\/(\w+)$/.exec(rest))) {
      const commit = commits.get(match[1]);
      return commit ? json(200, { tree: { sha: commit.tree } }) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && (match = /^\/git\/trees\/(\w+)\?recursive=1$/.exec(rest))) {
      const tree = trees.get(match[1]);
      if (!tree) return json(404, { message: 'Not Found' });
      const entries = [...tree.entries()].map(([p, sha]) => ({ path: p, type: 'blob', sha, size: Buffer.from(blobs.get(sha)!, 'base64').length }));
      return json(200, { tree: entries, truncated: false });
    }
    if (method === 'GET' && (match = /^\/git\/blobs\/(\w+)$/.exec(rest))) {
      const content = blobs.get(match[1]);
      return content === undefined ? json(404, { message: 'Not Found' }) : json(200, { content: content.replace(/(.{60})/g, '$1\n'), encoding: 'base64' });
    }
    if (method === 'POST' && rest === '/git/blobs') return json(201, { sha: putBlob(body.content) });
    if (method === 'POST' && rest === '/git/trees') return json(201, { sha: applyTree(body.base_tree, body.tree) });
    if (method === 'POST' && rest === '/git/commits') return json(201, { sha: putCommit({ tree: body.tree, parents: body.parents, message: body.message }) });
    if (method === 'PATCH' && rest === `/git/refs/heads/${branch}`) {
      beforeRefUpdate?.();
      beforeRefUpdate = null;
      const commit = commits.get(body.sha);
      if (!commit || commit.parents[0] !== head) return json(422, { message: 'Update is not a fast forward' });
      head = body.sha;
      return json(200, { object: { sha: head } });
    }
    return json(404, { message: `No route ${method} ${rest}` });
  }

  /** raw.githubusercontent.com/<owner>/<repo>/<commit>/<path> */
  function routeRaw(url: URL): Response {
    const [rawOwner, rawRepo, commitSha, ...rest] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const commit = commits.get(commitSha);
    const blobSha = commit && rawOwner === owner && rawRepo === repo ? trees.get(commit.tree)?.get(rest.join('/')) : undefined;
    if (!blobSha) return new Response('404: Not Found', { status: 404 });
    return new Response(Buffer.from(blobs.get(blobSha)!, 'base64').toString('utf8'), { status: 200 });
  }

  const fetchImpl = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    if (url.host === 'raw.githubusercontent.com') {
      requests.push({ method, path: `raw:${decodeURIComponent(url.pathname)}` });
      return routeRaw(url);
    }
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const path = decodeURIComponent(url.pathname) + url.search;
    requests.push({ method, path, body });
    const authorized = Boolean((init.headers as Record<string, string> | undefined)?.Authorization);
    return route(method, path, body, authorized);
  };

  return {
    fetch: fetchImpl,
    requests,
    readFiles,
    pushExternal,
    get head() {
      return head;
    },
    commitMessage: (sha: string) => commits.get(sha)?.message,
    /** Runs once right before the next ref update (to simulate races). */
    onceBeforeRefUpdate(fn: () => void) {
      beforeRefUpdate = fn;
    },
  };
}
