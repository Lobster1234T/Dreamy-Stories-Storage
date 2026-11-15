import type { Category, ContentConfig, ContentItem, LocaleDoc, Section } from './types.ts';
import { SECTIONS, SECTION_TYPE } from './types.ts';
import { numberedName } from './titles.ts';

export function localeFilePath(code: string): string {
  return `${code}.json`;
}

/** Same formatting as the existing files: 2-space indent, UTF-8, trailing newline. */
export function serializeLocaleDoc(doc: LocaleDoc, config: ContentConfig): string {
  return `${JSON.stringify(buildLocaleJson(doc, config), null, 2)}\n`;
}

export function buildLocaleJson(doc: LocaleDoc, config: ContentConfig): Record<string, unknown> {
  const autoNumber = config.settings.autoNumberTitles;
  const visible = Object.fromEntries(
    SECTIONS.map((section) => [
      section,
      doc[section].filter((item) => !item.hidden).map((item, index) => itemToJson(item, section, index, autoNumber)),
    ]),
  );
  const hidden = SECTIONS.flatMap((section) =>
    doc[section].flatMap((item, position) =>
      item.hidden ? [{ ...itemToJson(item, section, null, autoNumber), section, position }] : [],
    ),
  );
  const categories = config.categories.length > 0 ? localizedCategories(config, doc.code) : null;
  return {
    ...visible,
    ...(categories ? { categories } : {}),
    ...(hidden.length > 0 ? { hidden } : {}),
    ...doc.extraTop,
  };
}

/**
 * The first six keys keep the original order so the app keeps working and
 * diffs stay readable. `index` always equals the position in the app list.
 */
function itemToJson(
  item: ContentItem,
  section: Section,
  index: number | null,
  autoNumber: boolean,
): Record<string, unknown> {
  const name = autoNumber && index !== null ? numberedName(index, item.title) : item.title;
  return {
    name,
    type: SECTION_TYPE[section],
    description: item.description,
    audioPath: item.audioPath,
    imagePath: item.imagePath,
    ...(index !== null ? { index } : {}),
    id: item.id,
    categories: [...item.categories],
    ...(item.addedAt ? { addedAt: item.addedAt } : {}),
    ...(item.duration !== null ? { duration: item.duration } : {}),
    ...cleanExtra(item.extra),
  };
}

/** Unknown fields go back exactly as they came (custom fields drop empty values in the editor). */
function cleanExtra(extra: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined));
}

export function categoryName(category: Category, code: string, fallbackLocale: string): string {
  const candidates = [category.names[code], category.names[fallbackLocale], category.names.en, ...Object.values(category.names)];
  return candidates.find((name) => typeof name === 'string' && name.trim() !== '')?.trim() ?? category.id;
}

export function localizedCategories(config: ContentConfig, code: string): Array<Record<string, string>> {
  return config.categories.map((category) => ({
    id: category.id,
    name: categoryName(category, code, config.settings.referenceLocale),
    icon: category.icon,
    color: category.color,
  }));
}

/** Title as the app shows it, e.g. "12. Rapunzel". */
export function displayName(item: ContentItem, visiblePosition: number | null, autoNumber: boolean): string {
  if (!autoNumber || visiblePosition === null) return item.title;
  return numberedName(visiblePosition, item.title);
}
