/**
 * Pure helpers around yt-dlp and ffmpeg for the local link-import server:
 * command lines, output parsing and readable errors. No processes, no file system.
 */
import { isRecord } from '../src/core/guards.ts';
import { normalizeLink } from '../src/core/links.ts';

export const MAX_PLAYLIST_ITEMS = 200;
export const MP3_BITRATE = '128k';
/** Source downloads above this are refused before conversion. */
const MAX_SOURCE_SIZE = '500M';

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

export interface YtDlpOptions {
  /** Node.js binary: yt-dlp needs a JavaScript runtime for YouTube's player challenges. */
  readonly nodePath: string;
}

function commonArgs(options: YtDlpOptions): string[] {
  return [
    '--ignore-config', '--no-warnings', '--no-progress', '--encoding', 'utf-8',
    '--socket-timeout', '30', '--js-runtimes', `node:${options.nodePath}`,
  ];
}

/** Title, duration and playlist entries without downloading anything. */
export function infoArgs(url: string, options: YtDlpOptions): string[] {
  return [...commonArgs(options), '--no-playlist', '--flat-playlist', '--dump-single-json', '--playlist-items', `1:${MAX_PLAYLIST_ITEMS}`, '--', url];
}

/** Best audio of a single video (never a whole playlist) into outputTemplate. */
export function downloadArgs(url: string, outputTemplate: string, ffmpegDir: string, options: YtDlpOptions): string[] {
  return [
    ...commonArgs(options), '--no-playlist', '--playlist-items', '1',
    '-f', 'bestaudio/best', '--max-filesize', MAX_SOURCE_SIZE,
    '--ffmpeg-location', ffmpegDir, '-o', outputTemplate, '--', url,
  ];
}

/** First audio stream to MP3, without cover art or tags. */
export function mp3Args(input: string, output: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input,
    '-map', '0:a:0', '-vn', '-map_metadata', '-1', '-codec:a', 'libmp3lame', '-b:a', MP3_BITRATE, '-ar', '44100', output,
  ];
}

/** Direct MP3 files are kept as they are; everything else is converted. */
export function needsConversion(fileName: string): boolean {
  return !/\.mp3$/i.test(fileName);
}

/** The finished download in a work folder, skipping partial and temporary files. */
export function pickDownloadedFile(names: readonly string[], prefix: string): string | null {
  return names.find((name) => name.startsWith(prefix) && !/\.(?:part|ytdl|temp|tmp)$/i.test(name) && !/\.part-Frag\d+/i.test(name)) ?? null;
}

const UNAVAILABLE_TITLE = /^\[(?:private|deleted|unavailable)\s+video\]$/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function toEntry(value: unknown, fallbackUrl: string | null): LinkEntry | null {
  if (!isRecord(value)) return null;
  const url = normalizeLink(value.webpage_url) ?? normalizeLink(value.original_url) ?? normalizeLink(value.url) ?? fallbackUrl;
  const title = text(value.title);
  if (!url || UNAVAILABLE_TITLE.test(title)) return null;
  return {
    url,
    title: title || url,
    duration: seconds(value.duration),
    uploader: text(value.channel) || text(value.uploader),
    license: text(value.license),
  };
}

/** Video or playlist description from `yt-dlp -J --flat-playlist`. */
export function parseInfo(json: unknown, requestedUrl: string): LinkInfo {
  if (!isRecord(json)) throw new Error('yt-dlp вернул непонятный ответ.');
  if (json._type === 'playlist' && Array.isArray(json.entries)) {
    const entries = json.entries.map((entry) => toEntry(entry, null)).filter((entry): entry is LinkEntry => entry !== null);
    return { title: text(json.title), isPlaylist: true, entries: entries.slice(0, MAX_PLAYLIST_ITEMS) };
  }
  const entry = toEntry(json, requestedUrl);
  return { title: entry?.title ?? '', isPlaylist: false, entries: entry ? [entry] : [] };
}

/** "SHA2-256SUMS" style text: `<sha256>  <file name>` per line. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(\S.*)$/i.exec(line.trim());
    if (match) sums.set(match[2].trim(), match[1].toLowerCase());
  }
  return sums;
}

/** Most specific first: "Sign in to confirm your age" must not read as the bot check. */
const ERROR_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/confirm your age|age.?restrict|inappropriate for some users/i, 'Видео с возрастным ограничением — без входа в YouTube его не скачать.'],
  [/confirm you.?re not a bot|sign in to confirm/i, 'YouTube просит подтвердить, что вы не бот. Подождите 10–15 минут и попробуйте снова или нажмите «Обновить инструменты».'],
  [/private video/i, 'Видео приватное — скачать нельзя.'],
  [/members.?only|join this channel/i, 'Видео только для спонсоров канала.'],
  [/this live event|premieres in|is a live stream/i, 'Это трансляция или премьера — запись пока нельзя скачать.'],
  [/video unavailable|has been removed|no longer available|not available in your country|geo.?restrict/i, 'Видео недоступно: удалено или закрыто в вашей стране.'],
  [/unsupported url/i, 'Ссылка не поддерживается. Нужна ссылка на видео, плейлист или аудиофайл.'],
  [/http error 404/i, 'По ссылке ничего нет (ошибка 404).'],
  [/http error 403/i, 'Сайт не дал скачать файл (ошибка 403). Попробуйте позже или обновите инструменты.'],
  [/http error 429|too many requests/i, 'Сайт просит подождать: слишком много запросов. Попробуйте через 10–15 минут.'],
  [/max-filesize/i, 'Файл по ссылке больше 500 МБ.'],
  [/ffmpeg.*not found|ffprobe and ffmpeg/i, 'Не найден ffmpeg — нажмите «Обновить инструменты».'],
  [/requested format is not available|no video formats found|only images are available/i, 'Не нашлось аудио для скачивания. Обновите инструменты и попробуйте снова.'],
  [/n challenge|signature (?:extraction|solving)|js runtime|javascript runtime/i, 'yt-dlp не справился с защитой YouTube. Нажмите «Обновить инструменты» и попробуйте снова.'],
  [/getaddrinfo|failed to resolve|unable to connect|timed out|network is unreachable/i, 'Нет связи с сайтом. Проверьте интернет.'],
];

/** Readable message for a failed yt-dlp run. */
export function friendlyError(stderr: string): string {
  const rule = ERROR_RULES.find(([pattern]) => pattern.test(stderr));
  if (rule) return rule[1];
  const last = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? '';
  const detail = last.replace(/^ERROR:\s*/i, '').slice(0, 300);
  return detail ? `Не удалось скачать: ${detail}` : 'Не удалось скачать по ссылке.';
}
