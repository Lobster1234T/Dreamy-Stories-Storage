import type { ContentItem, LocaleDoc, Section } from './types.ts';
import { SECTIONS } from './types.ts';
import { stripNumber } from './titles.ts';
import {
  asIsoDate,
  asPositiveInt,
  asString,
  asStringArray,
  isRecord,
  pickUnknown,
  stripBom,
} from './guards.ts';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export type UidFactory = () => string;

const UID_PREFIX = Math.random().toString(36).slice(2, 7);
let uidCounter = 0;

export const createUid: UidFactory = () => {
  uidCounter += 1;
  return `${UID_PREFIX}${uidCounter.toString(36)}`;
};

const ITEM_KEYS: ReadonlySet<string> = new Set([
  'name', 'type', 'description', 'audioPath', 'imagePath', 'index', 'id',
  'categories', 'addedAt', 'duration', 'section', 'position',
]);
const TOP_KEYS: ReadonlySet<string> = new Set(['stories', 'lullabies', 'hidden', 'categories']);

export interface ParseOptions {
  readonly autoNumber: boolean;
  readonly makeUid?: UidFactory;
}

interface HiddenEntry {
  readonly section: Section;
  readonly position: number;
  readonly item: ContentItem;
}

export function parseLocaleDoc(code: string, text: string, options: ParseOptions): LocaleDoc {
  const label = `${code}.json`;
  const root = parseJsonObject(text, label);
  const makeUid = options.makeUid ?? createUid;
  const read = (section: Section): ContentItem[] =>
    readItems(root[section], `${label} → ${section}`, options.autoNumber, makeUid);
  const visible: Record<Section, ContentItem[]> = { stories: read('stories'), lullabies: read('lullabies') };
  const merged = insertHidden(visible, readHidden(root.hidden, label, options.autoNumber, makeUid));
  return {
    code,
    stories: merged.stories,
    lullabies: merged.lullabies,
    extraTop: pickUnknown(root, TOP_KEYS),
  };
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(stripBom(text));
  } catch (error) {
    throw new ParseError(`${label}: файл не является корректным JSON (${(error as Error).message})`);
  }
  if (!isRecord(value)) throw new ParseError(`${label}: ожидался объект вида { "stories": [...] }`);
  return value;
}

function readItems(value: unknown, label: string, autoNumber: boolean, makeUid: UidFactory): ContentItem[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ParseError(`${label}: ожидался массив`);
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new ParseError(`${label}[${index}]: элемент не является объектом`);
    return parseItem(raw, { autoNumber, makeUid, hidden: false });
  });
}

export function parseItem(
  raw: Record<string, unknown>,
  options: { autoNumber: boolean; makeUid: UidFactory; hidden: boolean },
): ContentItem {
  const name = asString(raw.name);
  return {
    uid: options.makeUid(),
    id: asString(raw.id).trim(),
    title: options.autoNumber ? stripNumber(name) : name.trim(),
    description: asString(raw.description),
    audioPath: asString(raw.audioPath).trim(),
    imagePath: asString(raw.imagePath).trim(),
    categories: asStringArray(raw.categories),
    addedAt: asIsoDate(raw.addedAt),
    duration: asPositiveInt(raw.duration),
    hidden: options.hidden,
    extra: pickUnknown(raw, ITEM_KEYS),
  };
}

function readHidden(value: unknown, label: string, autoNumber: boolean, makeUid: UidFactory): HiddenEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ParseError(`${label} → hidden: ожидался массив`);
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new ParseError(`${label} → hidden[${index}]: элемент не является объектом`);
    const section: Section = raw.section === 'lullabies' || raw.type === 'lullaby' ? 'lullabies' : 'stories';
    const position = typeof raw.position === 'number' && Number.isFinite(raw.position) && raw.position >= 0
      ? Math.floor(raw.position)
      : Number.MAX_SAFE_INTEGER;
    return { section, position, item: parseItem(raw, { autoNumber, makeUid, hidden: true }) };
  });
}

/**
 * `position` is the index in the full list (visible + hidden) at save time.
 * Inserting in ascending order restores the original full list exactly.
 */
function insertHidden(
  visible: Record<Section, ContentItem[]>,
  hidden: readonly HiddenEntry[],
): Record<Section, ContentItem[]> {
  const ordered = [...hidden].sort((a, b) => a.position - b.position);
  return ordered.reduce<Record<Section, ContentItem[]>>((acc, entry) => {
    const list = acc[entry.section];
    const at = Math.min(entry.position, list.length);
    return { ...acc, [entry.section]: [...list.slice(0, at), entry.item, ...list.slice(at)] };
  }, visible);
}

export function emptyDoc(code: string): LocaleDoc {
  return { code, stories: [], lullabies: [], extraTop: {} };
}

export { SECTIONS };
