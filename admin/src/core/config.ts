import type {
  Category,
  ContentConfig,
  ContentSettings,
  CustomField,
  CustomFieldType,
  LocaleDef,
  MediaSettings,
  PathSettings,
} from './types.ts';
import { asBoolean, asNumberInRange, asString, isRecord, stripBom } from './guards.ts';
import { isValidId } from './slug.ts';

export const CONFIG_PATH = 'admin/config.json';

const LOCALE_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const ROOT_LOCALE_FILE = /^([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)\.json$/;

export const KNOWN_LOCALE_LABELS: Readonly<Record<string, string>> = {
  ru: 'Русский', en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português', 'pt-BR': 'Português (Brasil)', 'es-419': 'Español (LatAm)', pl: 'Polski',
  tr: 'Türkçe', uk: 'Українська', nl: 'Nederlands', sv: 'Svenska', ja: '日本語', ko: '한국어',
  zh: '中文', ar: 'العربية', hi: 'हिन्दी', id: 'Bahasa Indonesia', vi: 'Tiếng Việt', cs: 'Čeština',
  ro: 'Română', hu: 'Magyar', el: 'Ελληνικά', he: 'עברית', th: 'ไทย', kk: 'Қазақ',
};

/** Item keys the panel manages itself; custom fields may not reuse them. */
export const RESERVED_ITEM_KEYS: ReadonlySet<string> = new Set([
  'name', 'type', 'description', 'audioPath', 'imagePath', 'index', 'id', 'categories',
  'addedAt', 'duration', 'section', 'position', 'hidden',
]);

const CUSTOM_FIELD_TYPES: ReadonlySet<string> = new Set<CustomFieldType>([
  'text', 'textarea', 'number', 'boolean', 'select', 'date', 'url',
]);
const CUSTOM_FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

export const DEFAULT_MEDIA: MediaSettings = {
  maxImageSize: 512,
  squareImages: true,
  imageQuality: 0.86,
  audioWarnMB: 40,
};

export const DEFAULT_PATHS: PathSettings = {
  storyAudioDir: 'stories/{locale}',
  lullabyAudioDir: 'lullabies',
  storyImageDir: 'images',
  lullabyImageDir: 'lullaby_images',
};

export function isLocaleCode(value: string): boolean {
  return LOCALE_CODE.test(value);
}

export function localeLabel(code: string): string {
  return KNOWN_LOCALE_LABELS[code] ?? code.toUpperCase();
}

/** Geo files are `<code>.json` in the repository root. */
export function detectLocales(paths: Iterable<string>): string[] {
  const codes: string[] = [];
  for (const path of paths) {
    const match = ROOT_LOCALE_FILE.exec(path);
    if (match) codes.push(match[1]);
  }
  return codes.sort();
}

export function defaultSettings(locales: readonly LocaleDef[]): ContentSettings {
  const codes = locales.map((locale) => locale.code);
  const referenceLocale = codes.includes('en') ? 'en' : (codes[0] ?? 'en');
  return { autoNumberTitles: true, referenceLocale, media: DEFAULT_MEDIA, paths: DEFAULT_PATHS };
}

export function defaultConfig(localeCodes: readonly string[]): ContentConfig {
  const locales = localeCodes.map((code) => ({ code, label: localeLabel(code) }));
  return { version: 1, locales, categories: [], customFields: [], settings: defaultSettings(locales) };
}

export function parseConfig(text: string | null, detected: readonly string[]): ContentConfig {
  if (text === null) return defaultConfig(detected);
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch {
    return defaultConfig(detected);
  }
  return normalizeConfig(raw, detected);
}

export function normalizeConfig(raw: unknown, detected: readonly string[]): ContentConfig {
  if (!isRecord(raw)) return defaultConfig(detected);
  const locales = mergeLocales(readLocales(raw.locales), detected);
  return {
    version: 1,
    locales,
    categories: readCategories(raw.categories),
    customFields: readCustomFields(raw.customFields),
    settings: readSettings(raw.settings, locales),
  };
}

export function serializeConfig(config: ContentConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function readLocales(value: unknown): LocaleDef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const code = isRecord(entry) ? asString(entry.code).trim() : '';
    if (!isLocaleCode(code) || seen.has(code)) return [];
    seen.add(code);
    const label = isRecord(entry) ? asString(entry.label).trim() : '';
    return [{ code, label: label || localeLabel(code) }];
  });
}

function mergeLocales(fromConfig: LocaleDef[], detected: readonly string[]): LocaleDef[] {
  const known = new Set(fromConfig.map((locale) => locale.code));
  const missing = detected.filter((code) => !known.has(code));
  return [...fromConfig, ...missing.map((code) => ({ code, label: localeLabel(code) }))];
}

function readCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = asString(entry.id).trim();
    if (!isValidId(id) || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      icon: asString(entry.icon).slice(0, 8),
      color: readColor(entry.color),
      names: readNames(entry.names),
    }];
  });
}

function readNames(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([code, name]) => isLocaleCode(code) && typeof name === 'string')
      .map(([code, name]) => [code, (name as string).trim()]),
  );
}

function readColor(value: unknown): string {
  const color = asString(value).trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#7c6cf2';
}

function readCustomFields(value: unknown): CustomField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const key = asString(entry.key).trim();
    const type = asString(entry.type);
    if (!isValidCustomFieldKey(key) || seen.has(key) || !CUSTOM_FIELD_TYPES.has(type)) return [];
    seen.add(key);
    return [{
      key,
      label: asString(entry.label).trim() || key,
      type: type as CustomFieldType,
      options: Array.isArray(entry.options) ? entry.options.map(asString).filter(Boolean) : [],
      shared: asBoolean(entry.shared, true),
      showInList: asBoolean(entry.showInList, false),
    }];
  });
}

export function isValidCustomFieldKey(key: string): boolean {
  // Names like "constructor" would read inherited members from plain objects.
  const inherited = key in Object.prototype;
  return CUSTOM_FIELD_KEY.test(key) && !RESERVED_ITEM_KEYS.has(key) && !inherited;
}

function readSettings(value: unknown, locales: readonly LocaleDef[]): ContentSettings {
  const defaults = defaultSettings(locales);
  if (!isRecord(value)) return defaults;
  const reference = asString(value.referenceLocale);
  return {
    autoNumberTitles: asBoolean(value.autoNumberTitles, defaults.autoNumberTitles),
    referenceLocale: locales.some((l) => l.code === reference) ? reference : defaults.referenceLocale,
    media: readMedia(value.media),
    paths: readPaths(value.paths),
  };
}

function readMedia(value: unknown): MediaSettings {
  if (!isRecord(value)) return DEFAULT_MEDIA;
  return {
    maxImageSize: Math.round(asNumberInRange(value.maxImageSize, 0, 4096, DEFAULT_MEDIA.maxImageSize)),
    squareImages: asBoolean(value.squareImages, DEFAULT_MEDIA.squareImages),
    imageQuality: asNumberInRange(value.imageQuality, 0.5, 1, DEFAULT_MEDIA.imageQuality),
    audioWarnMB: asNumberInRange(value.audioWarnMB, 1, 95, DEFAULT_MEDIA.audioWarnMB),
  };
}

const SAFE_DIR = /^[A-Za-z0-9_\-{}]+(?:\/[A-Za-z0-9_\-{}]+)*$/;

function readPaths(value: unknown): PathSettings {
  if (!isRecord(value)) return DEFAULT_PATHS;
  const pick = (key: keyof PathSettings): string => {
    const dir = asString(value[key]).trim().replace(/^\/+|\/+$/g, '');
    return SAFE_DIR.test(dir) && !dir.startsWith('.') ? dir : DEFAULT_PATHS[key];
  };
  return {
    storyAudioDir: pick('storyAudioDir'),
    lullabyAudioDir: pick('lullabyAudioDir'),
    storyImageDir: pick('storyImageDir'),
    lullabyImageDir: pick('lullabyImageDir'),
  };
}
