import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, filterItems, isFilterActive, normalizeForSearch, sortItems } from './sorting.ts';
import { buildMatrix, missingLocales } from './matrix.ts';
import { effectiveFiles, previewSourcePath } from './files.ts';
import {
  audioDir,
  basename,
  buildMediaPath,
  dirname,
  encodePathForUrl,
  extensionOf,
  formatBytes,
  formatDuration,
  imageDir,
  isAsciiSafePath,
  isSafeRepoPath,
  isUnderRoots,
  mediaRoots,
} from './paths.ts';
import { asNumberInRange, todayIso } from './guards.ts';
import type { RepoFile } from './types.ts';
import { makeConfig, makeDoc, makeItem } from '../test/fixtures.ts';

describe('filter and sort', () => {
  const items = [
    makeItem({ uid: '1', title: 'Hänsel und Gretel', addedAt: '2025-09-15', duration: 600, categories: ['classic'] }),
    makeItem({ uid: '2', title: 'Ёжик в тумане', addedAt: null, duration: null, hidden: true }),
    makeItem({ uid: '3', title: 'Aladdin', addedAt: '2025-10-01', duration: 900, categories: ['magic', 'classic'] }),
  ];
  const context = { changedUids: new Set(['3']), problemUids: new Set(['2']) };

  it('searches without accents and ё', () => {
    expect(filterItems(items, { ...EMPTY_FILTER, query: 'hansel' }, context).map((i) => i.uid)).toEqual(['1']);
    expect(filterItems(items, { ...EMPTY_FILTER, query: 'ежик тумане' }, context).map((i) => i.uid)).toEqual(['2']);
    expect(normalizeForSearch('Ёлка Éclair')).toBe('елка eclair');
  });

  it('filters by category and status', () => {
    expect(filterItems(items, { ...EMPTY_FILTER, categories: ['magic'] }, context).map((i) => i.uid)).toEqual(['3']);
    expect(filterItems(items, { ...EMPTY_FILTER, status: 'hidden' }, context).map((i) => i.uid)).toEqual(['2']);
    expect(filterItems(items, { ...EMPTY_FILTER, status: 'visible' }, context)).toHaveLength(2);
    expect(filterItems(items, { ...EMPTY_FILTER, status: 'changed' }, context).map((i) => i.uid)).toEqual(['3']);
    expect(filterItems(items, { ...EMPTY_FILTER, status: 'problems' }, context).map((i) => i.uid)).toEqual(['2']);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, query: ' x ' })).toBe(true);
  });

  it('sorts with unknown values last', () => {
    expect(sortItems(items, 'newest').map((i) => i.uid)).toEqual(['3', '1', '2']);
    expect(sortItems(items, 'oldest').map((i) => i.uid)).toEqual(['1', '3', '2']);
    expect(sortItems(items, 'duration').map((i) => i.uid)).toEqual(['3', '1', '2']);
    expect(sortItems(items, 'title', 'en').map((i) => i.uid)).toEqual(['3', '1', '2']);
    expect(sortItems(items, 'title', 'ru').map((i) => i.uid)).toEqual(['2', '3', '1']);
    expect(sortItems(items, 'title', 'not a locale!!').map((i) => i.uid)).toHaveLength(3);
    expect(sortItems(items, 'order')).not.toBe(items);
  });
});

describe('matrix', () => {
  it('orders rows by the reference geo and marks gaps', () => {
    const en = makeDoc('en', [makeItem({ id: 'a', title: 'A' }), makeItem({ id: 'b', title: 'B' })]);
    const fr = makeDoc('fr', [makeItem({ id: 'b', title: 'B fr' }), makeItem({ id: 'c', title: 'C fr' }), makeItem({ id: '', title: 'no id' })]);
    const rows = buildMatrix({ en, fr }, ['fr', 'en'], 'en', 'stories');
    expect(rows.map((r) => r.id.startsWith('__no-id__') ? 'noid' : r.id)).toEqual(['a', 'b', 'c', 'noid']);
    expect(rows[1].presentIn).toBe(2);
    expect(missingLocales(rows[0], ['en', 'fr'])).toEqual(['fr']);
    expect(rows[2].title).toBe('C fr');
  });
});

describe('effective files', () => {
  const base = new Map<string, RepoFile>([
    ['a.mp3', { path: 'a.mp3', sha: '1', size: 10 }],
    ['b.jpg', { path: 'b.jpg', sha: '2', size: 20 }],
  ]);

  it('applies renames, deletions and uploads', () => {
    const files = effectiveFiles(base, {
      renames: [{ from: 'a.mp3', to: 'x/a.mp3' }, { from: 'ghost', to: 'y' }],
      deletions: ['b.jpg'],
    }, { 'n.mp3': { path: 'n.mp3', status: 'local', progress: 0, size: 3, mime: '', sha: null, error: null, keep: false } });
    expect([...files.keys()].sort()).toEqual(['n.mp3', 'x/a.mp3']);
    expect(files.get('x/a.mp3')).toEqual({ size: 10, pending: true, renamedFrom: 'a.mp3' });
    expect(previewSourcePath('x/a.mp3', files)).toBe('a.mp3');
    expect(previewSourcePath('n.mp3', files)).toBe('n.mp3');
  });
});

describe('paths', () => {
  const config = makeConfig();

  it('builds media folders from templates', () => {
    expect(audioDir(config, 'stories', 'ru')).toBe('stories/ru');
    expect(audioDir(config, 'lullabies', 'ru')).toBe('lullabies');
    expect(imageDir(config, 'stories')).toBe('images');
    expect(imageDir(config, 'lullabies')).toBe('lullaby_images');
    expect(mediaRoots(config)).toEqual(['stories', 'lullabies', 'images', 'lullaby_images']);
    expect(isUnderRoots('stories/ru/1.mp3', ['stories'])).toBe(true);
    expect(isUnderRoots('storiesX/1.mp3', ['stories'])).toBe(false);
    expect(buildMediaPath('stories/ru', 'rapunzel', 'ab12cd', 'MP3')).toBe('stories/ru/rapunzel-ab12cd.mp3');
    expect(buildMediaPath('images', 'x', 'h', '')).toBe('images/x-h.bin');
  });

  it.each([
    ['stories/ru/1.mp3', true],
    ['stories/de/12. Der Löwe.mp3', true],
    ['', false],
    ['/abs.mp3', false],
    ['a/../b', false],
    ['a//b', false],
    ['.github/workflows/x.yml', false],
    ['.git/config', false],
    ['dir/', false],
    ['bad\\name', false],
    ['admin/config.json', true],
    ['admin/index.html', false],
    ['Admin/src/main.tsx', false],
    [`stories/${'a'.repeat(256)}.mp3`, false],
  ])('checks repo path %s', (path, ok) => {
    expect(isSafeRepoPath(path)).toBe(ok);
  });

  it('formats and splits paths', () => {
    expect(isAsciiSafePath('stories/en/1.mp3')).toBe(true);
    expect(isAsciiSafePath('stories/en/1. Rapunzel.mp3')).toBe(false);
    expect(encodePathForUrl('stories/de/12. Löwe.mp3')).toBe('stories/de/12.%20L%C3%B6we.mp3');
    expect(basename('a/b/c.mp3')).toBe('c.mp3');
    expect(basename('c.mp3')).toBe('c.mp3');
    expect(dirname('a/b/c.mp3')).toBe('a/b');
    expect(dirname('c.mp3')).toBe('');
    expect(extensionOf('x.JPEG')).toBe('jpeg');
    expect(extensionOf('noext')).toBe('');
    expect(formatBytes(500)).toBe('500 Б');
    expect(formatBytes(2048)).toBe('2 КБ');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 МБ');
    expect(formatDuration(754)).toBe('12:34');
    expect(formatDuration(null)).toBe('—');
  });

  it('guards helpers', () => {
    expect(asNumberInRange(5, 0, 3, 1)).toBe(3);
    expect(asNumberInRange('5', 0, 3, 1)).toBe(1);
    expect(todayIso(new Date('2026-11-15T12:00:00Z'))).toMatch(/^2026-11-1[56]$/);
  });
});
