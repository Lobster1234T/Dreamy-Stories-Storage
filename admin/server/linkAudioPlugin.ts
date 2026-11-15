/**
 * Dev-server endpoints that turn a link into an MP3 on this computer (yt-dlp + ffmpeg).
 * Active only under `npm run dev` / start-admin.cmd: GitHub Pages has no server, and
 * YouTube refuses downloads from cloud machines anyway.
 *
 *   GET  /__dreamy/tools                     → ToolsStatus
 *   POST /__dreamy/tools/install  {update?}  → ToolsStatus (downloads tools on an explicit click)
 *   POST /__dreamy/link-info      {url}      → LinkInfo
 *   POST /__dreamy/link-audio     {url}      → audio/mpeg
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Plugin } from 'vite';
import { isRecord } from '../src/core/guards.ts';
import { normalizeLink } from '../src/core/links.ts';
import { formatBytes, GITHUB_FILE_LIMIT_BYTES } from '../src/core/paths.ts';
import { createToolManager } from './tools.ts';
import type { ToolManager, ToolPaths } from './tools.ts';
import { downloadArgs, friendlyError, infoArgs, mp3Args, needsConversion, parseInfo, pickDownloadedFile } from './ytdlp.ts';
import type { YtDlpOptions } from './ytdlp.ts';

export const LINK_API_PREFIX = '/__dreamy/';
const MAX_BODY_BYTES = 8 * 1024;
const MAX_DRAIN_BYTES = 1024 * 1024;
const MAX_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_CHARS = 20_000;
const INFO_TIMEOUT_MS = 3 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;
const SOURCE_PREFIX = 'source.';
const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i;
const YT_DLP_OPTIONS: YtDlpOptions = { nodePath: process.execPath };

export interface ApiLogger {
  info(message: string): void;
  error(message: string): void;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/**
 * Only the panel itself may call: loopback Host (stops DNS-rebinding pages from using yt-dlp
 * to reach the local network), a custom header (forces a CORS preflight) and the same origin.
 */
function assertFromPanel(req: IncomingMessage): void {
  const { origin, host } = req.headers;
  if (!host || !LOOPBACK_HOST.test(host)) throw new HttpError(403, 'Скачивание по ссылке работает только на этом компьютере (localhost).');
  if (req.headers['x-dreamy-admin'] !== '1') throw new HttpError(403, 'Запрос не из админки.');
  if (!origin) return;
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    /* malformed origin: rejected below */
  }
  if (!host || originHost !== host) throw new HttpError(403, 'Запрос с чужого сайта.');
}

/**
 * Reads a small JSON body. An oversized body is drained (not cut off) so the 413 answer
 * still reaches the browser; abusive sizes drop the connection.
 */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DRAIN_BYTES) req.destroy();
      else if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Слишком большой запрос.'));
        return;
      }
      if (size === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Неверный JSON.'));
      }
    });
  });
}

async function readLink(req: IncomingMessage): Promise<string> {
  const body = await readJson(req);
  const url = normalizeLink(isRecord(body) ? body.url : undefined);
  if (!url) throw new HttpError(400, 'Нужна ссылка, начинающаяся с http:// или https://.');
  return url;
}

/** Aborts the work when the browser goes away before the answer is complete. */
function disconnectSignal(res: ServerResponse): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

/** Runs a tool directly (no shell), with a time limit and capped output. */
function runProcess(command: string, args: readonly string[], timeoutMs: number, signal: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let timedOut = false;
    const kill = (): void => {
      child.kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal.addEventListener('abort', kill, { once: true });
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', kill);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) kill();
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_CHARS);
    });
    child.on('error', (error) => {
      finish();
      reject(error);
    });
    child.on('close', (code) => {
      finish();
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr, timedOut });
    });
  });
}

async function runTool(label: string, command: string, args: readonly string[], timeoutMs: number, signal: AbortSignal): Promise<ProcessResult> {
  let result: ProcessResult;
  try {
    result = await runProcess(command, args, timeoutMs, signal);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new HttpError(500, `Не удалось запустить ${label} (${reason}). Нажмите «Обновить инструменты»; если не поможет — проверьте, не блокирует ли его антивирус.`);
  }
  if (result.timedOut) throw new HttpError(504, `${label} работал слишком долго и был остановлен. Попробуйте ещё раз.`);
  return result;
}

async function requireTools(tools: ToolManager): Promise<ToolPaths> {
  const paths = await tools.paths();
  if (!paths) throw new HttpError(409, 'Сначала установите инструменты для скачивания.');
  return paths;
}

async function handleInfo(req: IncomingMessage, res: ServerResponse, tools: ToolManager): Promise<void> {
  const url = await readLink(req);
  const paths = await requireTools(tools);
  const result = await runTool('yt-dlp', paths.ytDlp, infoArgs(url, YT_DLP_OPTIONS), INFO_TIMEOUT_MS, disconnectSignal(res));
  if (result.code !== 0) throw new HttpError(422, friendlyError(result.stderr));
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new HttpError(502, 'yt-dlp вернул непонятный ответ. Нажмите «Обновить инструменты».');
  }
  const info = parseInfo(json, url);
  if (info.entries.length === 0) throw new HttpError(422, 'По ссылке не нашлось ни одного видео или аудио.');
  sendJson(res, 200, info);
}

/** Downloads the best audio into `work` and returns the path of an MP3 file. */
async function fetchAsMp3(url: string, paths: ToolPaths, work: string, signal: AbortSignal): Promise<string> {
  const template = path.join(work, `${SOURCE_PREFIX}%(ext)s`);
  const fetched = await runTool('yt-dlp', paths.ytDlp, downloadArgs(url, template, paths.dir, YT_DLP_OPTIONS), DOWNLOAD_TIMEOUT_MS, signal);
  if (fetched.code !== 0) throw new HttpError(422, friendlyError(fetched.stderr));
  const name = pickDownloadedFile(await readdir(work), SOURCE_PREFIX);
  if (!name) throw new HttpError(422, 'yt-dlp не сохранил файл — попробуйте другую ссылку.');
  const source = path.join(work, name);
  if (!needsConversion(name)) return source;
  const output = path.join(work, 'audio.mp3');
  const converted = await runTool('ffmpeg', paths.ffmpeg, mp3Args(source, output), DOWNLOAD_TIMEOUT_MS, signal);
  if (converted.code !== 0) {
    const reason = converted.stderr.trim().split(/\r?\n/).pop() ?? '';
    throw new HttpError(422, `ffmpeg не смог сделать MP3${reason ? `: ${reason.slice(0, 300)}` : '.'}`);
  }
  return output;
}

async function handleAudio(req: IncomingMessage, res: ServerResponse, tools: ToolManager, logger: ApiLogger): Promise<void> {
  const url = await readLink(req);
  const paths = await requireTools(tools);
  const signal = disconnectSignal(res);
  const work = await mkdtemp(path.join(tmpdir(), 'dreamy-link-'));
  try {
    const mp3 = await fetchAsMp3(url, paths, work, signal);
    const { size } = await stat(mp3);
    if (size > GITHUB_FILE_LIMIT_BYTES) {
      throw new HttpError(413, `MP3 получился ${formatBytes(size)} — это больше лимита GitHub (≈95 МБ).`);
    }
    res.writeHead(200, {
      'content-type': 'audio/mpeg',
      'content-length': size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    await pipeline(createReadStream(mp3), res);
    logger.info(`скачано ${formatBytes(size)}: ${url}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function route(req: IncomingMessage, res: ServerResponse, tools: ToolManager, logger: ApiLogger): Promise<void> {
  assertFromPanel(req);
  const endpoint = (req.url ?? '').split('?')[0].slice(LINK_API_PREFIX.length);
  if (req.method === 'GET' && endpoint === 'tools') {
    sendJson(res, 200, await tools.status());
    return;
  }
  if (req.method === 'POST' && endpoint === 'tools/install') {
    const body = await readJson(req);
    try {
      sendJson(res, 200, await tools.install(isRecord(body) && body.update === true));
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (req.method === 'POST' && endpoint === 'link-info') return handleInfo(req, res, tools);
  if (req.method === 'POST' && endpoint === 'link-audio') return handleAudio(req, res, tools, logger);
  throw new HttpError(404, 'Нет такого адреса.');
}

/** Connect-style middleware for the link API; exported for tests. */
export function createLinkApiMiddleware(tools: ToolManager, logger: ApiLogger) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (!req.url?.startsWith(LINK_API_PREFIX)) {
      next();
      return;
    }
    route(req, res, tools, logger).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (status >= 500) logger.error(message);
      if (res.headersSent || res.destroyed) {
        res.destroy();
        return;
      }
      sendJson(res, status, { error: message });
    });
  };
}

export function linkAudioPlugin(): Plugin {
  return {
    name: 'dreamy-link-audio',
    apply: 'serve',
    configureServer(server) {
      const { logger } = server.config;
      const log: ApiLogger = {
        info: (message) => logger.info(`[ссылки] ${message}`, { timestamp: true }),
        error: (message) => logger.error(`[ссылки] ${message}`, { timestamp: true }),
      };
      const tools = createToolManager({ dir: path.join(server.config.root, '.tools'), log: log.info });
      server.middlewares.use(createLinkApiMiddleware(tools, log));
    },
  };
}
