import type { ContentConfig, ContentItem, LocaleDoc } from '../core/types.ts';
import type { FileInfo } from '../core/files.ts';
import { defaultConfig } from '../core/config.ts';

export function uidFactory(prefix = 'u'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${n}`;
  };
}

export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const RU_JSON = {
  stories: [
    { name: '1. Рапунцель', type: 'story', description: 'Девочка с волшебными волосами.', audioPath: 'stories/ru/1.mp3', imagePath: 'images/image_1.jpg', index: 0 },
    { name: '2. Пиноккио', type: 'story', description: 'Деревянный мальчик.', audioPath: 'stories/ru/2.mp3', imagePath: 'images/image_2.jpg', index: 1 },
  ],
  lullabies: [
    { name: '1. Звёздная ночь', type: 'lullaby', description: 'Песня о звёздах.', audioPath: 'lullabies/0.mp3', imagePath: 'lullaby_images/lullaby_1.jpg', index: 0 },
  ],
};

export const EN_JSON = {
  stories: [
    { name: '1. Rapunzel', type: 'story', description: 'A girl with magic hair.', audioPath: 'stories/en/1.Rapunzel.mp3', imagePath: 'images/image_1.jpg', index: 0 },
    { name: '2. Pinocchio', type: 'story', description: 'A wooden boy.', audioPath: 'stories/en/2.Pinocchio.mp3', imagePath: 'images/image_2.jpg', index: 1 },
  ],
  lullabies: [
    { name: '1. Starry Night', type: 'lullaby', description: 'Stars watch over.', audioPath: 'lullabies/0.mp3', imagePath: 'images/lullaby_1.jpg', index: 0 },
  ],
};

let itemCounter = 0;

export function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  itemCounter += 1;
  return {
    uid: `item${itemCounter}`,
    id: `story-${itemCounter}`,
    title: `Story ${itemCounter}`,
    description: 'Description',
    audioPath: `stories/en/${itemCounter}.mp3`,
    imagePath: `images/image_${itemCounter}.jpg`,
    categories: [],
    addedAt: null,
    duration: null,
    hidden: false,
    extra: {},
    ...overrides,
  };
}

export function makeDoc(code: string, stories: ContentItem[] = [], lullabies: ContentItem[] = []): LocaleDoc {
  return { code, stories, lullabies, extraTop: {} };
}

export function makeConfig(overrides: Partial<ContentConfig> = {}, locales: string[] = ['en', 'ru']): ContentConfig {
  return { ...defaultConfig(locales), ...overrides };
}

export function fileMap(entries: Record<string, number> | string[]): Map<string, FileInfo> {
  const pairs: Array<[string, number]> = Array.isArray(entries) ? entries.map((p) => [p, 1000]) : Object.entries(entries);
  return new Map(pairs.map(([path, size]) => [path, { size, pending: false, renamedFrom: null }]));
}
