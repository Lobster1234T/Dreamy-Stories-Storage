import type { ContentConfig, Section } from './types.ts';

export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['mp3', 'm4a', 'aac', 'ogg', 'wav']);
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

/** GitHub rejects files above 100 MB; base64 upload adds ~33 %. */
export const GITHUB_FILE_LIMIT_BYTES = 95 * 1024 * 1024;

export function extensionOf(path: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(path);
  return match ? match[1].toLowerCase() : '';
}

export function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(index + 1) : path;
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index) : '';
}

export function isAudioPath(path: string): boolean {
  return AUDIO_EXTENSIONS.has(extensionOf(path));
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path));
}

function fillTemplate(template: string, locale: string): string {
  return template.replaceAll('{locale}', locale).replace(/^\/+|\/+$/g, '');
}

export function audioDir(config: ContentConfig, section: Section, locale: string): string {
  const { paths } = config.settings;
  return fillTemplate(section === 'stories' ? paths.storyAudioDir : paths.lullabyAudioDir, locale);
}

export function imageDir(config: ContentConfig, section: Section): string {
  const { paths } = config.settings;
  return fillTemplate(section === 'stories' ? paths.storyImageDir : paths.lullabyImageDir, '');
}

/** Folders that hold media, used to find files nobody references. */
export function mediaRoots(config: ContentConfig): string[] {
  const { paths } = config.settings;
  const roots = [paths.storyAudioDir, paths.lullabyAudioDir, paths.storyImageDir, paths.lullabyImageDir]
    .map((template) => template.split('{locale}')[0].replace(/\/+$/g, ''))
    .filter(Boolean);
  return [...new Set(roots)];
}

export function isUnderRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path.startsWith(`${root}/`));
}

/** New uploads get ASCII names with a content hash, so caches never serve a stale file. */
export function buildMediaPath(dir: string, id: string, hash: string, ext: string): string {
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `${dir}/${id}-${hash}.${safeExt}`;
}

const SAFE_SEGMENT = /^[^\u0000-\u001f\\:*?"<>|]+$/;
const MAX_SEGMENT = 255;
/** The only file the panel may write inside its own folder. */
const PANEL_CONFIG_PATH = 'admin/config.json';

/**
 * Guards every path the panel writes or deletes: no traversal, no git or
 * CI folders, and nothing inside the panel's own code (pushing to admin/
 * redeploys the site) except its config file.
 */
export function isSafeRepoPath(path: string): boolean {
  if (!path || path.length > 400 || path.startsWith('/') || path.endsWith('/')) return false;
  const segments = path.split('/');
  const badSegment = (segment: string): boolean =>
    !segment || segment === '.' || segment === '..' || segment.length > MAX_SEGMENT || !SAFE_SEGMENT.test(segment);
  if (segments.some(badSegment)) return false;
  const first = segments[0].toLowerCase();
  if (first === '.git' || first === '.github') return false;
  return first !== 'admin' || path === PANEL_CONFIG_PATH;
}

export function isAsciiSafePath(path: string): boolean {
  return /^[A-Za-z0-9._\-/]+$/.test(path);
}

export function encodePathForUrl(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
