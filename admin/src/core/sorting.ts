import type { ContentItem } from './types.ts';

export type SortMode = 'order' | 'newest' | 'oldest' | 'title' | 'duration';
export type StatusFilter = 'all' | 'visible' | 'hidden' | 'changed' | 'problems';

export const SORT_LABELS: Readonly<Record<SortMode, string>> = {
  order: 'Как в приложении',
  newest: 'Сначала новые',
  oldest: 'Сначала старые',
  title: 'По названию',
  duration: 'По длительности',
};

export interface ItemFilter {
  readonly query: string;
  readonly categories: readonly string[];
  readonly status: StatusFilter;
}

export const EMPTY_FILTER: ItemFilter = { query: '', categories: [], status: 'all' };

export interface FilterContext {
  readonly changedUids: ReadonlySet<string>;
  readonly problemUids: ReadonlySet<string>;
}

export function normalizeForSearch(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ё/g, 'е');
}

export function isFilterActive(filter: ItemFilter): boolean {
  return filter.query.trim() !== '' || filter.categories.length > 0 || filter.status !== 'all';
}

function matchesQuery(item: ContentItem, query: string): boolean {
  const needle = normalizeForSearch(query.trim());
  if (!needle) return true;
  const haystack = normalizeForSearch([item.title, item.description, item.id, item.audioPath].join(' '));
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

function matchesStatus(item: ContentItem, status: StatusFilter, context: FilterContext): boolean {
  switch (status) {
    case 'visible': return !item.hidden;
    case 'hidden': return item.hidden;
    case 'changed': return context.changedUids.has(item.uid);
    case 'problems': return context.problemUids.has(item.uid);
    default: return true;
  }
}

export function filterItems(items: readonly ContentItem[], filter: ItemFilter, context: FilterContext): ContentItem[] {
  return items.filter((item) =>
    matchesQuery(item, filter.query) &&
    (filter.categories.length === 0 || filter.categories.some((c) => item.categories.includes(c))) &&
    matchesStatus(item, filter.status, context),
  );
}

function makeCollator(locale: string): Intl.Collator {
  try {
    return new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  } catch {
    return new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  }
}

/**
 * Stable sort; items without a date or duration go last.
 * Titles are compared with the rules of the geo's language.
 */
export function sortItems(items: readonly ContentItem[], mode: SortMode, locale = 'en'): ContentItem[] {
  if (mode === 'order') return [...items];
  const indexed = items.map((item, index) => ({ item, index }));
  const compare = comparator(mode, locale);
  return indexed.sort((a, b) => compare(a.item, b.item) || a.index - b.index).map(({ item }) => item);
}

function comparator(mode: Exclude<SortMode, 'order'>, locale: string): (a: ContentItem, b: ContentItem) => number {
  switch (mode) {
    case 'newest': return (a, b) => nullsLast(a.addedAt, b.addedAt, (x, y) => y.localeCompare(x));
    case 'oldest': return (a, b) => nullsLast(a.addedAt, b.addedAt, (x, y) => x.localeCompare(y));
    case 'title': {
      const collator = makeCollator(locale);
      return (a, b) => collator.compare(a.title, b.title);
    }
    case 'duration': return (a, b) => nullsLast(a.duration, b.duration, (x, y) => y - x);
  }
}

function nullsLast<T>(a: T | null, b: T | null, compare: (x: T, y: T) => number): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compare(a, b);
}
