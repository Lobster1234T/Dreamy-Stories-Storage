import type { ContentConfig, MediaSettings, Section } from '../core/types.ts';
import { GITHUB_FILE_LIMIT_BYTES, audioDir, buildMediaPath, extensionOf, formatBytes, imageDir } from '../core/paths.ts';
import { shortHash } from '../github/encoding.ts';

export interface TargetSize {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly width: number;
  readonly height: number;
}

/** Crop (optional center square) and downscale geometry. maxSize 0 keeps the size. */
export function computeTargetSize(width: number, height: number, maxSize: number, square: boolean): TargetSize {
  const side = Math.min(width, height);
  const sw = square ? side : width;
  const sh = square ? side : height;
  const sx = square ? Math.floor((width - side) / 2) : 0;
  const sy = square ? Math.floor((height - side) / 2) : 0;
  const scale = maxSize > 0 ? Math.min(1, maxSize / Math.max(sw, sh)) : 1;
  return { sx, sy, sw, sh, width: Math.max(1, Math.round(sw * scale)), height: Math.max(1, Math.round(sh * scale)) };
}

const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/x-mp3', 'audio/mpeg3']);

export function validateAudioFile(file: File): string | null {
  const isMp3 = AUDIO_TYPES.has(file.type) || extensionOf(file.name) === 'mp3';
  if (!isMp3) return 'Нужен файл MP3 — приложение проигрывает именно этот формат.';
  if (file.size > GITHUB_FILE_LIMIT_BYTES) {
    return `Файл ${formatBytes(file.size)} — больше лимита GitHub (≈95 МБ через панель). Сожмите аудио, например до 96–128 кбит/с.`;
  }
  return null;
}

export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'Нужна картинка (JPG, PNG или WebP).';
  if (file.size > 30 * 1024 * 1024) return 'Картинка больше 30 МБ — выберите файл поменьше.';
  return null;
}

/** Reads the duration from the browser's audio decoder; null if unknown. */
export function readAudioDuration(blob: Blob, timeoutMs = 15_000): Promise<number | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  let url: string;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const finish = (value: number | null): void => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration) : null);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сжать картинку'))), 'image/jpeg', quality);
  });
}

/** Square-crops and downsizes covers so they match the existing 512×512 JPEGs. */
export async function processImage(file: Blob, settings: MediaSettings): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  const bitmap = await createImageBitmap(file);
  try {
    const target = computeTargetSize(bitmap.width, bitmap.height, settings.maxImageSize, settings.squareImages);
    const untouched = target.width === bitmap.width && target.height === bitmap.height && target.sx === 0 && target.sy === 0;
    if (untouched && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, target.sx, target.sy, target.sw, target.sh, 0, 0, target.width, target.height);
    return await canvasToBlob(canvas, settings.imageQuality);
  } finally {
    bitmap.close();
  }
}

export async function audioUploadPath(config: ContentConfig, section: Section, locale: string, id: string, file: Blob): Promise<string> {
  return buildMediaPath(audioDir(config, section, locale), id, await shortHash(file), 'mp3');
}

export async function imageUploadPath(config: ContentConfig, section: Section, id: string, file: Blob): Promise<string> {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  return buildMediaPath(imageDir(config, section), id, await shortHash(file), ext);
}
