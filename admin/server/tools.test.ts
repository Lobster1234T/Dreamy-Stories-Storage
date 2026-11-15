// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
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
const GOOD_FILES = { 'SHA2-256SUMS': `${sha256(YT_DLP)}  yt-dlp.exe\n`, 'yt-dlp.exe': YT_DLP, 'ffmpeg-win32-x64.gz': FFMPEG_GZ };

function fakeFetch(files: Record<string, Buffer | string>, calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (init?.method === 'HEAD') return { ok: true, status: 200, url: LATEST, headers: new Headers() } as unknown as Response;
    const body = files[url.split('/').pop() ?? ''];
    if (body === undefined) return { ok: false, status: 404, url, headers: new Headers() } as unknown as Response;
    const data = typeof body === 'string' ? Buffer.from(body) : body;
    return {
      ok: true,
      status: 200,
      url,
      headers: new Headers({ 'content-length': String(data.length) }),
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    } as unknown as Response;
  }) as typeof fetch;
}

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dreamy-tools-test-'));
  dirs.push(dir);
  return path.join(dir, '.tools');
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('createToolManager', () => {
  it('installs yt-dlp and ffmpeg after checking their checksums', async () => {
    const dir = await tempDir();
    const calls: string[] = [];
    const tools = createToolManager({ dir, log: () => {}, fetchImpl: fakeFetch(GOOD_FILES, calls), platform: PLATFORM });

    expect(await tools.status()).toEqual({ supported: true, installed: false, ytDlpVersion: null, stale: false });
    expect(await tools.paths()).toBeNull();

    const status = await tools.install(false);

    expect(status).toEqual({ supported: true, installed: true, ytDlpVersion: '2026.10.26', stale: false });
    expect(await readFile(path.join(dir, `yt-dlp${EXE}`))).toEqual(YT_DLP);
    expect(await readFile(path.join(dir, `ffmpeg${EXE}`))).toEqual(FFMPEG);
    expect(calls).toContain('https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe');
    expect(await tools.paths()).toEqual({ dir, ytDlp: path.join(dir, `yt-dlp${EXE}`), ffmpeg: path.join(dir, `ffmpeg${EXE}`) });
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
