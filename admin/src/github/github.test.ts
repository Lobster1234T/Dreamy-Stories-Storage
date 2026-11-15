import { describe, expect, it } from 'vitest';
import { createGitHubBackend, createMemoryBackend, rawUrl } from './backend.ts';
import { GitHubError, NotFastForwardError, createGitHubClient, toGitHubError } from './client.ts';
import { loadRepo } from './loader.ts';
import { ConflictError, findConflicts, publishChanges, toTreeChanges, validateChanges } from './publisher.ts';
import { blobToBase64, decodeBase64Utf8, shortHash } from './encoding.ts';
import type { FileChange } from '../core/changes.ts';
import { createFakeGitHub } from '../test/fakeGitHub.ts';
import { EN_JSON, RU_JSON, jsonText, uidFactory } from '../test/fixtures.ts';

const coords = { owner: 'owner', repo: 'repo', branch: 'main' };

function setup(extra: Record<string, string> = {}) {
  const fake = createFakeGitHub({ 'ru.json': jsonText(RU_JSON), 'en.json': jsonText(EN_JSON), 'images/a.jpg': 'jpg', ...extra });
  const backend = createGitHubBackend(coords, { token: 'test-token', fetchImpl: fake.fetch });
  return { fake, backend };
}

const textChange = (path: string, content: string): FileChange => ({ kind: 'text', path, content, isNew: false });

describe('loadRepo', () => {
  it('loads files, detects geos, parses docs and assigns ids', async () => {
    const { backend } = setup();
    const repo = await loadRepo(backend, uidFactory());
    expect(repo.config.locales.map((l) => l.code)).toEqual(['en', 'ru']);
    expect(repo.configExists).toBe(false);
    expect(repo.docs.ru.stories.map((s) => s.title)).toEqual(['Рапунцель', 'Пиноккио']);
    expect(repo.docs.ru.stories[0].id).toBe('rapunzel');
    expect(repo.docs.ru.lullabies[0].id).toBe('starry-night');
    expect(repo.files.get('images/a.jpg')?.size).toBe(3);
    expect(repo.texts['ru.json']).toContain('Рапунцель');
  });

  it('reads file contents from the raw CDN without a token to save the API quota', async () => {
    const fake = createFakeGitHub({ 'ru.json': jsonText(RU_JSON), 'en.json': jsonText(EN_JSON) });
    const anonymous = createGitHubBackend(coords, { fetchImpl: fake.fetch });
    const repo = await loadRepo(anonymous, uidFactory());
    expect(repo.docs.ru.stories).toHaveLength(2);
    const apiCalls = fake.requests.filter((r) => !r.path.startsWith('raw:'));
    expect(apiCalls.map((r) => r.path)).toEqual(['/repos/owner/repo/git/ref/heads/main', expect.stringMatching(/^\/repos\/owner\/repo\/git\/commits\//), expect.stringMatching(/^\/repos\/owner\/repo\/git\/trees\//)]);
    expect(fake.requests.filter((r) => r.path.startsWith('raw:'))).toHaveLength(2);
    await expect(anonymous.readText({ path: 'missing.json', sha: 'x', size: 1 }, repo.commitSha)).rejects.toThrow(/404/);
  });

  it('reports broken geo files without failing the whole load', async () => {
    const { backend } = setup({ 'fr.json': '{ broken' });
    const repo = await loadRepo(backend, uidFactory());
    expect(repo.parseErrors.fr).toMatch(/fr\.json/);
    expect(repo.docs.fr).toBeUndefined();
  });

  it('refuses to open absurdly large geo files', async () => {
    const { backend } = setup();
    const real = backend.listFiles.bind(backend);
    backend.listFiles = async (sha) => {
      const listing = await real(sha);
      return { ...listing, files: listing.files.map((f) => (f.path === 'ru.json' ? { ...f, size: 50 * 1024 * 1024 } : f)) };
    };
    const repo = await loadRepo(backend, uidFactory());
    expect(repo.parseErrors.ru).toMatch(/слишком большой/);
    expect(repo.docs.ru).toBeUndefined();
    expect(repo.docs.en.stories).toHaveLength(2);
  });

  it('reads an existing config and creates empty docs for configured geos without a file', async () => {
    const config = JSON.stringify({ locales: [{ code: 'ru', label: 'RU' }, { code: 'pl', label: 'PL' }], settings: { autoNumberTitles: false } });
    const { backend } = setup({ 'admin/config.json': config });
    const repo = await loadRepo(backend, uidFactory());
    expect(repo.configExists).toBe(true);
    expect(repo.config.locales.map((l) => l.code)).toEqual(['ru', 'pl', 'en']);
    expect(repo.docs.pl.stories).toEqual([]);
    expect(repo.docs.ru.stories[0].title).toBe('1. Рапунцель');
  });
});

describe('publishChanges', () => {
  it('commits text, uploaded blobs, renames and deletions atomically', async () => {
    const { fake, backend } = setup();
    const repo = await loadRepo(backend, uidFactory());
    const sha = await backend.uploadBlob(new Blob(['mp3-bytes']));
    const commit = await publishChanges(backend, {
      baseCommitSha: repo.commitSha,
      baseFiles: repo.files,
      message: 'Контент: RU ✎1',
      changes: [
        textChange('ru.json', '{"stories":[]}\n'),
        { kind: 'blob', path: 'stories/ru/new-abc.mp3', sha, size: 9, status: 'done' },
        { kind: 'rename', from: 'images/a.jpg', to: 'images/cover.jpg', sha: repo.files.get('images/a.jpg')!.sha },
        { kind: 'delete', path: 'en.json' },
      ],
    });
    expect(fake.head).toBe(commit);
    expect(fake.commitMessage(commit)).toBe('Контент: RU ✎1');
    const files = fake.readFiles();
    expect(Object.keys(files).sort()).toEqual(['images/cover.jpg', 'ru.json', 'stories/ru/new-abc.mp3']);
    expect(files['stories/ru/new-abc.mp3']).toBe('mp3-bytes');
    expect(files['images/cover.jpg']).toBe('jpg');
  });

  it('refuses to overwrite files that changed upstream unless forced', async () => {
    const { fake, backend } = setup();
    const repo = await loadRepo(backend, uidFactory());
    fake.pushExternal({ 'ru.json': '{"stories":[{"name":"чужая правка"}]}\n' });
    const input = { baseCommitSha: repo.commitSha, baseFiles: repo.files, message: 'm', changes: [textChange('ru.json', '{}\n')] };
    await expect(publishChanges(backend, input)).rejects.toBeInstanceOf(ConflictError);
    await expect(publishChanges(backend, input)).rejects.toMatchObject({ paths: ['ru.json'] });
    await publishChanges(backend, { ...input, force: true });
    expect(fake.readFiles()['ru.json']).toBe('{}\n');
  });

  it('keeps unrelated upstream changes', async () => {
    const { fake, backend } = setup();
    const repo = await loadRepo(backend, uidFactory());
    fake.pushExternal({ 'en.json': 'external\n' });
    await publishChanges(backend, { baseCommitSha: repo.commitSha, baseFiles: repo.files, message: 'm', changes: [textChange('ru.json', 'mine\n')] });
    expect(fake.readFiles()).toMatchObject({ 'en.json': 'external\n', 'ru.json': 'mine\n' });
  });

  it('retries when the branch moves during the commit', async () => {
    const { fake, backend } = setup();
    const repo = await loadRepo(backend, uidFactory());
    fake.onceBeforeRefUpdate(() => fake.pushExternal({ 'other.txt': 'x' }));
    await publishChanges(backend, { baseCommitSha: repo.commitSha, baseFiles: repo.files, message: 'm', changes: [textChange('ru.json', 'mine\n')] });
    expect(fake.readFiles()).toMatchObject({ 'other.txt': 'x', 'ru.json': 'mine\n' });
  });

  it('validates changes before talking to GitHub', () => {
    expect(() => validateChanges([])).toThrow(/Нет изменений/);
    expect(() => validateChanges([textChange('.github/workflows/x.yml', 'x')])).toThrow(/Недопустимые пути/);
    expect(() => validateChanges([{ kind: 'blob', path: 'a.mp3', sha: null, size: 1, status: 'uploading' }])).toThrow(/загружены/);
  });

  it('maps changes to tree entries and finds conflicts', () => {
    const changes: FileChange[] = [{ kind: 'rename', from: 'a', to: 'b', sha: 's' }, { kind: 'delete', path: 'c' }];
    expect(toTreeChanges(changes)).toEqual([{ path: 'b', sha: 's' }, { path: 'a', sha: null }, { path: 'c', sha: null }]);
    const base = new Map([['a', { path: 'a', sha: '1', size: 1 }]]);
    const latest = new Map([['a', { path: 'a', sha: '2', size: 1 }], ['b', { path: 'b', sha: '3', size: 1 }]]);
    expect(findConflicts(base, latest, changes)).toEqual(['a', 'b']);
  });
});

describe('GitHub client errors', () => {
  const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  it.each([
    [401, {}, {}, /Токен не подходит/],
    [403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }, /лимит запросов/],
    [403, {}, {}, /Contents: Read and write/],
    [404, {}, {}, /Не найдено/],
    [413, {}, {}, /слишком большой/],
    [500, { message: 'boom' }, {}, /500: boom/],
  ])('maps HTTP %i to a readable message', async (status, body, headers, pattern) => {
    const error = await toGitHubError(response(status, body, headers));
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.message).toMatch(pattern);
  });

  it('recognizes non-fast-forward updates and broken bodies', async () => {
    expect(await toGitHubError(response(422, { message: 'Update is not a fast forward' }))).toBeInstanceOf(NotFastForwardError);
    const broken = new Response('not json', { status: 502 });
    expect((await toGitHubError(broken)).message).toBe('GitHub вернул ошибку 502');
  });

  it('turns network failures into a friendly error and sends the token', async () => {
    const seen: Array<Record<string, string>> = [];
    const client = createGitHubClient(coords, {
      token: 'secret',
      fetchImpl: async (_url, init) => {
        seen.push(init?.headers as Record<string, string>);
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(client.getBranchHead('main')).rejects.toThrow(/Нет связи с GitHub/);
    expect(seen[0].Authorization).toBe('Bearer secret');
  });

  it('reports repository permissions and uses the progress uploader', async () => {
    const { fake } = setup();
    const progress: number[] = [];
    const client = createGitHubClient(coords, {
      token: 't',
      fetchImpl: fake.fetch,
      uploadImpl: async (url, init, onProgress) => {
        onProgress(0.5);
        onProgress(1);
        return fake.fetch(url, init);
      },
    });
    expect(await client.getRepo()).toEqual({ defaultBranch: 'main', canPush: true, isPrivate: false });
    expect(await client.createBlob('YQ==', (p) => progress.push(p))).toMatch(/^b/);
    expect(progress).toEqual([0.5, 1]);
  });

  it('builds raw URLs for media', () => {
    const backend = createGitHubBackend(coords);
    expect(backend.canWrite).toBe(false);
    expect(backend.mediaUrl('stories/de/12. Löwe.mp3', 'abc')).toBe('https://raw.githubusercontent.com/owner/repo/abc/stories/de/12.%20L%C3%B6we.mp3');
    expect(rawUrl(coords, 'main', 'a b.jpg')).toContain('a%20b.jpg');
  });
});

describe('memory backend', () => {
  it('stores commits, blobs and texts in memory', async () => {
    const backend = createMemoryBackend({ coords, files: { 'ru.json': '{"stories":[]}', 'images/a.jpg': new Blob(['img']) } });
    const head = await backend.getHead();
    const listing = await backend.listFiles(head);
    expect(listing.files.map((f) => f.path).sort()).toEqual(['images/a.jpg', 'ru.json']);
    const sha = await backend.uploadBlob(new Blob(['new']));
    const next = await backend.commit({ parentSha: head, message: 'm', changes: [{ path: 'b.mp3', sha }, { path: 'ru.json', sha: null }] });
    const after = await backend.listFiles(next);
    expect(after.files.map((f) => f.path).sort()).toEqual(['b.mp3', 'images/a.jpg']);
    expect(await backend.readText(after.files.find((f) => f.path === 'b.mp3')!, next)).toBe('new');
    await expect(backend.commit({ parentSha: head, message: 'stale', changes: [] })).rejects.toBeInstanceOf(NotFastForwardError);
    await expect(backend.listFiles('nope')).rejects.toThrow();
    await expect(backend.commit({ parentSha: next, message: 'x', changes: [{ path: 'z', sha: 'unknown' }] })).rejects.toThrow(/Неизвестный blob/);
    expect(backend.commits.map((c) => c.message)).toEqual(['initial', 'm']);
  });

  it('starts from an upstream repository and previews its media', async () => {
    const { backend: upstream } = setup();
    const sandbox = createMemoryBackend({ coords, upstream });
    const repo = await loadRepo(sandbox, uidFactory());
    expect(repo.docs.ru.stories).toHaveLength(2);
    expect(sandbox.mediaUrl('images/a.jpg', repo.commitSha)).toMatch(/^https:\/\/raw\.githubusercontent\.com\/owner\/repo\/c/);
    expect(sandbox.mediaUrl('missing.jpg', repo.commitSha)).toBe('');
    const external = await sandbox.pushExternal([{ path: 'x.txt', content: 'hi' }]);
    expect(await sandbox.getHead()).toBe(external);
  });
});

describe('encoding', () => {
  it('decodes base64 UTF-8 with line breaks', () => {
    const encoded = Buffer.from('Сказка ✨', 'utf8').toString('base64');
    expect(decodeBase64Utf8(`${encoded.slice(0, 4)}\n${encoded.slice(4)}`)).toBe('Сказка ✨');
  });

  it('encodes blobs and hashes them', async () => {
    const blob = new Blob(['hello']);
    expect(await blobToBase64(blob)).toBe('aGVsbG8=');
    expect(await shortHash(blob)).toBe('aaf4c61d');
  });
});
