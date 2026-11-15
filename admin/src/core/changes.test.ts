import { describe, expect, it } from 'vitest';
import {
  buildCommitMessage,
  changedFields,
  changedPaths,
  changedUids,
  computeFileChanges,
  describeFileChange,
  summarizeDocs,
  summarizeLocale,
} from './changes.ts';
import type { BaseState, FileChange } from './changes.ts';
import { parseLocaleDoc } from './parse.ts';
import { moveItem, removeItems, updateItem } from './ops.ts';
import { renameFile } from './fixes.ts';
import { serializeConfig } from './config.ts';
import type { RepoFile, UploadEntry, WorkState } from './types.ts';
import { EN_JSON, RU_JSON, makeConfig, makeItem, uidFactory } from '../test/fixtures.ts';

/** Hand-formatted text, like the real files: re-serialization differs. */
const messyText = (value: unknown) => JSON.stringify(value).replace(/,/g, ',\n');

function setup() {
  const config = makeConfig({}, ['en', 'ru']);
  const make = uidFactory();
  const docs = {
    en: parseLocaleDoc('en', messyText(EN_JSON), { autoNumber: true, makeUid: make }),
    ru: parseLocaleDoc('ru', messyText(RU_JSON), { autoNumber: true, makeUid: make }),
  };
  const files = new Map<string, RepoFile>([
    ['en.json', { path: 'en.json', sha: 's-en', size: 10 }],
    ['ru.json', { path: 'ru.json', sha: 's-ru', size: 10 }],
    ['images/old.jpg', { path: 'images/old.jpg', sha: 's-old', size: 10 }],
    ['images/image_1.jpg', { path: 'images/image_1.jpg', sha: 's-img', size: 10 }],
  ]);
  const base: BaseState = { docs, config, configExists: true, files };
  const work: WorkState = { docs, config, deletions: [], renames: [] };
  return { base, work };
}

const upload = (path: string, extra: Partial<UploadEntry> = {}): UploadEntry => ({
  path, status: 'done', progress: 1, size: 5, mime: 'audio/mpeg', sha: 'blob-sha', error: null, keep: false, ...extra,
});

describe('computeFileChanges', () => {
  it('reports nothing for untouched data even if the files were hand-formatted', () => {
    const { base, work } = setup();
    expect(computeFileChanges(base, work, {})).toEqual([]);
  });

  it('rewrites only the edited geo', () => {
    const { base, work } = setup();
    const uid = work.docs.ru.stories[0].uid;
    const edited = { ...work, docs: { ...work.docs, ru: updateItem(work.docs.ru, uid, { description: 'Новое' }) } };
    const changes = computeFileChanges(base, edited, {});
    expect(changedPaths(changes)).toEqual(['ru.json']);
    expect(changes[0]).toMatchObject({ kind: 'text', isNew: false });
  });

  it('rewrites every geo when a category name changes', () => {
    const { base, work } = setup();
    const config = { ...work.config, categories: [{ id: 'magic', icon: '✨', color: '#7c6cf2', names: { en: 'Magic' } }] };
    const changes = computeFileChanges(base, { ...work, config }, {});
    expect(changedPaths(changes)).toEqual(['en.json', 'ru.json', 'admin/config.json']);
  });

  it('writes the config on first publish when it does not exist yet', () => {
    const { base, work } = setup();
    const noConfig = { ...base, configExists: false };
    expect(computeFileChanges(noConfig, work, {})).toEqual([]);
    const uid = work.docs.en.stories[0].uid;
    const edited = { ...work, docs: { ...work.docs, en: updateItem(work.docs.en, uid, { title: 'X' }) } };
    expect(changedPaths(computeFileChanges(noConfig, edited, {}))).toEqual(['en.json', 'admin/config.json']);
    expect(serializeConfig(work.config)).toContain('"version": 1');
  });

  it('creates a file for a newly added geo, even when empty', () => {
    const { base, work } = setup();
    const config = { ...work.config, locales: [...work.config.locales, { code: 'pl', label: 'Polski' }] };
    const docs = { ...work.docs, pl: { code: 'pl', stories: [], lullabies: [], extraTop: {} } };
    const changes = computeFileChanges(base, { ...work, config, docs }, {});
    expect(changes.find((c) => c.kind === 'text' && c.path === 'pl.json')).toMatchObject({ isNew: true });
  });

  it('includes only uploads that are referenced or kept', () => {
    const { base, work } = setup();
    const uid = work.docs.en.stories[0].uid;
    const docs = { ...work.docs, en: updateItem(work.docs.en, uid, { audioPath: 'stories/en/new.mp3' }) };
    const uploads = {
      'stories/en/new.mp3': upload('stories/en/new.mp3'),
      'stories/en/abandoned.mp3': upload('stories/en/abandoned.mp3'),
      'images/library.jpg': upload('images/library.jpg', { keep: true }),
    };
    const blobs = computeFileChanges(base, { ...work, docs }, uploads).filter((c) => c.kind === 'blob');
    expect(blobs.map((b) => (b.kind === 'blob' ? b.path : ''))).toEqual(['stories/en/new.mp3', 'images/library.jpg']);
  });

  it('deletes only existing, unreferenced files', () => {
    const { base, work } = setup();
    const changes = computeFileChanges(base, {
      ...work,
      deletions: ['images/old.jpg', 'images/image_1.jpg', 'images/never-existed.jpg'],
      renames: [{ from: 'ghost.jpg', to: 'x.jpg' }],
    }, {});
    expect(changes.filter((c) => c.kind === 'delete')).toEqual([{ kind: 'delete', path: 'images/old.jpg' }]);
    expect(changes.filter((c) => c.kind === 'rename')).toEqual([]);
  });

  it('moves a renamed file with its original blob, or copies it while the old name is still used', () => {
    const { base, work } = setup();
    const renamed = renameFile(work, { from: 'images/image_1.jpg', to: 'images/cover.jpg' });
    expect(computeFileChanges(base, renamed, {}).filter((c) => c.kind !== 'text'))
      .toEqual([{ kind: 'rename', from: 'images/image_1.jpg', to: 'images/cover.jpg', sha: 's-img' }]);

    // One geo's edits are discarded: it points at the old name again, so the file must stay.
    const partlyDiscarded = { ...renamed, docs: { ...renamed.docs, ru: base.docs.ru } };
    expect(computeFileChanges(base, partlyDiscarded, {}).filter((c) => c.kind !== 'text'))
      .toEqual([{ kind: 'blob', path: 'images/cover.jpg', sha: 's-img', size: 10, status: 'done' }]);

    // Nobody uses the new name any more: nothing to write at all.
    expect(computeFileChanges(base, { ...renamed, docs: base.docs }, {})).toEqual([]);
  });

  it('never deletes anything while a geo file cannot be read', () => {
    const { base, work } = setup();
    const renamed = renameFile({ ...work, deletions: ['images/old.jpg'] }, { from: 'images/image_1.jpg', to: 'images/cover.jpg' });
    const changes = computeFileChanges({ ...base, lockDeletes: true }, renamed, {}).filter((c) => c.kind !== 'text');
    expect(changes).toEqual([{ kind: 'blob', path: 'images/cover.jpg', sha: 's-img', size: 10, status: 'done' }]);
  });
});

describe('summaries and commit message', () => {
  it('lists added, modified, removed and reordered items', () => {
    const { work } = setup();
    const ru = work.docs.ru;
    const added = makeItem({ uid: 'fresh', id: 'new-story', title: 'Новая' });
    const next = {
      ...removeItems(moveItem(updateItem(ru, ru.stories[1].uid, { categories: ['magic'] }), 'stories', 1, 0), new Set([ru.lullabies[0].uid])),
    };
    const withAdded = { ...next, stories: [...next.stories, added] };
    const summary = summarizeLocale(ru, withAdded);
    expect(summary.items.map((i) => [i.kind, i.title, i.fields])).toEqual([
      ['modified', 'Пиноккио', ['категории']],
      ['added', 'Новая', []],
      ['removed', 'Звёздная ночь', []],
    ]);
    expect(summary.reordered).toEqual(['stories']);
    expect([...changedUids([summary])]).toEqual([ru.stories[1].uid, 'fresh']);
  });

  it('matches restored items by id when uids differ', () => {
    const { work } = setup();
    const reparsed = parseLocaleDoc('ru', JSON.stringify(RU_JSON), { autoNumber: true, makeUid: uidFactory('other') });
    const withIds = (doc: typeof reparsed) => ({ ...doc, stories: doc.stories.map((s, i) => ({ ...s, id: `id${i}` })) });
    expect(summarizeLocale(withIds(work.docs.ru), withIds(reparsed)).items.filter((i) => i.section === 'stories')).toEqual([]);
  });

  it('skips unchanged geos', () => {
    const { work } = setup();
    expect(summarizeDocs(work.docs, work.docs, ['en', 'ru', 'xx'])).toEqual([]);
  });

  it('labels changed fields', () => {
    const item = makeItem();
    expect(changedFields(item, { ...item, title: 'x', hidden: true, extra: { a: 1 } })).toEqual(['название', 'видимость', 'доп. поля']);
  });

  it('builds a readable commit message', () => {
    const { work } = setup();
    const ru = work.docs.ru;
    const summary = summarizeLocale(ru, updateItem(ru, ru.stories[0].uid, { title: 'Рапунцель!' }));
    const files: FileChange[] = [
      { kind: 'text', path: 'ru.json', content: '', isNew: false },
      { kind: 'blob', path: 'stories/ru/x.mp3', sha: 'a', size: 1, status: 'done' },
    ];
    const message = buildCommitMessage([summary], files);
    expect(message.split('\n')[0]).toBe('Контент: RU ✎1');
    expect(message).toContain('✎ RU · Сказки · Рапунцель! (название)');
    expect(message).toContain('загружен stories/ru/x.mp3');
    expect(buildCommitMessage([], files).startsWith('Контент: обновление файлов')).toBe(true);
  });

  it('describes every kind of file change', () => {
    expect(describeFileChange({ kind: 'text', path: 'pl.json', content: '', isNew: true })).toBe('создан pl.json');
    expect(describeFileChange({ kind: 'rename', from: 'a', to: 'b', sha: 'x' })).toBe('переименован a → b');
    expect(describeFileChange({ kind: 'delete', path: 'a' })).toBe('удалён a');
    expect(changedPaths([{ kind: 'rename', from: 'a', to: 'b', sha: 'x' }])).toEqual(['a', 'b']);
  });
});
