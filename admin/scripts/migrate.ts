/**
 * One-time data migration for the existing geo files.
 *
 *   cd admin && node scripts/migrate.ts              # writes files
 *   cd admin && node scripts/migrate.ts --dry-run    # only prints the summary
 *   cd admin && node scripts/migrate.ts --from-head  # rebuild from the last commit, ignoring local edits
 *
 * Adds to every item (old fields stay untouched, `index` = position):
 *   id         — stable id shared by the same story in all geos (linked by cover)
 *   addedAt    — date the audio file first appeared in git history
 *   duration   — audio length in seconds, read from the local MP3
 *   categories — starter categories (editable in the panel)
 * Also creates admin/config.json (geos, categories, settings).
 * Re-running is safe: existing ids/dates/durations/categories are kept.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseFile } from 'music-metadata';
import type { Category, ContentConfig, ContentItem, Docs, LocaleDoc } from '../src/core/types.ts';
import { SECTIONS } from '../src/core/types.ts';
import { CONFIG_PATH, defaultConfig, detectLocales, localeLabel, parseConfig, serializeConfig } from '../src/core/config.ts';
import { parseLocaleDoc } from '../src/core/parse.ts';
import { localeFilePath, serializeLocaleDoc } from '../src/core/serialize.ts';
import { assignMissingIds } from '../src/core/ids.ts';
import { mapDocs, mapItems } from '../src/core/ops.ts';
import { slugify } from '../src/core/slug.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DRY_RUN = process.argv.includes('--dry-run');
const FROM_HEAD = process.argv.includes('--from-head');
const LOCALE_ORDER = ['ru', 'en', 'de', 'es', 'fr', 'it', 'pt'];
const log = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const CATEGORIES: Category[] = [
  { id: 'classic', icon: '📖', color: '#4263eb', names: { ru: 'Классика', en: 'Classics', de: 'Klassiker', es: 'Clásicos', fr: 'Classiques', it: 'Classici', pt: 'Clássicos' } },
  { id: 'princesses', icon: '👑', color: '#e64980', names: { ru: 'Принцессы', en: 'Princesses', de: 'Prinzessinnen', es: 'Princesas', fr: 'Princesses', it: 'Principesse', pt: 'Princesas' } },
  { id: 'animals', icon: '🐾', color: '#37b24d', names: { ru: 'Животные', en: 'Animals', de: 'Tiere', es: 'Animales', fr: 'Animaux', it: 'Animali', pt: 'Animais' } },
  { id: 'magic', icon: '✨', color: '#7c6cf2', names: { ru: 'Волшебство', en: 'Magic', de: 'Magie', es: 'Magia', fr: 'Magie', it: 'Magia', pt: 'Magia' } },
  { id: 'adventure', icon: '🧭', color: '#f76707', names: { ru: 'Приключения', en: 'Adventures', de: 'Abenteuer', es: 'Aventuras', fr: 'Aventures', it: 'Avventure', pt: 'Aventuras' } },
  { id: 'friendship', icon: '🤝', color: '#1098ad', names: { ru: 'Дружба и доброта', en: 'Friendship & Kindness', de: 'Freundschaft', es: 'Amistad', fr: 'Amitié', it: 'Amicizia', pt: 'Amizade' } },
  { id: 'holidays', icon: '🎄', color: '#f59f00', names: { ru: 'Праздники', en: 'Holidays', de: 'Feiertage', es: 'Fiestas', fr: 'Fêtes', it: 'Feste', pt: 'Festas' } },
];

/** Starter categories by cover number (the cover identifies the story in every geo). */
const CATEGORY_BY_COVER: Record<number, string[]> = {
  1: ['classic', 'princesses', 'magic'], 2: ['classic', 'princesses'], 3: ['classic', 'magic'], 4: ['classic', 'animals'],
  5: ['classic'], 6: ['classic', 'adventure', 'magic'], 7: ['animals', 'friendship'], 8: ['classic', 'magic'],
  9: ['classic', 'animals'], 10: ['animals', 'princesses'], 11: ['classic', 'princesses', 'magic'], 12: ['animals', 'friendship'],
  13: ['classic', 'adventure', 'magic'], 14: ['princesses', 'magic', 'adventure'], 15: ['magic', 'adventure'], 16: ['classic', 'princesses'],
  17: ['classic', 'magic'], 18: ['classic', 'magic'], 19: ['princesses', 'magic'], 20: ['animals', 'friendship'],
  21: ['magic', 'adventure'], 22: ['magic', 'friendship'], 23: ['animals', 'friendship'], 24: ['adventure'],
  25: ['animals', 'holidays'], 26: ['animals', 'adventure'], 27: ['animals', 'princesses', 'magic'], 28: ['classic', 'princesses'],
  29: ['classic', 'princesses', 'magic'], 30: ['classic', 'magic'], 31: ['holidays'], 32: ['friendship'],
  33: ['princesses', 'magic'], 34: ['holidays', 'friendship'], 35: ['adventure'], 36: ['adventure', 'magic'],
  37: ['holidays', 'magic'], 38: ['animals', 'friendship'], 39: ['animals', 'friendship'], 40: ['adventure'],
  41: ['adventure', 'magic'], 42: ['classic', 'magic'], 43: ['classic'], 44: ['classic', 'magic'],
  45: ['princesses'], 46: ['classic', 'animals', 'friendship'], 47: ['princesses', 'magic'], 48: ['classic', 'adventure'],
  49: ['classic', 'magic'], 50: ['classic', 'adventure'], 51: ['classic', 'animals', 'adventure'], 52: ['animals', 'friendship'],
};

/** Readable ids where the English title is noisy. */
const ID_BY_COVER: Record<number, string> = {
  11: 'beauty-and-the-beast',
  33: 'beauty-and-the-beast-and-the-magic-library',
  45: 'cinderella-and-the-princess-yoga',
  46: 'the-lion-and-the-mouse',
  50: 'ali-baba-and-the-forty-thieves',
};

/** In RU the cover of "The Princess and the Pea" carries "Alice in Wonderland". */
const SPECIAL_IDS: Array<{ locale: string; imagePath: string; titleIncludes: string; id: string; categories: string[] }> = [
  { locale: 'ru', imagePath: 'images/image_2.jpg', titleIncludes: 'Алиса', id: 'alice-in-wonderland', categories: ['classic', 'adventure', 'magic'] },
];

const coverNumber = (path: string): number | null => {
  const match = /images\/image_(\d+)\.jpg$/.exec(path);
  return match ? Number(match[1]) : null;
};

/** Working copy, or the last commit with --from-head. null when the file does not exist. */
function readSource(path: string): string | null {
  if (FROM_HEAD) {
    try {
      return execFileSync('git', ['show', `HEAD:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  }
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

function loadDocs(config: ContentConfig): Docs {
  return Object.fromEntries(config.locales.flatMap(({ code }) => {
    const text = readSource(localeFilePath(code));
    return text === null ? [] : [[code, parseLocaleDoc(code, text, { autoNumber: config.settings.autoNumberTitles })]];
  }));
}

/** cover number → id, from the reference geo's titles (with readable overrides). */
function idsByCover(docs: Docs, reference: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const item of docs[reference]?.stories ?? []) {
    const cover = coverNumber(item.imagePath);
    if (cover && !map.has(cover)) map.set(cover, ID_BY_COVER[cover] ?? slugify(item.title));
  }
  return map;
}

/**
 * Stories get their id from the cover explicitly, so a geo that reuses a
 * cover for a different story (RU "Alice") cannot leak its id to others.
 */
function presetIds(docs: Docs, reference: string): Docs {
  const byCover = idsByCover(docs, reference);
  return mapDocs(docs, (doc) => {
    const used = new Set(doc.stories.map((item) => item.id).filter(Boolean));
    return mapItems(doc, (item, section) => {
      if (item.id || section !== 'stories') return item;
      const special = SPECIAL_IDS.find((s) => s.locale === doc.code && s.imagePath === item.imagePath && item.title.includes(s.titleIncludes));
      const cover = coverNumber(item.imagePath);
      const id = special?.id ?? (cover ? byCover.get(cover) : undefined);
      if (!id || used.has(id)) return item;
      used.add(id);
      return { ...item, id };
    });
  });
}

/** path → first date (YYYY-MM-DD) the file was added, from git history. */
function gitAddDates(): Map<string, string> {
  const output = execFileSync('git', ['-c', 'core.quotePath=false', 'log', '--diff-filter=A', '--no-renames', '--name-only', '--format=@@%as'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const dates = new Map<string, string>();
  let current = '';
  for (const line of output.split('\n')) {
    if (line.startsWith('@@')) current = line.slice(2).trim();
    else if (line.trim()) dates.set(line.trim(), current);
  }
  return dates;
}

async function readDuration(path: string): Promise<number | null> {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  try {
    const quick = await parseFile(full, { duration: false, skipCovers: true });
    if (quick.format.duration) return Math.round(quick.format.duration);
    const scanned = await parseFile(full, { duration: true, skipCovers: true }).catch(() => null);
    if (scanned?.format.duration) return Math.round(scanned.format.duration);
    // Some files are not real MP3 (e.g. AAC with .mp3 extension): estimate from size and bitrate.
    const bitrate = quick.format.bitrate;
    return bitrate ? Math.round((statSync(full).size * 8) / bitrate) : null;
  } catch {
    return null;
  }
}

async function durationsFor(docs: Docs): Promise<Map<string, number>> {
  const paths = [...new Set(Object.values(docs).flatMap((doc) => SECTIONS.flatMap((s) => doc[s].map((i) => i.audioPath))).filter(Boolean))];
  const result = new Map<string, number>();
  const queue = [...paths];
  const worker = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const seconds = await readDuration(path);
      if (seconds) result.set(path, seconds);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return result;
}

function enrich(docs: Docs, dates: Map<string, string>, durations: Map<string, number>, jsonDates: Map<string, string>): Docs {
  const categoriesById = new Map<string, string[]>();
  for (const doc of Object.values(docs)) {
    for (const item of doc.stories) {
      const special = SPECIAL_IDS.find((s) => s.id === item.id);
      const cover = coverNumber(item.imagePath);
      const categories = special?.categories ?? (cover ? CATEGORY_BY_COVER[cover] : undefined);
      if (categories && !categoriesById.has(item.id)) categoriesById.set(item.id, categories);
    }
  }
  return mapDocs(docs, (doc) => mapItems(doc, (item: ContentItem) => ({
    ...item,
    addedAt: item.addedAt ?? dates.get(item.audioPath) ?? jsonDates.get(doc.code) ?? null,
    duration: item.duration ?? durations.get(item.audioPath) ?? null,
    categories: item.categories.length > 0 ? item.categories : categoriesById.get(item.id) ?? [],
  })));
}

function buildConfig(existing: string | null, detected: string[]): ContentConfig {
  const base = existing ? parseConfig(existing, detected) : defaultConfig(detected);
  const ordered = [...LOCALE_ORDER.filter((c) => detected.includes(c)), ...detected.filter((c) => !LOCALE_ORDER.includes(c))];
  const locales = existing ? base.locales : ordered.map((code) => ({ code, label: localeLabel(code) }));
  return {
    ...base,
    locales,
    categories: base.categories.length > 0 ? base.categories : CATEGORIES,
    settings: { ...base.settings, referenceLocale: locales.some((l) => l.code === 'en') ? 'en' : base.settings.referenceLocale },
  };
}

function summary(doc: LocaleDoc): string {
  const items = [...doc.stories, ...doc.lullabies];
  const count = (test: (item: ContentItem) => boolean): number => items.filter(test).length;
  return `${doc.code}: ${doc.stories.length} сказок, ${doc.lullabies.length} колыбельных · id ${count((i) => Boolean(i.id))}/${items.length}` +
    ` · дата ${count((i) => Boolean(i.addedAt))}/${items.length} · длительность ${count((i) => i.duration !== null)}/${items.length}` +
    ` · категории ${count((i) => i.categories.length > 0)}/${items.length}`;
}

async function main(): Promise<void> {
  const detected = detectLocales(readdirSync(ROOT));
  const configPath = join(ROOT, CONFIG_PATH);
  const config = buildConfig(readSource(CONFIG_PATH), detected);
  log(`Гео: ${config.locales.map((l) => l.code).join(', ')} (базовое: ${config.settings.referenceLocale})${FROM_HEAD ? ' · из последнего коммита' : ''}`);
  const parsed = presetIds(loadDocs(config), config.settings.referenceLocale);
  const withIds = assignMissingIds(parsed, [config.settings.referenceLocale, ...config.locales.map((l) => l.code)]);
  const dates = gitAddDates();
  const jsonDates = new Map(config.locales.map(({ code }) => [code, dates.get(localeFilePath(code)) ?? '']).filter(([, d]) => d) as Array<[string, string]>);
  log('Читаю длительность MP3…');
  const durations = await durationsFor(withIds);
  const docs = enrich(withIds, dates, durations, jsonDates);
  const loaded = config.locales.map(({ code }) => code).filter((code) => docs[code]);
  for (const code of loaded) log(`  ${summary(docs[code])}`);
  if (DRY_RUN) {
    log('Пробный запуск: файлы не изменены.');
    return;
  }
  for (const code of loaded) writeFileSync(join(ROOT, localeFilePath(code)), serializeLocaleDoc(docs[code], config));
  writeFileSync(configPath, serializeConfig(config));
  log(`Готово: обновлены ${config.locales.length} файлов гео и ${CONFIG_PATH}.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Миграция не удалась: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
