import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../github/backend.ts';
import type { MemoryBackend } from '../github/backend.ts';
import { localeFilePath } from '../core/serialize.ts';
import { EN_JSON, RU_JSON, jsonText } from '../test/fixtures.ts';
import { INITIAL_STATE, applyWork, redo, undo, useAppStore } from './appStore.ts';
import { connect, discardAll, discardLocale, disconnect, publish, reload, resolveDraftConflict, saveDraftNow } from './session.ts';
import type { SessionMode } from './auth.ts';
import {
  addLocale,
  applyIssueFix,
  applySafeFixes,
  changeCategories,
  deleteCategory,
  deleteCustomField,
  deleteFiles,
  deleteItems,
  itemToDraft,
  moveCategory,
  moveItemsToEdge,
  moveLocale,
  removeLocale,
  reorderItem,
  restoreFile,
  saveItem,
  setItemsHidden,
  updateLocale,
  updateSettings,
  upsertCategory,
  upsertCustomField,
} from './actions.ts';
import { selectChangedUids, selectFileChanges, selectIssues, selectProblemUids, selectSummaries } from './selectors.ts';
import { ensureUploaded, resumeUploads, stageUpload } from './uploads.ts';

const coords = { owner: 'owner', repo: 'repo', branch: 'main' };
const files = () => ({
  'admin/config.json': JSON.stringify({ locales: [{ code: 'en', label: 'English' }, { code: 'ru', label: 'Русский' }] }),
  'ru.json': jsonText(RU_JSON),
  'en.json': jsonText(EN_JSON),
  'images/image_1.jpg': new Blob(['a']),
  'images/image_2.jpg': new Blob(['b']),
  'lullaby_images/lullaby_1.jpg': new Blob(['c']),
  'stories/ru/1.mp3': new Blob(['1']),
  'stories/ru/2.mp3': new Blob(['2']),
  'stories/en/1.Rapunzel.mp3': new Blob(['3']),
  'stories/en/2.Pinocchio.mp3': new Blob(['4']),
  'lullabies/0.mp3': new Blob(['5']),
});

let backend: MemoryBackend;

async function start(mode: SessionMode = 'sandbox', existing?: MemoryBackend): Promise<MemoryBackend> {
  backend = existing ?? createMemoryBackend({ coords, files: files() });
  await connect({ coords, mode, token: mode === 'readonly' ? null : 't', remember: false, backend });
  return backend;
}

const state = () => useAppStore.getState();
const ru = () => state().work.docs.ru;
const paths = () => selectFileChanges(state()).map((c) => (c.kind === 'rename' ? c.to : c.path));

beforeEach(() => {
  disconnect();
  useAppStore.setState(INITIAL_STATE);
});

describe('session', () => {
  it('connects and loads the repository', async () => {
    await start();
    expect(state().phase).toBe('ready');
    expect(ru().stories.map((s) => s.title)).toEqual(['Рапунцель', 'Пиноккио']);
    expect(selectFileChanges(state())).toEqual([]);
  });

  it('reports load errors', async () => {
    const broken = createMemoryBackend({ coords, files: {} });
    broken.getHead = async () => {
      throw new Error('нет сети');
    };
    await connect({ coords, mode: 'sandbox', token: null, remember: false, backend: broken });
    expect(state()).toMatchObject({ phase: 'error', error: 'нет сети' });
  });

  it('requires a token for the github mode', async () => {
    await expect(connect({ coords, mode: 'github', token: null, remember: false })).rejects.toThrow(/токен/);
  });

  it('edits, undoes and redoes', async () => {
    await start();
    const item = ru().stories[0];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), description: 'Новое описание' } });
    expect(paths()).toEqual(['ru.json']);
    expect(selectSummaries(state())[0].items[0].fields).toEqual(['описание']);
    expect(selectChangedUids(state()).has(item.uid)).toBe(true);
    undo();
    expect(paths()).toEqual([]);
    redo();
    expect(ru().stories[0].description).toBe('Новое описание');
    applyWork((work) => work);
    expect(state().future).toEqual([]);
  });

  it('publishes edits with uploaded files and reloads', async () => {
    await start();
    await stageUpload(new Blob(['new audio'], { type: 'audio/mpeg' }), 'stories/ru/new-1234abcd.mp3');
    saveItem({
      locale: 'ru',
      uid: null,
      position: 0,
      draft: {
        id: 'new-story', title: 'Новая сказка', description: 'Описание', audioPath: 'stories/ru/new-1234abcd.mp3',
        imagePath: 'images/image_1.jpg', categories: [], addedAt: '2026-11-15', duration: 60, hidden: false, section: 'stories', extra: {},
      },
    });
    expect(paths()).toEqual(['ru.json', 'stories/ru/new-1234abcd.mp3']);
    const outcome = await publish();
    expect(outcome.status).toBe('ok');
    expect(state().lastPublished?.sha).toBe(await backend.getHead());
    expect(ru().stories[0].title).toBe('Новая сказка');
    expect(selectFileChanges(state())).toEqual([]);
    expect(backend.commits.at(-1)?.message).toContain('+ RU · Сказки · Новая сказка');
    expect(await publish()).toEqual({ status: 'nothing' });
  });

  it('detects conflicts and can overwrite', async () => {
    await start();
    const item = ru().stories[0];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), title: 'Моя правка' } });
    await backend.pushExternal([{ path: 'ru.json', content: '{"stories":[]}\n' }]);
    expect(await publish()).toEqual({ status: 'conflict', paths: ['ru.json'] });
    expect((await publish({ force: true })).status).toBe('ok');
  });

  it('refuses to publish in read-only mode', async () => {
    const readonly = createMemoryBackend({ coords, files: files() });
    Object.defineProperty(readonly, 'canWrite', { value: false });
    await connect({ coords, mode: 'readonly', token: null, remember: false, backend: readonly });
    expect((await publish()).status).toBe('error');
  });

  it('discards all or one geo', async () => {
    await start();
    const [ruItem, enItem] = [ru().stories[0], state().work.docs.en.stories[0]];
    saveItem({ locale: 'ru', uid: ruItem.uid, draft: { ...itemToDraft(ruItem, 'stories'), title: 'X' } });
    saveItem({ locale: 'en', uid: enItem.uid, draft: { ...itemToDraft(enItem, 'stories'), title: 'Y' } });
    discardLocale('ru');
    expect(paths()).toEqual(['en.json']);
    discardAll();
    expect(paths()).toEqual([]);
  });

  it('keeps a draft across reloads and detects upstream changes', async () => {
    await start('github');
    const item = ru().stories[0];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), title: 'Черновик' } });
    await saveDraftNow();
    disconnect(false);
    await start('github', backend);
    expect(ru().stories[0].title).toBe('Черновик');
    expect(selectSummaries(state())[0].items[0].kind).toBe('modified');

    await backend.pushExternal([{ path: 'ru.json', content: jsonText({ stories: [{ name: '1. Чужая' }] }) }]);
    await reload();
    expect(state().draftConflict?.paths).toEqual(['ru.json']);
    resolveDraftConflict('theirs');
    expect(ru().stories[0].title).toBe('Чужая');
    expect(state().draftConflict).toBeNull();
  });

  it('never reverts upstream changes to files the draft did not touch (regression)', async () => {
    await start('github');
    const item = ru().stories[0];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), title: 'Черновик' } });
    await saveDraftNow();
    await backend.pushExternal([{ path: 'en.json', content: jsonText({ stories: [{ name: '1. Upstream' }] }) }]);
    await reload();
    expect(state().draftConflict).toBeNull();
    expect(state().work.docs.en.stories[0].title).toBe('Upstream');
    expect(paths()).toEqual(['ru.json']);
  });

  it('keeps sandbox edits when reload is pressed', async () => {
    await start('sandbox');
    const item = ru().stories[0];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), title: 'Песочница' } });
    await reload();
    expect(ru().stories[0].title).toBe('Песочница');
  });

  it('refuses to publish when GitHub returned a truncated file list', async () => {
    await start();
    const item = ru().stories[0];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), title: 'X' } });
    useAppStore.setState({ base: { ...state().base!, truncated: true } });
    const outcome = await publish();
    expect(outcome.status).toBe('error');
    expect(backend.commits).toHaveLength(1);
  });

  it('reports a successful publish even if reloading afterwards fails', async () => {
    await start();
    const item = ru().stories[0];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), title: 'Опубликовано' } });
    backend.listFiles = async () => {
      throw new Error('нет сети');
    };
    const outcome = await publish();
    expect(outcome.status).toBe('ok');
    expect(state()).toMatchObject({ phase: 'error' });
    expect(state().error).toMatch(/Опубликовано \(коммит/);
    expect(backend.commits).toHaveLength(2);
  }, 15_000);

  it('restores a draft whose files did not change upstream', async () => {
    await start('github');
    const item = ru().stories[0];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), title: 'Черновик' } });
    await saveDraftNow();
    await backend.pushExternal([{ path: 'other.txt', content: 'x' }]);
    await reload();
    expect(state().draftConflict).toBeNull();
    expect(ru().stories[0].title).toBe('Черновик');
    resolveDraftConflict('mine');
    discardAll();
    await saveDraftNow();
  });
});

describe('item actions', () => {
  beforeEach(async () => {
    await start();
  });

  it('syncs cover and categories to other geos and renames the id everywhere', () => {
    const item = ru().stories[0];
    saveItem({
      locale: 'ru',
      uid: item.uid,
      previousId: item.id,
      draft: { ...itemToDraft(item, 'stories'), id: 'rapunzel-new', imagePath: 'images/image_2.jpg', categories: ['magic'] },
      sync: { imagePath: true, categories: true, audioPath: false, customKeys: [], renameId: true },
    });
    expect(state().work.docs.en.stories[0]).toMatchObject({ id: 'rapunzel-new', imagePath: 'images/image_2.jpg', categories: ['magic'] });
    expect(state().work.docs.en.stories[0].audioPath).toBe('stories/en/1.Rapunzel.mp3');
  });

  it('still syncs other geos when the item moves to another section', () => {
    const item = ru().stories[0];
    saveItem({
      locale: 'ru',
      uid: item.uid,
      draft: { ...itemToDraft(item, 'stories'), section: 'lullabies', imagePath: 'images/image_2.jpg' },
      sync: { imagePath: true, categories: false, audioPath: false, customKeys: [], renameId: false },
    });
    expect(state().work.docs.en.stories[0].imagePath).toBe('images/image_2.jpg');
  });

  it('moves an item to the lullabies section', () => {
    const item = ru().stories[1];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), section: 'lullabies' } });
    expect(ru().stories).toHaveLength(1);
    expect(ru().lullabies.at(-1)?.uid).toBe(item.uid);
  });

  it('deletes items and their files when nobody else uses them', () => {
    const item = ru().stories[1];
    deleteItems('ru', [item.uid], true);
    expect(state().work.deletions).toEqual(['stories/ru/2.mp3']);
    expect(paths()).toEqual(['ru.json', 'stories/ru/2.mp3']);
    restoreFile('stories/ru/2.mp3');
    expect(state().work.deletions).toEqual([]);
    deleteFiles(['images/image_2.jpg']);
    expect(state().work.deletions).toEqual(['images/image_2.jpg']);
    deleteItems('xx', [item.uid], true);
  });

  it('reorders, hides, moves to the edges and changes categories', () => {
    const [a, b] = ru().stories;
    reorderItem('ru', 'stories', 0, 1);
    expect(ru().stories.map((s) => s.uid)).toEqual([b.uid, a.uid]);
    moveItemsToEdge('ru', 'stories', [a.uid], 'top');
    expect(ru().stories[0].uid).toBe(a.uid);
    setItemsHidden('ru', [a.uid], true);
    expect(ru().stories[0].hidden).toBe(true);
    changeCategories('ru', [a.uid, b.uid], ['magic', 'classic'], []);
    changeCategories('ru', [a.uid], [], ['magic']);
    expect(ru().stories.map((s) => s.categories)).toEqual([['classic'], ['magic', 'classic']]);
  });

  it('applies health fixes', () => {
    const issues = selectIssues(state());
    const relinks = issues.filter((i) => i.fix?.type === 'relink');
    expect(relinks.map((i) => i.path)).toEqual(['images/lullaby_1.jpg']);
    expect(applySafeFixes(issues)).toBe(1);
    expect(state().work.docs.en.lullabies[0].imagePath).toBe('lullaby_images/lullaby_1.jpg');
    applyIssueFix({ type: 'delete-file', path: 'images/image_2.jpg' });
    expect(state().work.deletions).toContain('images/image_2.jpg');
    expect(selectProblemUids(state()).size).toBeGreaterThan(0);
  });
});

describe('config actions', () => {
  beforeEach(async () => {
    await start();
  });

  it('manages categories', () => {
    upsertCategory({ id: 'magic', icon: '✨', color: '#7c6cf2', names: { ru: 'Волшебство' } });
    upsertCategory({ id: 'animals', icon: '🐾', color: '#2f9e44', names: { ru: 'Животные' } });
    changeCategories('ru', [ru().stories[0].uid], ['magic'], []);
    upsertCategory({ id: 'wonder', icon: '✨', color: '#7c6cf2', names: { ru: 'Чудеса' } }, 'magic');
    expect(ru().stories[0].categories).toEqual(['wonder']);
    moveCategory('animals', -1);
    expect(state().work.config.categories.map((c) => c.id)).toEqual(['animals', 'wonder']);
    moveCategory('animals', -1);
    deleteCategory('wonder');
    expect(ru().stories[0].categories).toEqual([]);
    expect(paths()).toEqual(['en.json', 'ru.json', 'admin/config.json']);
  });

  it('adds a geo by copying another one and removes geos', () => {
    addLocale('pl', 'Polski', 'en');
    const pl = state().work.docs.pl;
    expect(pl.stories.every((s) => s.hidden && s.audioPath === '')).toBe(true);
    expect(pl.lullabies[0].audioPath).toBe('lullabies/0.mp3');
    expect(paths()).toContain(localeFilePath('pl'));
    addLocale('pl', 'dup', null);
    updateLocale('pl', 'Польша');
    moveLocale('pl', -1);
    expect(state().work.config.locales.map((l) => l.code)).toEqual(['en', 'pl', 'ru']);
    removeLocale('ru', true);
    expect(state().work.deletions).toEqual(['ru.json']);
    addLocale('de', 'Deutsch', null);
    expect(state().work.docs.de.stories).toEqual([]);
  });

  it('manages custom fields and their values', () => {
    upsertCustomField({ key: 'isPremium', label: 'Премиум', type: 'boolean', options: [], shared: true, showInList: true });
    const item = ru().stories[0];
    saveItem({ locale: 'ru', uid: item.uid, draft: { ...itemToDraft(item, 'stories'), extra: { isPremium: true } } });
    upsertCustomField({ key: 'premium', label: 'Премиум', type: 'boolean', options: [], shared: true, showInList: true }, 'isPremium');
    expect(ru().stories[0].extra).toEqual({ premium: true });
    deleteCustomField('premium', true);
    expect(ru().stories[0].extra).toEqual({});
    expect(state().work.config.customFields).toEqual([]);
  });

  it('bakes numbers into titles when auto-numbering is turned off and strips them back', () => {
    updateSettings({ autoNumberTitles: false });
    expect(ru().stories.map((s) => s.title)).toEqual(['1. Рапунцель', '2. Пиноккио']);
    updateSettings({ autoNumberTitles: true });
    expect(ru().stories.map((s) => s.title)).toEqual(['Рапунцель', 'Пиноккио']);
    updateSettings({ media: { ...state().work.config.settings.media, maxImageSize: 1024 } });
    expect(state().work.config.settings.media.maxImageSize).toBe(1024);
  });
});

describe('uploads', () => {
  it('uploads staged files before publishing and resumes interrupted ones', async () => {
    await start();
    await stageUpload(new Blob(['img'], { type: 'image/jpeg' }), 'images/lib-1.jpg', { keep: true });
    await ensureUploaded();
    expect(state().uploads['images/lib-1.jpg']).toMatchObject({ status: 'done', progress: 1 });
    const resumed = resumeUploads({
      a: { path: 'a', status: 'uploading', progress: 0.4, size: 1, mime: '', sha: null, error: null, keep: false },
      b: { path: 'b', status: 'done', progress: 1, size: 1, mime: '', sha: 'x', error: null, keep: false },
    }, false);
    expect(resumed.a.status).toBe('local');
    expect(resumed.b).toMatchObject({ status: 'local', sha: null });
  });

  it('uploads the newer file when a path is staged again mid-upload (regression)', async () => {
    await start();
    let release: (() => void) | null = null;
    const uploaded: string[] = [];
    backend.uploadBlob = async (data) => {
      const text = await data.text();
      if (uploaded.length === 0) await new Promise<void>((resolve) => { release = resolve; });
      uploaded.push(text);
      return `sha-${text}`;
    };
    await stageUpload(new Blob(['old']), 'images/same.jpg', { keep: true });
    await stageUpload(new Blob(['new']), 'images/same.jpg', { keep: true });
    (release as (() => void) | null)?.();
    await ensureUploaded();
    expect(state().uploads['images/same.jpg']).toMatchObject({ status: 'done', sha: 'sha-new' });
    expect(uploaded).toEqual(['old', 'new']);
  });

  it('reports failed uploads', async () => {
    await start();
    backend.uploadBlob = async () => {
      throw new Error('сеть упала');
    };
    await stageUpload(new Blob(['x']), 'images/fail.jpg', { keep: true });
    await expect(ensureUploaded()).rejects.toThrow(/сеть упала/);
    expect((await publish()).status).toBe('error');
  });
});
