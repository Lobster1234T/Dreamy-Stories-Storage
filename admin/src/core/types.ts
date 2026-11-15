/**
 * Domain types shared by the whole panel.
 *
 * On-disk format (one file per geo, e.g. `ru.json`) stays compatible with the
 * existing app: `{ stories: Item[], lullabies: Item[] }`, where every item has
 * name/type/description/audioPath/imagePath/index. The panel only ADDS fields
 * (id, categories, addedAt, duration, custom fields) and two optional top-level
 * keys (`categories`, `hidden`) that the current app ignores.
 */

export type Section = 'stories' | 'lullabies';
export type ItemType = 'story' | 'lullaby';

export const SECTIONS: readonly Section[] = ['stories', 'lullabies'];

export const SECTION_TYPE: Readonly<Record<Section, ItemType>> = {
  stories: 'story',
  lullabies: 'lullaby',
};

export const SECTION_LABEL: Readonly<Record<Section, string>> = {
  stories: 'Сказки',
  lullabies: 'Колыбельные',
};

export interface ContentItem {
  /** Session-only key for React and undo. Never written to JSON. */
  readonly uid: string;
  /** Stable content id, shared by the same story across all geos. */
  readonly id: string;
  /** Title. When auto-numbering is on it has no "12. " prefix. */
  readonly title: string;
  readonly description: string;
  readonly audioPath: string;
  readonly imagePath: string;
  readonly categories: readonly string[];
  /** ISO date `YYYY-MM-DD` or null when unknown. */
  readonly addedAt: string | null;
  /** Audio duration in whole seconds or null when unknown. */
  readonly duration: number | null;
  /** Hidden items are kept in the file but not shown in the app. */
  readonly hidden: boolean;
  /** Unknown and custom fields, preserved verbatim. */
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface LocaleDoc {
  readonly code: string;
  readonly stories: readonly ContentItem[];
  readonly lullabies: readonly ContentItem[];
  /** Unknown top-level keys, preserved verbatim. */
  readonly extraTop: Readonly<Record<string, unknown>>;
}

export type Docs = Readonly<Record<string, LocaleDoc>>;

export interface LocaleDef {
  readonly code: string;
  readonly label: string;
}

export interface Category {
  readonly id: string;
  readonly icon: string;
  readonly color: string;
  /** Localized names keyed by locale code. */
  readonly names: Readonly<Record<string, string>>;
}

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'date' | 'url';

export interface CustomField {
  readonly key: string;
  readonly label: string;
  readonly type: CustomFieldType;
  readonly options: readonly string[];
  /** Shared fields are offered for sync across geos in the editor. */
  readonly shared: boolean;
  readonly showInList: boolean;
}

export interface MediaSettings {
  /** Longest side of uploaded covers, px. 0 keeps the original size. */
  readonly maxImageSize: number;
  readonly squareImages: boolean;
  /** JPEG quality 0.5–1. */
  readonly imageQuality: number;
  /** Audio files above this size get a warning, MB. */
  readonly audioWarnMB: number;
}

export interface PathSettings {
  /** `{locale}` is replaced with the geo code. */
  readonly storyAudioDir: string;
  readonly lullabyAudioDir: string;
  readonly storyImageDir: string;
  readonly lullabyImageDir: string;
}

export interface ContentSettings {
  readonly autoNumberTitles: boolean;
  /** Geo used to order the matrix and to copy structure from. */
  readonly referenceLocale: string;
  readonly media: MediaSettings;
  readonly paths: PathSettings;
}

export interface ContentConfig {
  readonly version: 1;
  readonly locales: readonly LocaleDef[];
  readonly categories: readonly Category[];
  readonly customFields: readonly CustomField[];
  readonly settings: ContentSettings;
}

export interface RepoFile {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
}

export interface Rename {
  readonly from: string;
  readonly to: string;
}

export type UploadStatus = 'local' | 'uploading' | 'done' | 'error';

export interface UploadEntry {
  readonly path: string;
  readonly status: UploadStatus;
  /** 0..1 */
  readonly progress: number;
  readonly size: number;
  readonly mime: string;
  readonly sha: string | null;
  readonly error: string | null;
  /** Keep the file even if no item references it (media library uploads). */
  readonly keep: boolean;
}

export type Uploads = Readonly<Record<string, UploadEntry>>;

/**
 * Everything the user can change before publishing (undo/redo history).
 * Uploads live outside of it: their progress must never be rolled back.
 */
export interface WorkState {
  readonly docs: Docs;
  readonly config: ContentConfig;
  readonly deletions: readonly string[];
  readonly renames: readonly Rename[];
}

export interface ItemLocation {
  readonly section: Section;
  readonly index: number;
  readonly item: ContentItem;
}
