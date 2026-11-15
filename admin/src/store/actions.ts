import type {
  Category,
  ContentConfig,
  ContentItem,
  ContentSettings,
  CustomField,
  Docs,
  LocaleDoc,
  Section,
  WorkState,
} from '../core/types.ts';
import { SECTIONS } from '../core/types.ts';
import {
  findItem,
  insertItem,
  mapDocs,
  mapItems,
  moveItem,
  moveToEdge,
  moveToSection,
  referencedPaths,
  removeCategoryEverywhere,
  removeItems,
  renameCategoryEverywhere,
  setHidden,
  updateDoc,
  updateItem,
} from '../core/ops.ts';
import { createUid, emptyDoc } from '../core/parse.ts';
import { localeFilePath } from '../core/serialize.ts';
import { numberedName, stripNumber } from '../core/titles.ts';
import { todayIso } from '../core/guards.ts';
import { applyFix, markForDeletion, unmarkDeletion } from '../core/fixes.ts';
import type { Fix, Issue } from '../core/health.ts';
import { applyWork } from './appStore.ts';

export interface ItemDraft {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly audioPath: string;
  readonly imagePath: string;
  readonly categories: readonly string[];
  readonly addedAt: string | null;
  readonly duration: number | null;
  readonly hidden: boolean;
  readonly section: Section;
  readonly extra: Readonly<Record<string, unknown>>;
}

/** Which values of the edited item are copied to the same story in other geos. */
export interface SyncFields {
  readonly imagePath: boolean;
  readonly categories: boolean;
  readonly audioPath: boolean;
  readonly customKeys: readonly string[];
  /** Rename the id in other geos too when it changed. */
  readonly renameId: boolean;
}

export const NO_SYNC: SyncFields = { imagePath: false, categories: false, audioPath: false, customKeys: [], renameId: false };

export interface SaveItemInput {
  readonly locale: string;
  /** null creates a new item. */
  readonly uid: string | null;
  readonly draft: ItemDraft;
  readonly position?: number;
  readonly previousId?: string;
  readonly sync?: SyncFields;
}

function draftToItem(uid: string, draft: ItemDraft): ContentItem {
  return {
    uid,
    id: draft.id.trim(),
    title: draft.title.trim(),
    description: draft.description.trim(),
    audioPath: draft.audioPath.trim(),
    imagePath: draft.imagePath.trim(),
    categories: [...draft.categories],
    addedAt: draft.addedAt,
    duration: draft.duration,
    hidden: draft.hidden,
    extra: { ...draft.extra },
  };
}

export function itemToDraft(item: ContentItem, section: Section): ItemDraft {
  return { ...item, section };
}

/** Saves (or creates) an item and returns its uid. */
export function saveItem(input: SaveItemInput): string {
  const uid = input.uid ?? createUid();
  const item = draftToItem(uid, input.draft);
  applyWork((work) => {
    const doc = work.docs[input.locale];
    if (!doc) return work;
    // Other geos still hold the story in the section it had before this edit.
    const originalSection = input.uid ? findItem(doc, input.uid)?.section ?? input.draft.section : input.draft.section;
    const nextDoc = input.uid ? updateExisting(doc, item, input.draft.section) : insertItem(doc, input.draft.section, item, input.position);
    if (nextDoc === null) return work;
    const docs = { ...work.docs, [input.locale]: nextDoc };
    return { ...work, docs: syncOtherGeos(docs, input, item, originalSection) };
  });
  return uid;
}

function updateExisting(doc: LocaleDoc, item: ContentItem, section: Section): LocaleDoc | null {
  const location = findItem(doc, item.uid);
  if (!location) return null;
  const { uid: _uid, ...patch } = item;
  const updated = updateItem(doc, item.uid, patch);
  return location.section === section ? updated : moveToSection(updated, item.uid, section);
}

function syncOtherGeos(docs: Docs, input: SaveItemInput, item: ContentItem, section: Section): Docs {
  const sync = input.sync ?? NO_SYNC;
  const matchId = input.previousId || item.id;
  if (!matchId) return docs;
  const patch = (target: ContentItem): ContentItem => ({
    ...target,
    ...(sync.renameId && input.previousId && input.previousId !== item.id ? { id: item.id } : {}),
    ...(sync.imagePath ? { imagePath: item.imagePath } : {}),
    ...(sync.categories ? { categories: [...item.categories] } : {}),
    ...(sync.audioPath ? { audioPath: item.audioPath, duration: item.duration } : {}),
    ...(sync.customKeys.length > 0
      ? { extra: { ...target.extra, ...Object.fromEntries(sync.customKeys.map((key) => [key, item.extra[key]])) } }
      : {}),
  });
  return mapDocs(docs, (doc) =>
    doc.code === input.locale
      ? doc
      : mapItems(doc, (target, targetSection) => (targetSection === section && target.id === matchId ? patch(target) : target)),
  );
}

export function deleteItems(locale: string, uids: readonly string[], deleteFiles: boolean): void {
  applyWork((work) => {
    const doc = work.docs[locale];
    if (!doc) return work;
    const removed = uids.map((uid) => findItem(doc, uid)?.item).filter((item): item is ContentItem => Boolean(item));
    const docs = { ...work.docs, [locale]: removeItems(doc, new Set(uids)) };
    const next = { ...work, docs };
    if (!deleteFiles) return next;
    const stillUsed = referencedPaths(docs);
    const orphaned = removed.flatMap((item) => [item.audioPath, item.imagePath]).filter((path) => path && !stillUsed.has(path));
    return markForDeletion(next, [...new Set(orphaned)]);
  });
}

export function reorderItem(locale: string, section: Section, from: number, to: number): void {
  applyWork((work) => ({ ...work, docs: updateDoc(work.docs, locale, (doc) => moveItem(doc, section, from, to)) }));
}

export function moveItemsToEdge(locale: string, section: Section, uids: readonly string[], edge: 'top' | 'bottom'): void {
  applyWork((work) => ({ ...work, docs: updateDoc(work.docs, locale, (doc) => moveToEdge(doc, section, new Set(uids), edge)) }));
}

export function setItemsHidden(locale: string, uids: readonly string[], hidden: boolean): void {
  applyWork((work) => ({ ...work, docs: updateDoc(work.docs, locale, (doc) => setHidden(doc, new Set(uids), hidden)) }));
}

export function changeCategories(locale: string, uids: readonly string[], add: readonly string[], remove: readonly string[]): void {
  const targets = new Set(uids);
  applyWork((work) => ({
    ...work,
    docs: updateDoc(work.docs, locale, (doc) =>
      mapItems(doc, (item) => {
        if (!targets.has(item.uid)) return item;
        const next = [...new Set([...item.categories.filter((c) => !remove.includes(c)), ...add])];
        return next.length === item.categories.length && next.every((c, i) => c === item.categories[i]) ? item : { ...item, categories: next };
      }),
    ),
  }));
}

/* ---------- bulk audio import ---------- */

export interface ImportEntry {
  /** replace: new audio for an existing item; new: create an item. */
  readonly mode: 'replace' | 'new';
  readonly targetUid: string | null;
  /** Same story in the reference geo: gives cover and categories. */
  readonly ref: ContentItem | null;
  readonly id: string;
  readonly title: string;
  readonly audioPath: string;
  readonly duration: number | null;
}

/** Applies a whole bulk upload as one undo step. */
export function applyImport(locale: string, section: Section, entries: readonly ImportEntry[]): void {
  applyWork((work) => {
    const doc = work.docs[locale];
    if (!doc || entries.length === 0) return work;
    const next = entries.reduce<LocaleDoc>((acc, entry) => {
      if (entry.mode === 'replace' && entry.targetUid) {
        const location = findItem(acc, entry.targetUid);
        if (!location) return acc;
        const wasEmpty = !location.item.audioPath;
        return updateItem(acc, entry.targetUid, {
          audioPath: entry.audioPath,
          duration: entry.duration ?? location.item.duration,
          hidden: wasEmpty ? false : location.item.hidden,
        });
      }
      return insertItem(acc, section, {
        uid: createUid(),
        id: entry.id,
        title: entry.title,
        description: '',
        audioPath: entry.audioPath,
        imagePath: entry.ref?.imagePath ?? '',
        categories: entry.ref ? [...entry.ref.categories] : [],
        addedAt: todayIso(),
        duration: entry.duration,
        hidden: false,
        extra: {},
      });
    }, doc);
    return { ...work, docs: { ...work.docs, [locale]: next } };
  });
}

/* ---------- health fixes & files ---------- */

export function applyIssueFix(fix: Fix): void {
  applyWork((work) => applyFix(work, fix));
}

/** Every relink that is certainly right (never the "same number" guesses). */
export function safeFixes(issues: readonly Issue[]): Fix[] {
  return issues.map((issue) => issue.fix).filter((fix): fix is Fix => fix?.type === 'relink' && fix.confidence === 'high');
}

/** Applies every safe automatic fix in one undo step. */
export function applySafeFixes(issues: readonly Issue[]): number {
  const fixes = safeFixes(issues);
  applyWork((work) => fixes.reduce(applyFix, work));
  return fixes.length;
}

export function deleteFiles(paths: readonly string[]): void {
  applyWork((work) => markForDeletion(work, paths));
}

export function restoreFile(path: string): void {
  applyWork((work) => unmarkDeletion(work, path));
}

/* ---------- categories ---------- */

function withConfig(work: WorkState, config: ContentConfig): WorkState {
  return config === work.config ? work : { ...work, config };
}

export function upsertCategory(category: Category, previousId?: string): void {
  applyWork((work) => {
    const exists = work.config.categories.some((c) => c.id === (previousId ?? category.id));
    const categories = exists
      ? work.config.categories.map((c) => (c.id === (previousId ?? category.id) ? category : c))
      : [...work.config.categories, category];
    const docs = previousId && previousId !== category.id ? renameCategoryEverywhere(work.docs, previousId, category.id) : work.docs;
    return { ...withConfig(work, { ...work.config, categories }), docs };
  });
}

export function deleteCategory(id: string): void {
  applyWork((work) => ({
    ...withConfig(work, { ...work.config, categories: work.config.categories.filter((c) => c.id !== id) }),
    docs: removeCategoryEverywhere(work.docs, id),
  }));
}

export function moveCategory(id: string, delta: -1 | 1): void {
  applyWork((work) => {
    const list = [...work.config.categories];
    const index = list.findIndex((c) => c.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return work;
    [list[index], list[target]] = [list[target], list[index]];
    return withConfig(work, { ...work.config, categories: list });
  });
}

/* ---------- geos ---------- */

/** New geo; optionally copies the story list of another geo (stories hidden until audio is added). */
export function addLocale(code: string, label: string, copyFrom: string | null): void {
  applyWork((work) => {
    if (work.config.locales.some((l) => l.code === code)) return work;
    const source = copyFrom ? work.docs[copyFrom] : undefined;
    const doc = source ? copyStructure(source, code) : emptyDoc(code);
    return {
      ...withConfig(work, { ...work.config, locales: [...work.config.locales, { code, label }] }),
      docs: { ...work.docs, [code]: doc },
      deletions: work.deletions.filter((path) => path !== localeFilePath(code)),
    };
  });
}

function copyStructure(source: LocaleDoc, code: string): LocaleDoc {
  const today = todayIso();
  const copy = (item: ContentItem, section: Section): ContentItem => ({
    ...item,
    uid: createUid(),
    audioPath: section === 'lullabies' ? item.audioPath : '',
    duration: section === 'lullabies' ? item.duration : null,
    hidden: section === 'stories' ? true : item.hidden,
    addedAt: today,
  });
  return {
    code,
    stories: source.stories.map((item) => copy(item, 'stories')),
    lullabies: source.lullabies.map((item) => copy(item, 'lullabies')),
    extraTop: {},
  };
}

export function removeLocale(code: string, deleteFile: boolean): void {
  applyWork((work) => {
    const locales = work.config.locales.filter((l) => l.code !== code);
    const referenceLocale = work.config.settings.referenceLocale === code ? (locales[0]?.code ?? '') : work.config.settings.referenceLocale;
    const docs = Object.fromEntries(Object.entries(work.docs).filter(([c]) => c !== code));
    const next = {
      ...work,
      docs,
      config: { ...work.config, locales, settings: { ...work.config.settings, referenceLocale } },
    };
    return deleteFile ? markForDeletion(next, [localeFilePath(code)]) : next;
  });
}

export function updateLocale(code: string, label: string): void {
  applyWork((work) => withConfig(work, {
    ...work.config,
    locales: work.config.locales.map((l) => (l.code === code ? { ...l, label } : l)),
  }));
}

export function moveLocale(code: string, delta: -1 | 1): void {
  applyWork((work) => {
    const list = [...work.config.locales];
    const index = list.findIndex((l) => l.code === code);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return work;
    [list[index], list[target]] = [list[target], list[index]];
    return withConfig(work, { ...work.config, locales: list });
  });
}

/* ---------- custom fields ---------- */

export function upsertCustomField(field: CustomField, previousKey?: string): void {
  applyWork((work) => {
    const key = previousKey ?? field.key;
    const exists = work.config.customFields.some((f) => f.key === key);
    const customFields = exists ? work.config.customFields.map((f) => (f.key === key ? field : f)) : [...work.config.customFields, field];
    const docs = previousKey && previousKey !== field.key ? renameExtraKey(work.docs, previousKey, field.key) : work.docs;
    return { ...withConfig(work, { ...work.config, customFields }), docs };
  });
}

export function deleteCustomField(key: string, removeValues: boolean): void {
  applyWork((work) => ({
    ...withConfig(work, { ...work.config, customFields: work.config.customFields.filter((f) => f.key !== key) }),
    docs: removeValues ? renameExtraKey(work.docs, key, null) : work.docs,
  }));
}

function renameExtraKey(docs: Docs, from: string, to: string | null): Docs {
  return mapDocs(docs, (doc) =>
    mapItems(doc, (item) => {
      if (!(from in item.extra)) return item;
      const { [from]: value, ...rest } = item.extra;
      return { ...item, extra: to ? { ...rest, [to]: value } : rest };
    }),
  );
}

/* ---------- settings ---------- */

export function updateSettings(patch: Partial<ContentSettings>): void {
  applyWork((work) => {
    const settings = { ...work.config.settings, ...patch };
    const toggled = patch.autoNumberTitles !== undefined && patch.autoNumberTitles !== work.config.settings.autoNumberTitles;
    const docs = toggled ? retitle(work.docs, settings.autoNumberTitles) : work.docs;
    return { ...work, docs, config: { ...work.config, settings } };
  });
}

/** Turning numbering off bakes the current numbers into titles; turning it on strips them. */
function retitle(docs: Docs, autoNumber: boolean): Docs {
  return mapDocs(docs, (doc) =>
    SECTIONS.reduce<LocaleDoc>((acc, section) => {
      let position = 0;
      const items = acc[section].map((item) => {
        const title = autoNumber ? stripNumber(item.title) : item.hidden ? item.title : numberedName(position, item.title);
        if (!item.hidden) position += 1;
        return title === item.title ? item : { ...item, title };
      });
      return items.some((item, i) => item !== acc[section][i]) ? { ...acc, [section]: items } : acc;
    }, doc),
  );
}
