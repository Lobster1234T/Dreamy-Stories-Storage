// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolManager } from './tools.ts';
import type { PlatformTools } from './tools.ts';

const EXE = process.platform === 'win32' ? '.exe' : '';
const YT_DLP = Buffer.from('fake yt-dlp binary');
const FFMPEG = Buffer.from('fake ffmpeg binary');
const FFMPEG_GZ = gzipSync(FFMPEG);
const LATEST = 'https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26';
const DAY = 86_400_000;

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
const PLATFORM: PlatformTools = { ytDlpAsset: 'yt-dlp.exe', ffmpegAsset: 'ffmpeg-win32-x64.gz', ffmpegSha256: sha256(FFMPEG_GZ) };
const GOOD_FILES: Record<string, Buffer | string> = { 'SHA2-256SUMS': `${sha256(YT_DLP)}  yt-dlp.exe\n`, 'yt-dlp.exe': YT_DLP, 'ffmpeg-win32-x64.gz': FFMPEG_GZ };

/** A download body the test feeds by hand; errors out when the request is aborted. */
function manualBody(signal: AbortSignal | null | undefined) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
      started();
    },
  });
  return { stream, ready, push: (data: Buffer) => controller.enqueue(new Uint8Array(data)), end: () => controller.close() };
}

type Body = Buffer | string | ((signal: AbortSignal | null | undefined) => ReadableStream<Uint8Array>);

function fakeFetch(files: Record<string, Body>, calls: string[], sizes: Record<string, number> = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (init?.method === 'HEAD') return { ok: true, status: 200, url: LATEST, headers: new Headers() } as unknown as Response;
    const name = url.split('/').pop() ?? '';
    const body = files[name];
    if (body === undefined) return new Response('missing', { status: 404 });
    if (typeof body === 'function') return new Response(body(init?.signal), { headers: { 'content-length': String(sizes[name] ?? 0) } });
    const data = typeof body === 'string' ? Buffer.from(body) : body;
    return new Response(new Uint8Array(data), { headers: { 'content-length': String(data.length) } });
  }) as typeof fetch;
}

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dreamy-tools-test-'));
  dirs.push(dir);
  return path.join(dir, '.tools');
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('createToolManager', () => {
  it('installs yt-dlp and ffmpeg after checking their checksums', async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const tools = createToolManager({ dir, log: () => {}, fetchImpl: fakeFetch(GOOD_FILES, calls), platform: PLATFORM });

    expect(await tools.status()).toEqual({ supported: true, installed: false, ytDlpVersion: null, stale: false, progress: null });
    expect(await tools.paths()).toBeNull();

    const status = await tools.install(false);

    expect(status).toEqual({ supported: true, installed: true, ytDlpVersion: '2026.10.26', stale: false, progress: null });
    expect(await readFile(path.join(dir, `yt-dlp${EXE}`))).toEqual(YT_DLP);
    expect(await readFile(path.join(dir, `ffmpeg${EXE}`))).toEqual(FFMPEG);
    expect(calls).toContain('https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe');
    expect(await tools.paths()).toEqual({ dir, ytDlp: path.join(dir, `yt-dlp${EXE}`), ffmpeg: path.join(dir, `ffmpeg${EXE}`) });
  });

  it('reports download progress while a tool is coming in', async () => {
    const dir = await tempDir();
    let body: ReturnType<typeof manualBody> | null = null;
    const files = { ...GOOD_FILES, 'yt-dlp.exe': (signal: AbortSignal | null | undefined) => (body = manualBody(signal)).stream };
    const tools = createToolManager({ dir, log: () => {}, fetchImpl: fakeFetch(files, [], { 'yt-dlp.exe': YT_DLP.length }), platform: PLATFORM });

    const installing = tools.install(false);
    await vi.waitFor(() => expect(body).not.toBeNull());
    await body!.ready;
    body!.push(YT_DLP.subarray(0, 4));
    await vi.waitFor(async () => expect((await tools.status()).progress).toEqual({ label: 'yt-dlp 2026.10.26', received: 4, total: YT_DLP.length }));
    body!.push(YT_DLP.subarray(4));
    body!.end();

    expect((await installing).installed).toBe(true);
    expect((await tools.status()).progress).toBeNull();
  });

  it('gives up when GitHub stops sending data for a minute', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const dir = await tempDir();
    let body: ReturnType<typeof manualBody> | null = null;
    const files = { ...GOOD_FILES, 'yt-dlp.exe': (signal: AbortSignal | null | undefined) => (body = manualBody(signal)).stream };
    const tools = createToolManager({ dir, log: () => {}, fetchImpl: fakeFetch(files, []), platform: PLATFORM });

    const installing = tools.install(false);
    const outcome = installing.then(() => 'installed', (error: Error) => error.message);
    await vi.waitFor(() => expect(body).not.toBeNull());
    await body!.ready;
    await vi.advanceTimersByTimeAsync(61_000);

    expect(await outcome).toMatch(/больше минуты/);
    expect((await tools.status()).progress).toBeNull();
  });

  it('refuses a binary whose checksum does not match and saves nothing', async () => {
    const dir = await tempDir();
    const files = { ...GOOD_FILES, 'SHA2-256SUMS': `${'0'.repeat(64)}  yt-dlp.exe\n` };
    const tools = createToolManager({ dir, log: () => {}, fetchImpl: fakeFetch(files, []), platform: PLATFORM });

    await expect(tools.install(false)).rejects.toThrow(/Контрольная сумма/);
    await expect(stat(path.join(dir, `yt-dlp${EXE}`))).rejects.toThrow();
    expect((await tools.status()).installed).toBe(false);
  });

  it('reports a missing checksum and unsupported systems', async () => {
    const dir = await tempDir();
    const noSums = createToolManager({ dir, log: () => {}, fetchImpl: fakeFetch({ ...GOOD_FILES, 'SHA2-256SUMS': '' }, []), platform: PLATFORM });
    const unsupported = createToolManager({ dir, log: () => {}, fetchImpl: fakeFetch(GOOD_FILES, []), platform: null });

    await expect(noSums.install(false)).rejects.toThrow(/нет контрольной суммы/);
    expect(await unsupported.status()).toMatchObject({ supported: false, installed: false });
    await expect(unsupported.install(false)).rejects.toThrow(/Windows/);
  });

  it('marks yt-dlp stale after a month and refreshes only yt-dlp on update', async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const installedAt = Date.parse('2026-10-01T00:00:00Z');
    let now = installedAt;
    const tools = createToolManager({ dir, log: () => {}, fetchImpl: fakeFetch(GOOD_FILES, calls), platform: PLATFORM, now: () => now });

    await tools.install(false);
    now = installedAt + 31 * DAY;
    expect((await tools.status()).stale).toBe(true);

    expect((await tools.install(false)).stale).toBe(true);
    expect((await tools.install(true)).stale).toBe(false);
    expect(calls.filter((url) => url.endsWith('/yt-dlp.exe'))).toHaveLength(2);
    expect(calls.filter((url) => url.endsWith('.gz'))).toHaveLength(1);
  });

  it('shares one installation between parallel requests', async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const tools = createToolManager({ dir, log: () => {}, fetchImpl: fakeFetch(GOOD_FILES, calls), platform: PLATFORM });

    const [first, second] = await Promise.all([tools.install(false), tools.install(false)]);

    expect(first).toEqual(second);
    expect(calls.filter((url) => url.endsWith('/yt-dlp.exe'))).toHaveLength(1);
  });
});
