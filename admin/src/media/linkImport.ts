/**
 * Browser side of "add by link": talks to the panel's local server (server/linkAudioPlugin.ts).
 * Works only when the panel runs on this computer (start-admin.cmd), never on GitHub Pages.
 */
import { isRecord } from '../core/guards.ts';
import { slugify } from '../core/slug.ts';

const API = '/__dreamy';
const HEADERS = { 'content-type': 'application/json', 'x-dreamy-admin': '1' } as const;
const OFFLINE = 'Нет связи с сервером админки. Он запущен? Должно быть открыто окно start-admin.cmd.';
const ODD_ANSWER = 'Сервер админки ответил непонятно.';

/** The download server exists only in the dev server that start-admin.cmd runs. */
export const LINK_IMPORT_AVAILABLE = import.meta.env.DEV;

export interface ToolsStatus {
  readonly supported: boolean;
  readonly installed: boolean;
  readonly ytDlpVersion: string | null;
  readonly stale: boolean;
}

export interface LinkEntry {
  readonly url: string;
  readonly title: string;
  readonly duration: number | null;
  readonly uploader: string;
  readonly license: string;
}

export interface LinkInfo {
  readonly title: string;
  readonly isPlaylist: boolean;
  readonly entries: readonly LinkEntry[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseToolsStatus(data: unknown): ToolsStatus {
  if (!isRecord(data)) throw new Error(ODD_ANSWER);
  return {
    supported: data.supported === true,
    installed: data.installed === true,
    ytDlpVersion: typeof data.ytDlpVersion === 'string' ? data.ytDlpVersion : null,
    stale: data.stale === true,
  };
}

export function parseLinkInfo(data: unknown): LinkInfo {
  if (!isRecord(data) || !Array.isArray(data.entries)) throw new Error(ODD_ANSWER);
  const entries = data.entries.filter(isRecord).map((entry) => ({
    url: text(entry.url),
    title: text(entry.title),
    duration: typeof entry.duration === 'number' && Number.isFinite(entry.duration) ? entry.duration : null,
    uploader: text(entry.uploader),
    license: text(entry.license),
  })).filter((entry) => entry.url !== '');
  return { title: text(data.title), isPlaylist: data.isPlaylist === true, entries };
}

async function failure(response: Response): Promise<Error> {
  try {
    const data: unknown = await response.json();
    if (isRecord(data) && typeof data.error === 'string') return new Error(data.error);
  } catch {
    /* not JSON */
  }
  if (response.status === 404) return new Error('Скачивание по ссылке работает только в админке, запущенной на компьютере (start-admin.cmd).');
  return new Error(`Сервер админки ответил ошибкой ${response.status}.`);
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}/${path}`, { ...init, headers: HEADERS });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new Error(OFFLINE);
  }
  if (!response.ok) throw await failure(response);
  return response;
}

const post = (path: string, body: unknown, signal?: AbortSignal): Promise<Response> =>
  request(path, { method: 'POST', body: JSON.stringify(body), signal });

export async function getToolsStatus(): Promise<ToolsStatus> {
  return parseToolsStatus(await (await request('tools', { method: 'GET' })).json());
}

/** Downloads yt-dlp and ffmpeg (or updates yt-dlp) on this computer. */
export async function installTools(update: boolean): Promise<ToolsStatus> {
  return parseToolsStatus(await (await post('tools/install', { update })).json());
}

/** Title, duration and playlist entries of a link, without downloading audio. */
export async function fetchLinkInfo(url: string, signal?: AbortSignal): Promise<LinkInfo> {
  return parseLinkInfo(await (await post('link-info', { url }, signal)).json());
}

/** The link's audio as an MP3 file, ready for the usual upload. */
export async function downloadLinkAudio(url: string, title: string, signal?: AbortSignal): Promise<File> {
  const blob = await (await post('link-audio', { url }, signal)).blob();
  if (blob.size === 0) throw new Error('Сервер прислал пустой файл.');
  return new File([blob], `${slugify(title) || 'audio'}.mp3`, { type: 'audio/mpeg' });
}
