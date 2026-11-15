/**
 * yt-dlp and ffmpeg for the local link import. Installed only when the user asks,
 * into admin/.tools; every download is checked against a SHA-256 checksum before saving.
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isRecord } from '../src/core/guards.ts';
import { parseChecksums } from './ytdlp.ts';

const YT_DLP_RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases';
const FFMPEG_RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';
const FFMPEG_VERSION = '6.1.1';
const STALE_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_BINARY_BYTES = 80 * 1024 * 1024;
const MAX_CHECKSUMS_BYTES = 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export interface PlatformTools {
  readonly ytDlpAsset: string;
  readonly ffmpegAsset: string;
  readonly ffmpegSha256: string;
}

/** ffmpeg digests are the GitHub release asset digests of ffmpeg-static b6.1.1. */
const PLATFORMS: Readonly<Record<string, PlatformTools>> = {
  'win32-x64': { ytDlpAsset: 'yt-dlp.exe', ffmpegAsset: 'ffmpeg-win32-x64.gz', ffmpegSha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77' },
  'darwin-arm64': { ytDlpAsset: 'yt-dlp_macos', ffmpegAsset: 'ffmpeg-darwin-arm64.gz', ffmpegSha256: '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa' },
  'darwin-x64': { ytDlpAsset: 'yt-dlp_macos', ffmpegAsset: 'ffmpeg-darwin-x64.gz', ffmpegSha256: '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106' },
  'linux-x64': { ytDlpAsset: 'yt-dlp_linux', ffmpegAsset: 'ffmpeg-linux-x64.gz', ffmpegSha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa' },
};

export interface ToolsStatus {
  readonly supported: boolean;
  readonly installed: boolean;
  readonly ytDlpVersion: string | null;
  /** yt-dlp older than a month: YouTube changes often, an update usually fixes failures. */
  readonly stale: boolean;
}

export interface ToolPaths {
  readonly dir: string;
  readonly ytDlp: string;
  readonly ffmpeg: string;
}

export interface ToolManager {
  status(): Promise<ToolsStatus>;
  /** Downloads missing tools; `update` also replaces yt-dlp with the latest release. */
  install(update: boolean): Promise<ToolsStatus>;
  /** Installed tools, or null while they still need installing. */
  paths(): Promise<ToolPaths | null>;
}

export interface ToolManagerOptions {
  readonly dir: string;
  readonly log: (message: string) => void;
  readonly fetchImpl?: typeof fetch;
  /** Defaults to the current OS and CPU; tests pass their own. */
  readonly platform?: PlatformTools | null;
  readonly now?: () => number;
}

interface Versions {
  readonly ytDlp: string;
  readonly installedAt: string;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function verify(data: Buffer, expected: string, label: string): void {
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== expected.toLowerCase()) {
    throw new Error(`Контрольная сумма ${label} не совпала — файл не сохранён. Попробуйте ещё раз.`);
  }
}

export function createToolManager(options: ToolManagerOptions): ToolManager {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const platform = options.platform === undefined ? PLATFORMS[`${process.platform}-${process.arch}`] ?? null : options.platform;
  const exe = process.platform === 'win32' ? '.exe' : '';
  const ytDlp = path.join(options.dir, `yt-dlp${exe}`);
  const ffmpeg = path.join(options.dir, `ffmpeg${exe}`);
  const versionsFile = path.join(options.dir, 'versions.json');
  let installing: Promise<ToolsStatus> | null = null;

  async function readVersions(): Promise<Versions | null> {
    try {
      const data: unknown = JSON.parse(await readFile(versionsFile, 'utf8'));
      if (!isRecord(data) || typeof data.ytDlp !== 'string' || typeof data.installedAt !== 'string') return null;
      return { ytDlp: data.ytDlp, installedAt: data.installedAt };
    } catch {
      return null;
    }
  }

  async function status(): Promise<ToolsStatus> {
    if (!platform) return { supported: false, installed: false, ytDlpVersion: null, stale: false };
    const [hasYtDlp, hasFfmpeg, versions] = await Promise.all([isFile(ytDlp), isFile(ffmpeg), readVersions()]);
    const installedAt = versions ? Date.parse(versions.installedAt) : Number.NaN;
    return {
      supported: true,
      installed: hasYtDlp && hasFfmpeg,
      ytDlpVersion: versions?.ytDlp ?? null,
      stale: Number.isFinite(installedAt) && now() - installedAt > STALE_DAYS * DAY_MS,
    };
  }

  async function download(url: string, limit: number): Promise<Buffer> {
    const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`GitHub ответил ${response.status} на ${url}`);
    const tooBig = new Error(`Файл ${url} больше ожидаемого — скачивание остановлено.`);
    if (Number(response.headers.get('content-length') ?? 0) > limit) throw tooBig;
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > limit) throw tooBig;
    return data;
  }

  async function latestYtDlpTag(): Promise<string> {
    const response = await fetchImpl(`${YT_DLP_RELEASES}/latest`, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    const tag = /\/releases\/tag\/([\w.-]+)$/.exec(response.url)?.[1];
    if (!tag) throw new Error('Не удалось узнать последнюю версию yt-dlp на GitHub.');
    return tag;
  }

  async function save(file: string, data: Buffer): Promise<void> {
    const partial = `${file}.part`;
    await writeFile(partial, data, { mode: 0o755 });
    await rename(partial, file);
    if (process.platform !== 'win32') await chmod(file, 0o755);
  }

  async function installYtDlp(tools: PlatformTools): Promise<string> {
    const tag = await latestYtDlpTag();
    const base = `${YT_DLP_RELEASES}/download/${tag}`;
    const sums = parseChecksums((await download(`${base}/SHA2-256SUMS`, MAX_CHECKSUMS_BYTES)).toString('utf8'));
    const expected = sums.get(tools.ytDlpAsset);
    if (!expected) throw new Error(`В выпуске yt-dlp ${tag} нет контрольной суммы для ${tools.ytDlpAsset}.`);
    options.log(`скачиваю yt-dlp ${tag}…`);
    const binary = await download(`${base}/${tools.ytDlpAsset}`, MAX_BINARY_BYTES);
    verify(binary, expected, `yt-dlp ${tag}`);
    await save(ytDlp, binary);
    return tag;
  }

  async function installFfmpeg(tools: PlatformTools): Promise<void> {
    options.log(`скачиваю ffmpeg ${FFMPEG_VERSION}…`);
    const packed = await download(`${FFMPEG_RELEASE}/${tools.ffmpegAsset}`, MAX_BINARY_BYTES);
    verify(packed, tools.ffmpegSha256, `ffmpeg ${FFMPEG_VERSION}`);
    await save(ffmpeg, gunzipSync(packed));
  }

  async function runInstall(update: boolean): Promise<ToolsStatus> {
    if (!platform) throw new Error('Скачивание по ссылке работает на Windows (x64), macOS и Linux (x64).');
    await mkdir(options.dir, { recursive: true });
    const previous = await readVersions();
    const ytDlpMissing = !(await isFile(ytDlp));
    let versions: Versions;
    if (update || ytDlpMissing || !previous) {
      versions = { ytDlp: await installYtDlp(platform), installedAt: new Date(now()).toISOString() };
    } else {
      versions = previous;
    }
    if (!(await isFile(ffmpeg))) await installFfmpeg(platform);
    await writeFile(versionsFile, JSON.stringify({ ...versions, ffmpeg: FFMPEG_VERSION }, null, 2));
    options.log('инструменты готовы');
    return status();
  }

  return {
    status,
    install(update) {
      installing ??= runInstall(update).finally(() => {
        installing = null;
      });
      return installing;
    },
    async paths() {
      return (await status()).installed ? { dir: options.dir, ytDlp, ffmpeg } : null;
    },
  };
}
