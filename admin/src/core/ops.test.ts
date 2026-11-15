import { describe, expect, it } from 'vitest';
import {
  countItems,
  findById,
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
  replacePath,
  setHidden,
  syncById,
  updateDoc,
  updateItem,
  visiblePositions,
} from './ops.ts';
import { makeDoc, makeItem } from '../test/fixtures.ts';

const a = makeItem({ uid: 'a', id: 'alpha', categories: ['magic'] });
const b = makeItem({ uid: 'b', id: 'beta' });
const c = makeItem({ uid: 'c', id: 'gamma' });
const l = makeItem({ uid: 'l', id: 'song' });
const doc = makeDoc('en', [a, b, c], [l]);
const uids = (items: readonly { uid: string }[]) => items.map((i) => i.uid);

describe('item operations', () => {
  it('finds items by uid', () => {
    expect(findItem(doc, 'c')).toEqual({ section: 'stories', index: 2, item: c });
    expect(findItem(doc, 'l')?.section).toBe('lullabies');
    expect(findItem(doc, 'zzz')).toBeNull();
  });

  it('updates without mutating and keeps untouched references', () => {
    const next = updateItem(doc, 'b', { title: 'New' });
    expect(next.stories[1].title).toBe('New');
    expect(doc.stories[1].title).not.toBe('New');
    expect(next.stories[0]).toBe(a);
    expect(next.lullabies).toBe(doc.lullabies);
    expect(updateItem(doc, 'missing', { title: 'x' })).toBe(doc);
  });

  it('inserts at a position, clamped', () => {
    const item = makeItem({ uid: 'n' });
    expect(uids(insertItem(doc, 'stories', item, 1).stories)).toEqual(['a', 'n', 'b', 'c']);
    expect(uids(insertItem(doc, 'stories', item).stories)).toEqual(['a', 'b', 'c', 'n']);
    expect(uids(insertItem(doc, 'stories', item, -5).stories)).toEqual(['n', 'a', 'b', 'c']);
  });

  it('removes items across sections', () => {
    const next = removeItems(doc, new Set(['a', 'l']));
    expect(uids(next.stories)).toEqual(['b', 'c']);
    expect(next.lullabies).toEqual([]);
    expect(removeItems(doc, new Set(['none']))).toBe(doc);
  });

  it('moves items', () => {
    expect(uids(moveItem(doc, 'stories', 0, 2).stories)).toEqual(['b', 'c', 'a']);
    expect(uids(moveItem(doc, 'stories', 2, 0).stories)).toEqual(['c', 'a', 'b']);
    expect(moveItem(doc, 'stories', 1, 1)).toBe(doc);
    expect(moveItem(doc, 'stories', 9, 0)).toBe(doc);
    expect(uids(moveToEdge(doc, 'stories', new Set(['c', 'b']), 'top').stories)).toEqual(['b', 'c', 'a']);
    expect(uids(moveToEdge(doc, 'stories', new Set(['a']), 'bottom').stories)).toEqual(['b', 'c', 'a']);
    expect(moveToEdge(doc, 'stories', new Set(), 'top')).toBe(doc);
  });

  it('moves an item to the other section', () => {
    const next = moveToSection(doc, 'b', 'lullabies', 0);
    expect(uids(next.stories)).toEqual(['a', 'c']);
    expect(uids(next.lullabies)).toEqual(['b', 'l']);
    expect(moveToSection(doc, 'b', 'stories')).toBe(doc);
  });

  it('hides and shows', () => {
    const hidden = setHidden(doc, new Set(['a', 'b']), true);
    expect(hidden.stories.map((i) => i.hidden)).toEqual([true, true, false]);
    expect(setHidden(hidden, new Set(['a']), false).stories[0].hidden).toBe(false);
    expect(setHidden(doc, new Set(['a']), false)).toBe(doc);
  });

  it('computes app positions and counts', () => {
    const hidden = setHidden(doc, new Set(['b']), true);
    expect([...visiblePositions(hidden.stories).values()]).toEqual([0, null, 1]);
    expect(countItems(hidden, 'stories')).toEqual({ total: 3, visible: 2 });
  });
});

describe('cross-geo operations', () => {
  const ru = makeDoc('ru', [makeItem({ uid: 'ra', id: 'alpha', imagePath: 'old.jpg', categories: ['magic'] })]);
  const docs = { en: doc, ru };

  it('finds the same story in every geo', () => {
    expect(findById(docs, 'stories', 'alpha').map((x) => x.locale)).toEqual(['en', 'ru']);
    expect(findById(docs, 'stories', '')).toEqual([]);
  });

  it('syncs shared fields to other geos only', () => {
    const next = syncById(docs, 'stories', 'alpha', { imagePath: 'new.jpg' }, 'en');
    expect(next.ru.stories[0].imagePath).toBe('new.jpg');
    expect(next.en).toBe(doc);
    expect(syncById(docs, 'stories', 'alpha', {}, 'en')).toBe(docs);
  });

  it('replaces a path everywhere', () => {
    const next = replacePath(docs, 'old.jpg', 'fresh.jpg');
    expect(next.ru.stories[0].imagePath).toBe('fresh.jpg');
    expect(replacePath(docs, 'nope', 'x')).toBe(docs);
  });

  it('removes and renames categories everywhere', () => {
    expect(removeCategoryEverywhere(docs, 'magic').ru.stories[0].categories).toEqual([]);
    expect(renameCategoryEverywhere(docs, 'magic', 'wonder').en.stories[0].categories).toEqual(['wonder']);
  });

  it('collects referenced paths', () => {
    const paths = referencedPaths({ ru });
    expect(paths.has('old.jpg')).toBe(true);
    expect(paths.size).toBe(2);
  });

  it('updates a single doc and maps docs immutably', () => {
    expect(updateDoc(docs, 'xx', (d) => d)).toBe(docs);
    expect(updateDoc(docs, 'ru', (d) => d)).toBe(docs);
    const renamed = updateDoc(docs, 'ru', (d) => ({ ...d, extraTop: { x: 1 } }));
    expect(renamed.ru.extraTop).toEqual({ x: 1 });
    expect(mapDocs(docs, (d) => d)).toBe(docs);
    expect(mapItems(doc, (item) => item)).toBe(doc);
  });
});
