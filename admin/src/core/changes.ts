import type {
  ContentConfig,
  ContentItem,
  Docs,
  LocaleDoc,
  RepoFile,
  Section,
  Uploads,
  UploadStatus,
  WorkState,
} from './types.ts';
import { SECTIONS, SECTION_LABEL } from './types.ts';
import { localeFilePath, serializeLocaleDoc } from './serialize.ts';
import { CONFIG_PATH, serializeConfig } from './config.ts';
import { referencedPaths } from './ops.ts';

export type FileChange =
  | { readonly kind: 'text'; readonly path: string; readonly content: string; readonly isNew: boolean }
  | { readonly kind: 'blob'; readonly path: string; readonly sha: string | null; readonly size: number; readonly status: UploadStatus }
  | { readonly kind: 'rename'; readonly from: string; readonly to: string; readonly sha: string }
  | { readonly kind: 'delete'; readonly path: string };

export interface BaseState {
  readonly docs: Docs;
  readonly config: ContentConfig;
  readonly configExists: boolean;
  readonly files: ReadonlyMap<string, RepoFile>;
  /**
   * Set while some geo file cannot be read: we cannot know which media it
   * uses, so nothing may be deleted (renames become copies).
   */
  readonly lockDeletes?: boolean;
}

export function computeFileChanges(base: BaseState, work: WorkState, uploads: Uploads): FileChange[] {
  return [...computeTextChanges(base, work), ...computeMediaChanges(base, work, uploads)];
}

/** JSON files (geo files and the panel config). Independent of upload progress. */
export function computeTextChanges(base: BaseState, work: WorkState): FileChange[] {
  const texts = localeTextChanges(base, work);
  const configChange = configTextChange(base, work, texts.length > 0);
  return configChange ? [...texts, configChange] : texts;
}

/** Uploaded, renamed and deleted media. */
export function computeMediaChanges(base: BaseState, work: WorkState, uploads: Uploads): FileChange[] {
  const referenced = referencedPaths(work.docs);
  const blobs: FileChange[] = Object.values(uploads)
    .filter((upload) => upload.keep || referenced.has(upload.path))
    .map((upload) => ({ kind: 'blob', path: upload.path, sha: upload.sha, size: upload.size, status: upload.status }));
  const moves = work.renames.flatMap((rename): FileChange[] => {
    const file = base.files.get(rename.from);
    // Nobody uses the new name (e.g. that geo's edits were discarded): nothing to do.
    if (!file || !referenced.has(rename.to)) return [];
    // The old name is still used somewhere (or deletes are locked): copy instead of move.
    if (base.lockDeletes || referenced.has(rename.from)) {
      return [{ kind: 'blob', path: rename.to, sha: file.sha, size: file.size, status: 'done' }];
    }
    return [{ kind: 'rename', from: rename.from, to: rename.to, sha: file.sha }];
  });
  const written = new Set([...blobs, ...moves].map((c) => (c.kind === 'rename' ? c.to : 'path' in c ? c.path : '')));
  const deletes: FileChange[] = base.lockDeletes ? [] : work.deletions
    .filter((path) => base.files.has(path) && !referenced.has(path) && !written.has(path))
    .map((path) => ({ kind: 'delete', path }));
  return [...blobs, ...moves, ...deletes];
}

function localeTextChanges(base: BaseState, work: WorkState): FileChange[] {
  const knownBefore = new Set(base.config.locales.map((l) => l.code));
  return work.config.locales.flatMap((locale): FileChange[] => {
    const doc = work.docs[locale.code];
    if (!doc) return [];
    const path = localeFilePath(locale.code);
    const exists = base.files.has(path);
    const content = serializeLocaleDoc(doc, work.config);
    const baseDoc = base.docs[locale.code];
    if (exists && baseDoc && serializeLocaleDoc(baseDoc, base.config) === content) return [];
    if (exists && !baseDoc) return [];
    const isEmpty = doc.stories.length + doc.lullabies.length === 0;
    if (!exists && isEmpty && knownBefore.has(locale.code)) return [];
    return [{ kind: 'text', path, content, isNew: !exists }];
  });
}

function configTextChange(base: BaseState, work: WorkState, otherChanges: boolean): FileChange | null {
  const content = serializeConfig(work.config);
  const changed = content !== serializeConfig(base.config);
  if (!changed && (base.configExists || !otherChanges)) return null;
  return { kind: 'text', path: CONFIG_PATH, content, isNew: !base.configExists };
}

export function changedPaths(changes: readonly FileChange[]): string[] {
  return changes.flatMap((change) => (change.kind === 'rename' ? [change.from, change.to] : [change.path]));
}

/* ---------- item-level summary ---------- */

export type ItemChangeKind = 'added' | 'removed' | 'modified';

export interface ItemChange {
  readonly locale: string;
  readonly section: Section;
  readonly kind: ItemChangeKind;
  readonly uid: string;
  readonly title: string;
  readonly fields: readonly string[];
}

export interface LocaleSummary {
  readonly locale: string;
  readonly items: readonly ItemChange[];
  readonly reordered: readonly Section[];
}

const FIELD_LABELS: ReadonlyArray<[keyof ContentItem, string]> = [
  ['title', 'название'], ['description', 'описание'], ['audioPath', 'аудио'], ['imagePath', 'обложка'],
  ['categories', 'категории'], ['addedAt', 'дата'], ['duration', 'длительность'], ['id', 'ID'],
  ['hidden', 'видимость'], ['extra', 'доп. поля'],
];

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function changedFields(before: ContentItem, after: ContentItem): string[] {
  return FIELD_LABELS.filter(([key]) => !sameValue(before[key], after[key])).map(([, label]) => label);
}

/**
 * Pairs every new item with its previous version: by uid first, then — for
 * items whose uid is unknown (e.g. a restored draft) — by id among the old
 * items that lost their uid match.
 */
function pairItems(before: readonly ContentItem[], after: readonly ContentItem[]): Map<string, ContentItem> {
  const beforeByUid = new Map(before.map((item) => [item.uid, item]));
  const afterUids = new Set(after.map((item) => item.uid));
  const unmatchedOld = before.filter((item) => !afterUids.has(item.uid));
  const pairs = new Map<string, ContentItem>();
  for (const item of after) {
    const byUid = beforeByUid.get(item.uid);
    const byId = byUid ? undefined : unmatchedOld.find((old) => old.id && old.id === item.id && ![...pairs.values()].includes(old));
    const old = byUid ?? byId;
    if (old) pairs.set(item.uid, old);
  }
  return pairs;
}

function summarizeSection(code: string, section: Section, before: readonly ContentItem[], after: readonly ContentItem[]): ItemChange[] {
  const pairs = pairItems(before, after);
  const change = (kind: ItemChangeKind, item: ContentItem, fields: readonly string[] = []): ItemChange =>
    ({ locale: code, section, kind, uid: item.uid, title: item.title, fields });
  const addedOrModified = after.flatMap((item) => {
    const old = pairs.get(item.uid);
    if (!old) return [change('added', item)];
    const fields = changedFields(old, item);
    return fields.length > 0 ? [change('modified', item, fields)] : [];
  });
  const matchedOld = new Set([...pairs.values()].map((item) => item.uid));
  const removed = before.filter((item) => !matchedOld.has(item.uid)).map((item) => change('removed', item));
  return [...addedOrModified, ...removed];
}

export function summarizeLocale(base: LocaleDoc | undefined, doc: LocaleDoc): LocaleSummary {
  const items = SECTIONS.flatMap((section) => summarizeSection(doc.code, section, base ? base[section] : [], doc[section]));
  const reordered = SECTIONS.filter((section) => base !== undefined && isReordered(base[section], doc[section]));
  return { locale: doc.code, items, reordered };
}

function isReordered(before: readonly ContentItem[], after: readonly ContentItem[]): boolean {
  const common = new Set(after.map((item) => item.uid));
  const oldOrder = before.map((item) => item.uid).filter((uid) => common.has(uid));
  const keep = new Set(oldOrder);
  const newOrder = after.map((item) => item.uid).filter((uid) => keep.has(uid));
  return oldOrder.some((uid, index) => uid !== newOrder[index]);
}

export function summarizeDocs(baseDocs: Docs, docs: Docs, localeOrder: readonly string[]): LocaleSummary[] {
  return localeOrder
    .filter((code) => docs[code])
    .map((code) => summarizeLocale(baseDocs[code], docs[code]))
    .filter((summary) => summary.items.length > 0 || summary.reordered.length > 0);
}

export function changedUids(summaries: readonly LocaleSummary[]): Set<string> {
  return new Set(summaries.flatMap((s) => s.items.filter((i) => i.kind !== 'removed').map((i) => i.uid)));
}

/* ---------- commit message ---------- */

const KIND_MARK: Readonly<Record<ItemChangeKind, string>> = { added: '+', removed: '−', modified: '✎' };
const MAX_BODY_LINES = 40;

export function buildCommitMessage(summaries: readonly LocaleSummary[], changes: readonly FileChange[]): string {
  const headline = summaries.length > 0
    ? `Контент: ${summaries.map(localeHeadline).join(', ')}`
    : 'Контент: обновление файлов';
  const lines = summaries.flatMap((s) => [
    ...s.items.map((i) => `${KIND_MARK[i.kind]} ${s.locale.toUpperCase()} · ${SECTION_LABEL[i.section]} · ${i.title}${i.fields.length ? ` (${i.fields.join(', ')})` : ''}`),
    ...s.reordered.map((section) => `↕ ${s.locale.toUpperCase()} · ${SECTION_LABEL[section]} · изменён порядок`),
  ]);
  const fileLines = changes.filter((c) => c.kind !== 'text').map(describeFileChange);
  const body = [...lines, ...fileLines];
  const trimmed = body.length > MAX_BODY_LINES ? [...body.slice(0, MAX_BODY_LINES), `… и ещё ${body.length - MAX_BODY_LINES}`] : body;
  return [truncate(headline, 120), '', ...trimmed, '', 'Опубликовано из админ-панели'].join('\n');
}

function localeHeadline(summary: LocaleSummary): string {
  const count = (kind: ItemChangeKind): number => summary.items.filter((i) => i.kind === kind).length;
  const parts = (['added', 'modified', 'removed'] as const).filter((k) => count(k) > 0).map((k) => `${KIND_MARK[k]}${count(k)}`);
  if (summary.reordered.length > 0) parts.push('↕');
  return `${summary.locale.toUpperCase()} ${parts.join(' ')}`;
}

export function describeFileChange(change: FileChange): string {
  switch (change.kind) {
    case 'text': return `${change.isNew ? 'создан' : 'изменён'} ${change.path}`;
    case 'blob': return `загружен ${change.path}`;
    case 'rename': return `переименован ${change.from} → ${change.to}`;
    case 'delete': return `удалён ${change.path}`;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
