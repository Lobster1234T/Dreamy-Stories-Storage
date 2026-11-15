import type { ContentItem, Docs, ItemLocation, LocaleDoc, Section } from './types.ts';
import { SECTIONS } from './types.ts';

export type ItemPatch = Partial<Omit<ContentItem, 'uid'>>;

export function findItem(doc: LocaleDoc, uid: string): ItemLocation | null {
  for (const section of SECTIONS) {
    const index = doc[section].findIndex((item) => item.uid === uid);
    if (index >= 0) return { section, index, item: doc[section][index] };
  }
  return null;
}

export function withSection(doc: LocaleDoc, section: Section, items: readonly ContentItem[]): LocaleDoc {
  return doc[section] === items ? doc : { ...doc, [section]: items };
}

/** Maps every item; returns the same doc object when nothing changed. */
export function mapItems(doc: LocaleDoc, fn: (item: ContentItem, section: Section) => ContentItem): LocaleDoc {
  return SECTIONS.reduce((acc, section) => {
    const items = acc[section];
    const mapped = items.map((item) => fn(item, section));
    const changed = mapped.some((item, index) => item !== items[index]);
    return changed ? withSection(acc, section, mapped) : acc;
  }, doc);
}

export function mapDocs(docs: Docs, fn: (doc: LocaleDoc) => LocaleDoc): Docs {
  const entries = Object.entries(docs).map(([code, doc]) => [code, fn(doc)] as const);
  const changed = entries.some(([code, doc]) => doc !== docs[code]);
  return changed ? Object.fromEntries(entries) : docs;
}

export function updateDoc(docs: Docs, code: string, fn: (doc: LocaleDoc) => LocaleDoc): Docs {
  const doc = docs[code];
  if (!doc) return docs;
  const next = fn(doc);
  return next === doc ? docs : { ...docs, [code]: next };
}

export function updateItem(doc: LocaleDoc, uid: string, patch: ItemPatch): LocaleDoc {
  return mapItems(doc, (item) => (item.uid === uid ? { ...item, ...patch } : item));
}

export function insertItem(doc: LocaleDoc, section: Section, item: ContentItem, position?: number): LocaleDoc {
  const items = doc[section];
  const at = position === undefined ? items.length : Math.max(0, Math.min(position, items.length));
  return withSection(doc, section, [...items.slice(0, at), item, ...items.slice(at)]);
}

export function removeItems(doc: LocaleDoc, uids: ReadonlySet<string>): LocaleDoc {
  return SECTIONS.reduce((acc, section) => {
    const items = acc[section];
    const kept = items.filter((item) => !uids.has(item.uid));
    return kept.length === items.length ? acc : withSection(acc, section, kept);
  }, doc);
}

export function moveItem(doc: LocaleDoc, section: Section, from: number, to: number): LocaleDoc {
  const items = doc[section];
  if (from === to || from < 0 || from >= items.length) return doc;
  const target = Math.max(0, Math.min(to, items.length - 1));
  const without = [...items.slice(0, from), ...items.slice(from + 1)];
  return withSection(doc, section, [...without.slice(0, target), items[from], ...without.slice(target)]);
}

/** Moves items to the top or bottom of their section, keeping their relative order. */
export function moveToEdge(doc: LocaleDoc, section: Section, uids: ReadonlySet<string>, edge: 'top' | 'bottom'): LocaleDoc {
  const items = doc[section];
  const picked = items.filter((item) => uids.has(item.uid));
  if (picked.length === 0) return doc;
  const rest = items.filter((item) => !uids.has(item.uid));
  return withSection(doc, section, edge === 'top' ? [...picked, ...rest] : [...rest, ...picked]);
}

export function moveToSection(doc: LocaleDoc, uid: string, target: Section, position?: number): LocaleDoc {
  const location = findItem(doc, uid);
  if (!location || location.section === target) return doc;
  return insertItem(removeItems(doc, new Set([uid])), target, location.item, position);
}

export function setHidden(doc: LocaleDoc, uids: ReadonlySet<string>, hidden: boolean): LocaleDoc {
  return mapItems(doc, (item) => (uids.has(item.uid) && item.hidden !== hidden ? { ...item, hidden } : item));
}

export interface LocatedItem {
  readonly locale: string;
  readonly section: Section;
  readonly index: number;
  readonly item: ContentItem;
}

/** The same story (by id) in every geo. */
export function findById(docs: Docs, section: Section, id: string): LocatedItem[] {
  if (!id) return [];
  return Object.entries(docs).flatMap(([locale, doc]) => {
    const index = doc[section].findIndex((item) => item.id === id);
    return index >= 0 ? [{ locale, section, index, item: doc[section][index] }] : [];
  });
}

/** Applies `patch` to the items with the same id in the other geos. */
export function syncById(docs: Docs, section: Section, id: string, patch: ItemPatch, exceptLocale: string): Docs {
  if (!id || Object.keys(patch).length === 0) return docs;
  return mapDocs(docs, (doc) =>
    doc.code === exceptLocale
      ? doc
      : mapItems(doc, (item, itemSection) => (itemSection === section && item.id === id ? { ...item, ...patch } : item)),
  );
}

export function replacePath(docs: Docs, from: string, to: string): Docs {
  return mapDocs(docs, (doc) =>
    mapItems(doc, (item) => {
      const audioPath = item.audioPath === from ? to : item.audioPath;
      const imagePath = item.imagePath === from ? to : item.imagePath;
      return audioPath === item.audioPath && imagePath === item.imagePath ? item : { ...item, audioPath, imagePath };
    }),
  );
}

export function removeCategoryEverywhere(docs: Docs, categoryId: string): Docs {
  return mapDocs(docs, (doc) =>
    mapItems(doc, (item) =>
      item.categories.includes(categoryId) ? { ...item, categories: item.categories.filter((c) => c !== categoryId) } : item,
    ),
  );
}

export function renameCategoryEverywhere(docs: Docs, from: string, to: string): Docs {
  return mapDocs(docs, (doc) =>
    mapItems(doc, (item) =>
      item.categories.includes(from)
        ? { ...item, categories: [...new Set(item.categories.map((c) => (c === from ? to : c)))] }
        : item,
    ),
  );
}

/** Every media path referenced by any item in any geo (hidden ones too). */
export function referencedPaths(docs: Docs): Set<string> {
  const paths = new Set<string>();
  for (const doc of Object.values(docs)) {
    for (const section of SECTIONS) {
      for (const item of doc[section]) {
        if (item.audioPath) paths.add(item.audioPath);
        if (item.imagePath) paths.add(item.imagePath);
      }
    }
  }
  return paths;
}

export function countItems(doc: LocaleDoc, section: Section): { total: number; visible: number } {
  const total = doc[section].length;
  return { total, visible: doc[section].filter((item) => !item.hidden).length };
}

/** Position the app will show for each uid (hidden items get null). */
export function visiblePositions(items: readonly ContentItem[]): Map<string, number | null> {
  let position = 0;
  return new Map(items.map((item) => [item.uid, item.hidden ? null : position++]));
}
