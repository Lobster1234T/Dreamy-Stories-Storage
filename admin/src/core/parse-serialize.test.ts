import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParseError, emptyDoc, parseLocaleDoc } from './parse.ts';
import { buildLocaleJson, categoryName, displayName, serializeLocaleDoc } from './serialize.ts';
import { assignMissingIds } from './ids.ts';
import { RU_JSON, jsonText, makeConfig, uidFactory } from '../test/fixtures.ts';

const parse = (text: string, autoNumber = true) => parseLocaleDoc('ru', text, { autoNumber, makeUid: uidFactory() });

describe('parseLocaleDoc', () => {
  it('reads items and strips the number when auto-numbering', () => {
    const doc = parse(jsonText(RU_JSON));
    expect(doc.stories.map((s) => s.title)).toEqual(['Рапунцель', 'Пиноккио']);
    expect(doc.lullabies[0]).toMatchObject({ title: 'Звёздная ночь', audioPath: 'lullabies/0.mp3', hidden: false, id: '' });
    expect(doc.stories[0].uid).toBe('u1');
  });

  it('keeps the full name when auto-numbering is off', () => {
    expect(parse(jsonText(RU_JSON), false).stories[0].title).toBe('1. Рапунцель');
  });

  it('preserves unknown item fields and top-level keys', () => {
    const doc = parse(jsonText({ stories: [{ ...RU_JSON.stories[0], isPremium: true }], meta: { v: 2 } }));
    expect(doc.stories[0].extra).toEqual({ isPremium: true });
    expect(doc.extraTop).toEqual({ meta: { v: 2 } });
  });

  it('normalizes new fields defensively', () => {
    const doc = parse(jsonText({
      stories: [{ name: 5, categories: ['a', 'a', ' b ', 3], addedAt: '2025-09-15T10:00:00Z', duration: 754.4 }],
    }));
    expect(doc.stories[0]).toMatchObject({ title: '5', categories: ['a', 'b'], addedAt: '2025-09-15', duration: 754 });
  });

  it('rejects broken files with a readable error', () => {
    expect(() => parse('{ "stories": [ }')).toThrow(ParseError);
    expect(() => parse('[]')).toThrow(/ожидался объект/);
    expect(() => parse('{"stories": {}}')).toThrow(/ожидался массив/);
    expect(() => parse('{"stories": [1]}')).toThrow(/не является объектом/);
    expect(() => parse('{"hidden": [1]}')).toThrow(/hidden/);
  });

  it('accepts a BOM and missing sections', () => {
    const doc = parse(`﻿${jsonText({ stories: [] })}`);
    expect(doc.lullabies).toEqual([]);
  });

  it('creates empty docs', () => {
    expect(emptyDoc('pl')).toEqual({ code: 'pl', stories: [], lullabies: [], extraTop: {} });
  });
});

describe('serializeLocaleDoc', () => {
  const config = makeConfig();

  it('writes index = position and renumbers names', () => {
    const doc = parse(jsonText(RU_JSON));
    const swapped = { ...doc, stories: [doc.stories[1], doc.stories[0]] };
    const json = buildLocaleJson(swapped, config) as { stories: Array<Record<string, unknown>> };
    expect(json.stories.map((s) => [s.name, s.index])).toEqual([['1. Пиноккио', 0], ['2. Рапунцель', 1]]);
  });

  it('keeps the original key order and appends new fields', () => {
    const doc = parse(jsonText(RU_JSON));
    const json = buildLocaleJson(doc, config) as { stories: Array<Record<string, unknown>> };
    expect(Object.keys(json.stories[0])).toEqual(['name', 'type', 'description', 'audioPath', 'imagePath', 'index', 'id', 'categories']);
  });

  it('round-trips hidden items at their positions', () => {
    const doc = parse(jsonText(RU_JSON));
    const withHidden = { ...doc, stories: [doc.stories[0], { ...doc.stories[1], hidden: true }] };
    const text = serializeLocaleDoc(withHidden, config);
    const json = JSON.parse(text);
    expect(json.stories).toHaveLength(1);
    expect(json.hidden[0]).toMatchObject({ name: 'Пиноккио', section: 'stories', position: 1 });
    expect(json.hidden[0].index).toBeUndefined();
    const reparsed = parse(text);
    expect(reparsed.stories.map((s) => [s.title, s.hidden])).toEqual([['Рапунцель', false], ['Пиноккио', true]]);
  });

  it('restores several hidden items in mixed positions', () => {
    const base = parse(jsonText({ stories: ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: n })) }));
    const hiddenSet = new Set(['a', 'c', 'e']);
    const doc = { ...base, stories: base.stories.map((s) => ({ ...s, hidden: hiddenSet.has(s.title) })) };
    const reparsed = parse(serializeLocaleDoc(doc, config));
    expect(reparsed.stories.map((s) => `${s.title}${s.hidden ? '*' : ''}`)).toEqual(['a*', 'b', 'c*', 'd', 'e*']);
  });

  it('writes localized categories when configured', () => {
    const withCategories = makeConfig({
      categories: [{ id: 'animals', icon: '🐾', color: '#123456', names: { ru: 'Животные', en: 'Animals' } }],
    });
    const json = buildLocaleJson(parse(jsonText(RU_JSON)), withCategories) as { categories: unknown };
    expect(json.categories).toEqual([{ id: 'animals', name: 'Животные', icon: '🐾', color: '#123456' }]);
  });

  it('writes unknown values back unchanged and only skips undefined', () => {
    const doc = parse(jsonText(RU_JSON));
    const edited = { ...doc, stories: [{ ...doc.stories[0], extra: { a: '', b: false, c: undefined, d: 3 } }] };
    const json = buildLocaleJson(edited, config) as { stories: Array<Record<string, unknown>> };
    expect(json.stories[0]).toMatchObject({ a: '', b: false, d: 3 });
    expect('c' in json.stories[0]).toBe(false);
  });

  it('names categories with fallbacks', () => {
    const category = { id: 'x', icon: '', color: '#000000', names: { en: 'Magic' } };
    expect(categoryName(category, 'de', 'en')).toBe('Magic');
    expect(categoryName({ ...category, names: {} }, 'de', 'en')).toBe('x');
  });

  it('shows the app name', () => {
    const item = parse(jsonText(RU_JSON)).stories[0];
    expect(displayName(item, 4, true)).toBe('5. Рапунцель');
    expect(displayName(item, null, true)).toBe('Рапунцель');
    expect(displayName(item, 4, false)).toBe('Рапунцель');
  });
});

describe('real repository data', () => {
  const root = resolve(__dirname, '../../..');
  const files = readdirSync(root).filter((name) => /^[a-z]{2}\.json$/.test(name));

  it('finds the geo files', () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it.each(files)('%s parses, serializes and parses again without loss', (file) => {
    const code = file.replace('.json', '');
    const text = readFileSync(join(root, file), 'utf8');
    const config = makeConfig({}, [code]);
    const doc = parseLocaleDoc(code, text, { autoNumber: true, makeUid: uidFactory() });
    const once = serializeLocaleDoc(doc, config);
    const twice = serializeLocaleDoc(parseLocaleDoc(code, once, { autoNumber: true, makeUid: uidFactory() }), config);
    expect(twice).toBe(once);
    const original = JSON.parse(text);
    const written = JSON.parse(once);
    expect(written.stories).toHaveLength(original.stories.length);
    written.stories.forEach((story: { index: number; audioPath: string }, i: number) => {
      expect(story.index).toBe(i);
      expect(story.audioPath).toBe(original.stories[i].audioPath);
    });
  });

  it('gives every item an id that is unique within its geo', () => {
    const codes = files.map((f) => f.replace('.json', ''));
    const docs = Object.fromEntries(codes.map((code) => [
      code, parseLocaleDoc(code, readFileSync(join(root, `${code}.json`), 'utf8'), { autoNumber: true, makeUid: uidFactory(code) }),
    ]));
    const withIds = assignMissingIds(docs, ['en', ...codes]);
    for (const doc of Object.values(withIds)) {
      for (const section of ['stories', 'lullabies'] as const) {
        const ids = doc[section].map((item) => item.id);
        expect(ids.every(Boolean)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});
