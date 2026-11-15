import type { ContentItem, Docs, LocaleDoc, Section } from './types.ts';
import { SECTIONS } from './types.ts';
import { slugify, uniqueSlug } from './slug.ts';

const FALLBACK_ID: Readonly<Record<Section, string>> = { stories: 'story', lullabies: 'lullaby' };

function mediaKeys(section: Section, item: ContentItem): string[] {
  return [
    item.imagePath ? `${section}|img|${item.imagePath}` : '',
    item.audioPath ? `${section}|audio|${item.audioPath}` : '',
  ].filter(Boolean);
}

/** All ids used in a section across all geos. */
export function idsInSection(docs: Docs, section: Section): Set<string> {
  return new Set(Object.values(docs).flatMap((doc) => doc[section].map((item) => item.id).filter(Boolean)));
}

/**
 * Gives every item without an id a stable one.
 * The same story in different geos shares its cover (stories) or audio
 * (lullabies), so an item first tries to borrow the id of an item with the
 * same media; otherwise it gets a slug of its title. The reference geo goes
 * first so its (usually English) titles produce the ids.
 */
export function assignMissingIds(docs: Docs, localeOrder: readonly string[]): Docs {
  const order = [...localeOrder.filter((code) => docs[code]), ...Object.keys(docs).filter((c) => !localeOrder.includes(c))];
  const idByKey = new Map<string, string>();
  for (const code of order) {
    for (const section of SECTIONS) {
      for (const item of docs[code][section]) {
        if (!item.id) continue;
        for (const key of mediaKeys(section, item)) if (!idByKey.has(key)) idByKey.set(key, item.id);
      }
    }
  }
  const taken: Record<Section, Set<string>> = { stories: idsInSection(docs, 'stories'), lullabies: idsInSection(docs, 'lullabies') };
  return Object.fromEntries(order.map((code) => [code, fillDoc(docs[code], idByKey, taken)]));
}

function fillDoc(doc: LocaleDoc, idByKey: Map<string, string>, taken: Record<Section, Set<string>>): LocaleDoc {
  const fillSection = (section: Section): readonly ContentItem[] => {
    const usedHere = new Set(doc[section].map((item) => item.id).filter(Boolean));
    let changed = false;
    const items = doc[section].map((item) => {
      if (item.id) return item;
      const id = pickId(section, item, idByKey, taken[section], usedHere);
      usedHere.add(id);
      changed = true;
      return { ...item, id };
    });
    return changed ? items : doc[section];
  };
  const stories = fillSection('stories');
  const lullabies = fillSection('lullabies');
  return stories === doc.stories && lullabies === doc.lullabies ? doc : { ...doc, stories, lullabies };
}

function pickId(
  section: Section,
  item: ContentItem,
  idByKey: Map<string, string>,
  takenInSection: Set<string>,
  usedHere: Set<string>,
): string {
  const keys = mediaKeys(section, item);
  const linked = keys.map((key) => idByKey.get(key)).find((id): id is string => !!id && !usedHere.has(id));
  if (linked) return linked;
  const id = uniqueSlug(slugify(item.title) || FALLBACK_ID[section], takenInSection);
  takenInSection.add(id);
  for (const key of keys) if (!idByKey.has(key)) idByKey.set(key, id);
  return id;
}

/** A fresh id for a brand-new story, unique across all geos. */
export function newItemId(docs: Docs, section: Section, title: string): string {
  return uniqueSlug(slugify(title) || FALLBACK_ID[section], idsInSection(docs, section));
}
