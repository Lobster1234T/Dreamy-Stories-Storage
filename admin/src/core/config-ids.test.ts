import { describe, expect, it } from 'vitest';
import {
  CONFIG_PATH,
  defaultConfig,
  detectLocales,
  isLocaleCode,
  isValidCustomFieldKey,
  localeLabel,
  parseConfig,
  serializeConfig,
} from './config.ts';
import { assignMissingIds, idsInSection, newItemId } from './ids.ts';
import { makeDoc, makeItem } from '../test/fixtures.ts';

describe('config', () => {
  it('detects geo files in the repository root only', () => {
    expect(detectLocales(['ru.json', 'en.json', 'pt-BR.json', 'admin/config.json', 'Dreamy-Stories-Storage/de.json', 'package.json']))
      .toEqual(['en', 'pt-BR', 'ru']);
  });

  it('prefers English as the reference geo', () => {
    expect(defaultConfig(['ru', 'en']).settings.referenceLocale).toBe('en');
    expect(defaultConfig(['ru', 'de']).settings.referenceLocale).toBe('ru');
  });

  it('falls back to defaults on broken or missing config', () => {
    expect(parseConfig(null, ['ru']).locales).toEqual([{ code: 'ru', label: 'Русский' }]);
    expect(parseConfig('not json', ['en']).locales[0].code).toBe('en');
    expect(parseConfig('[]', ['en']).locales[0].code).toBe('en');
  });

  it('validates and merges config values', () => {
    const config = parseConfig(JSON.stringify({
      locales: [{ code: 'ru', label: 'Россия' }, { code: 'bad code' }, { code: 'ru' }],
      categories: [
        { id: 'animals', icon: '🐾', color: '#aabbcc', names: { ru: 'Животные', 'x y': 'bad' } },
        { id: 'Bad Id' },
        { id: 'animals' },
        { id: 'magic', color: 'red' },
      ],
      customFields: [
        { key: 'isPremium', label: 'Премиум', type: 'boolean' },
        { key: 'index', type: 'text' },
        { key: 'x', type: 'weird' },
        { key: 'tags', type: 'select', options: ['a', 2, ''], shared: false, showInList: true },
      ],
      settings: {
        autoNumberTitles: false,
        referenceLocale: 'zz',
        media: { maxImageSize: 99999, imageQuality: 0.1, audioWarnMB: 'x' },
        paths: { storyAudioDir: '../evil', lullabyAudioDir: '/songs/', storyImageDir: 'covers', lullabyImageDir: '.hidden' },
      },
    }), ['en', 'ru']);
    expect(config.locales).toEqual([{ code: 'ru', label: 'Россия' }, { code: 'en', label: 'English' }]);
    expect(config.categories.map((c) => c.id)).toEqual(['animals', 'magic']);
    expect(config.categories[0].names).toEqual({ ru: 'Животные' });
    expect(config.categories[1].color).toBe('#7c6cf2');
    expect(config.customFields.map((f) => f.key)).toEqual(['isPremium', 'tags']);
    expect(config.customFields[1]).toMatchObject({ options: ['a', '2'], shared: false, showInList: true });
    expect(config.settings.autoNumberTitles).toBe(false);
    expect(config.settings.referenceLocale).toBe('en');
    expect(config.settings.media).toMatchObject({ maxImageSize: 4096, imageQuality: 0.5, audioWarnMB: 40 });
    expect(config.settings.paths).toEqual({
      storyAudioDir: 'stories/{locale}', lullabyAudioDir: 'songs', storyImageDir: 'covers', lullabyImageDir: 'lullaby_images',
    });
  });

  it('serializes with a trailing newline at a fixed path', () => {
    expect(serializeConfig(defaultConfig(['en'])).endsWith('}\n')).toBe(true);
    expect(CONFIG_PATH).toBe('admin/config.json');
  });

  it('knows locale codes and labels', () => {
    expect(isLocaleCode('pt-BR')).toBe(true);
    expect(isLocaleCode('es-419')).toBe(true);
    expect(isLocaleCode('EN')).toBe(false);
    expect(localeLabel('de')).toBe('Deutsch');
    expect(localeLabel('xx')).toBe('XX');
    expect(isValidCustomFieldKey('isPremium')).toBe(true);
    expect(isValidCustomFieldKey('name')).toBe(false);
    expect(isValidCustomFieldKey('constructor')).toBe(false);
    expect(isValidCustomFieldKey('toString')).toBe(false);
  });
});

describe('assignMissingIds', () => {
  it('links the same story across geos by its cover and slugs the reference title', () => {
    const en = makeDoc('en', [makeItem({ id: '', title: 'The Lost Dragon', imagePath: 'images/41.jpg' })]);
    const ru = makeDoc('ru', [makeItem({ id: '', title: 'Потерянный дракон', imagePath: 'images/41.jpg' })]);
    const result = assignMissingIds({ ru, en }, ['en', 'ru']);
    expect(result.en.stories[0].id).toBe('the-lost-dragon');
    expect(result.ru.stories[0].id).toBe('the-lost-dragon');
  });

  it('links lullabies by their shared audio', () => {
    const en = makeDoc('en', [], [makeItem({ id: '', title: 'Starry Night', imagePath: 'images/lullaby_1.jpg', audioPath: 'lullabies/0.mp3' })]);
    const ru = makeDoc('ru', [], [makeItem({ id: '', title: 'Звёздная ночь', imagePath: 'images/image_1.jpg', audioPath: 'lullabies/0.mp3' })]);
    const result = assignMissingIds({ en, ru }, ['en', 'ru']);
    expect(result.ru.lullabies[0].id).toBe('starry-night');
  });

  it('keeps existing ids, avoids clashes and returns untouched docs as-is', () => {
    const existing = makeDoc('en', [makeItem({ id: 'rapunzel', title: 'Rapunzel', imagePath: 'a.jpg' })]);
    const clash = makeDoc('ru', [makeItem({ id: '', title: 'Rapunzel', imagePath: 'b.jpg' })]);
    const result = assignMissingIds({ en: existing, ru: clash }, ['en', 'ru']);
    expect(result.en).toBe(existing);
    expect(result.ru.stories[0].id).toBe('rapunzel-2');
  });

  it('does not reuse an id twice inside one geo', () => {
    const en = makeDoc('en', [
      makeItem({ id: 'a', imagePath: 'same.jpg' }),
      makeItem({ id: '', title: 'Second', imagePath: 'same.jpg' }),
    ]);
    const result = assignMissingIds({ en }, ['en']);
    expect(result.en.stories[1].id).toBe('second');
  });

  it('creates fresh ids and lists ids per section', () => {
    const docs = { en: makeDoc('en', [makeItem({ id: 'magic-pot' })]) };
    expect(newItemId(docs, 'stories', 'Magic Pot')).toBe('magic-pot-2');
    expect(newItemId(docs, 'lullabies', '')).toBe('lullaby');
    expect([...idsInSection(docs, 'stories')]).toEqual(['magic-pot']);
  });
});
