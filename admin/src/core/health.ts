import type { ContentConfig, ContentItem, Docs, Rename, Section } from './types.ts';
import { SECTIONS, SECTION_LABEL } from './types.ts';
import type { FileInfo } from './files.ts';
import {
  audioDir,
  basename,
  dirname,
  extensionOf,
  formatBytes,
  isAsciiSafePath,
  isAudioPath,
  isImagePath,
  isUnderRoots,
  mediaRoots,
} from './paths.ts';
import { leadingNumber } from './titles.ts';
import { isValidId } from './slug.ts';
import { referencedPaths } from './ops.ts';
import { buildMatrix } from './matrix.ts';

export type Severity = 'error' | 'warning' | 'info';

export type IssueKind =
  | 'parse-error' | 'missing-file' | 'empty-field' | 'duplicate-id' | 'shared-cover'
  | 'duplicate-audio' | 'orphan-file' | 'near-limit' | 'large-file' | 'missing-translation'
  | 'unsafe-paths';

/** high: same file under another spelling/folder (safe to apply in bulk); medium: a guess to check by ear. */
export type Confidence = 'high' | 'medium';

export type Fix =
  | { readonly type: 'relink'; readonly from: string; readonly to: string; readonly confidence: Confidence }
  | { readonly type: 'delete-file'; readonly path: string }
  | { readonly type: 'regenerate-id'; readonly locale: string; readonly uid: string }
  | { readonly type: 'rename-files'; readonly renames: readonly Rename[] };

export interface IssueRef {
  readonly locale: string;
  readonly section: Section;
  readonly uid: string;
  readonly title: string;
}

export interface Issue {
  readonly key: string;
  readonly kind: IssueKind;
  readonly severity: Severity;
  readonly title: string;
  readonly detail?: string;
  readonly path?: string;
  readonly refs: readonly IssueRef[];
  readonly fix?: Fix;
  readonly fixLabel?: string;
  /** Locale the orphan audio most likely belongs to. */
  readonly orphanLocale?: string;
}

export interface HealthInput {
  readonly docs: Docs;
  readonly config: ContentConfig;
  readonly files: ReadonlyMap<string, FileInfo>;
  readonly parseErrors?: Readonly<Record<string, string>>;
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };
const NEAR_LIMIT_BYTES = 90 * 1024 * 1024;
const LARGE_IMAGE_BYTES = 1024 * 1024;

interface Located {
  readonly locale: string;
  readonly section: Section;
  readonly item: ContentItem;
}

function allItems(docs: Docs): Located[] {
  return Object.values(docs).flatMap((doc) =>
    SECTIONS.flatMap((section) => doc[section].map((item) => ({ locale: doc.code, section, item }))),
  );
}

function ref({ locale, section, item }: Located): IssueRef {
  return { locale, section, uid: item.uid, title: item.title || '(без названия)' };
}

export function runHealthChecks(input: HealthInput): Issue[] {
  const items = allItems(input.docs);
  return [
    ...parseErrorIssues(input.parseErrors ?? {}),
    ...missingFileIssues(items, input.files),
    ...emptyFieldIssues(items),
    ...duplicateIdIssues(items),
    ...sharedMediaIssues(items),
    ...orphanIssues(input),
    ...sizeIssues(items, input),
    ...translationIssues(input),
    ...unsafePathIssues(items, input),
  ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function parseErrorIssues(errors: Readonly<Record<string, string>>): Issue[] {
  return Object.entries(errors).map(([locale, message]) => ({
    key: `parse:${locale}`,
    kind: 'parse-error',
    severity: 'error',
    title: `${locale}.json не читается — гео недоступно для редактирования`,
    detail: message,
    refs: [],
  }));
}

function missingFileIssues(items: readonly Located[], files: ReadonlyMap<string, FileInfo>): Issue[] {
  const byPath = new Map<string, Located[]>();
  for (const entry of items) {
    for (const path of [entry.item.audioPath, entry.item.imagePath]) {
      if (!path || files.has(path)) continue;
      byPath.set(path, [...(byPath.get(path) ?? []), entry]);
    }
  }
  const referenced = new Set(items.flatMap(({ item }) => [item.audioPath, item.imagePath]));
  return [...byPath.entries()].map(([path, entries]) => {
    const candidate = findCandidates(path, files, referenced)[0];
    const locales = [...new Set(entries.map((e) => e.locale.toUpperCase()))].join(', ');
    const guess = candidate?.confidence === 'medium';
    return {
      key: `missing:${path}`,
      kind: 'missing-file',
      severity: 'error',
      title: `Файл не найден: ${path}`,
      detail: !candidate
        ? `Используется в: ${locales}. Загрузите файл заново в редакторе сказки.`
        : `Используется в: ${locales}. ${guess ? 'Возможно, это' : 'Правильный файл, скорее всего,'} — ${candidate.path}${guess ? ' (проверьте, прослушав его в медиатеке)' : ''}`,
      path,
      refs: entries.map(ref),
      ...(candidate
        ? {
          fix: { type: 'relink', from: path, to: candidate.path, confidence: candidate.confidence } as const,
          fixLabel: guess ? 'Связать (я проверил)' : 'Связать с найденным файлом',
        }
        : {}),
    };
  });
}

export interface Candidate {
  readonly path: string;
  readonly confidence: Confidence;
}

/**
 * Likely replacements for a missing file, best first.
 * Audio is never matched across folders: every geo has its own recordings,
 * so "stories/pt/36.mp3" must not be linked to "stories/ru/36.mp3".
 */
export function findCandidates(
  missing: string,
  files: ReadonlyMap<string, FileInfo>,
  referenced: ReadonlySet<string>,
): Candidate[] {
  const all = [...files.keys()];
  const fold = (path: string): string => path.normalize('NFC').toLowerCase();
  const high = (paths: string[]): Candidate[] => paths.map((path) => ({ path, confidence: 'high' }));
  const sameNormalized = all.filter((path) => path !== missing && fold(path) === fold(missing));
  if (sameNormalized.length > 0) return high(sameNormalized);
  if (isImagePath(missing)) {
    const name = basename(missing).toLowerCase();
    const sameName = all.filter((path) => isImagePath(path) && basename(path).toLowerCase() === name);
    if (sameName.length > 0) return high(sameName);
  }
  const number = leadingNumber(basename(missing));
  if (number === null) return [];
  const dir = dirname(missing);
  const kind = isAudioPath(missing) ? isAudioPath : isImagePath;
  return all
    .filter((path) => dirname(path) === dir && leadingNumber(basename(path)) === number && !referenced.has(path) && kind(path))
    .map((path) => ({ path, confidence: 'medium' }));
}

function emptyFieldIssues(items: readonly Located[]): Issue[] {
  const checks: Array<{ field: keyof ContentItem; label: string; severity: Severity }> = [
    { field: 'title', label: 'название', severity: 'error' },
    { field: 'audioPath', label: 'аудио', severity: 'error' },
    { field: 'imagePath', label: 'обложка', severity: 'warning' },
    { field: 'description', label: 'описание', severity: 'warning' },
  ];
  // Hidden items never reach the app, so their gaps are reminders, not errors.
  return items.flatMap((entry) =>
    checks
      .filter(({ field }) => String(entry.item[field] ?? '').trim() === '')
      .map(({ field, label, severity }) => ({
        key: `empty:${entry.locale}:${entry.item.uid}:${field}`,
        kind: 'empty-field' as const,
        severity: entry.item.hidden ? ('info' as const) : severity,
        title: `Не заполнено поле «${label}»${entry.item.hidden ? ' (скрытый черновик)' : ''}`,
        detail: `${entry.locale.toUpperCase()} · ${SECTION_LABEL[entry.section]}`,
        refs: [ref(entry)],
      })),
  );
}

function duplicateIdIssues(items: readonly Located[]): Issue[] {
  const groups = groupBy(items.filter((e) => e.item.id), (e) => `${e.locale}|${e.section}|${e.item.id}`);
  return [...groups.values()].filter((group) => group.length > 1).map((group) => {
    const [first, second] = group;
    return {
      key: `dup-id:${first.locale}:${first.section}:${first.item.id}`,
      kind: 'duplicate-id',
      severity: 'error',
      title: `Повторяется ID «${first.item.id}» (${first.locale.toUpperCase()})`,
      detail: 'ID связывает одну сказку между гео, внутри гео он должен быть уникальным.',
      refs: group.map(ref),
      fix: { type: 'regenerate-id', locale: second.locale, uid: second.item.uid },
      fixLabel: 'Выдать новый ID второй сказке',
    };
  });
}

function sharedMediaIssues(items: readonly Located[]): Issue[] {
  const rules: Array<{ field: 'imagePath' | 'audioPath'; kind: IssueKind; text: string }> = [
    { field: 'imagePath', kind: 'shared-cover', text: 'Одна обложка у разных сказок' },
    { field: 'audioPath', kind: 'duplicate-audio', text: 'Один аудиофайл у разных сказок' },
  ];
  return rules.flatMap(({ field, kind, text }) => {
    const groups = groupBy(items.filter((e) => e.item[field]), (e) => `${e.locale}|${e.item[field]}`);
    return [...groups.values()]
      .filter((group) => new Set(group.map((e) => e.item.id || e.item.uid)).size > 1)
      .map((group) => ({
        key: `${kind}:${group[0].locale}:${group[0].item[field]}`,
        kind,
        severity: 'warning' as const,
        title: `${text} (${group[0].locale.toUpperCase()})`,
        detail: group[0].item[field],
        path: group[0].item[field],
        refs: group.map(ref),
      }));
  });
}

function orphanIssues({ docs, config, files, parseErrors }: HealthInput): Issue[] {
  const unreadable = Object.keys(parseErrors ?? {});
  if (unreadable.length > 0) {
    // An unreadable geo still uses its media: never call those files "unused".
    return [{
      key: 'orphans-skipped',
      kind: 'orphan-file',
      severity: 'info',
      title: 'Поиск неиспользуемых файлов и удаление файлов отключены',
      detail: `Пока не читается ${unreadable.map((code) => `${code}.json`).join(', ')}, нельзя понять, какие файлы ему нужны.`,
      refs: [],
    }];
  }
  const referenced = referencedPaths(docs);
  const roots = mediaRoots(config);
  return [...files.keys()]
    .filter((path) => isUnderRoots(path, roots) && (isAudioPath(path) || isImagePath(path)) && !referenced.has(path))
    .map((path) => ({
      key: `orphan:${path}`,
      kind: 'orphan-file',
      severity: 'info',
      title: `Файл не используется: ${path}`,
      detail: `${formatBytes(files.get(path)?.size ?? 0)}. Его можно удалить или добавить как новую сказку.`,
      path,
      refs: [],
      fix: { type: 'delete-file', path },
      fixLabel: 'Удалить файл',
      ...(isAudioPath(path) ? { orphanLocale: localeFromAudioPath(config, path, Object.keys(docs)) } : {}),
    }));
}

export function localeFromAudioPath(config: ContentConfig, path: string, locales: readonly string[]): string | undefined {
  return locales.find((code) => dirname(path) === audioDir(config, 'stories', code));
}

function sizeIssues(items: readonly Located[], { files, config }: HealthInput): Issue[] {
  const used = groupBy(items.flatMap((e) => [e.item.audioPath, e.item.imagePath].filter(Boolean).map((p) => ({ p, e }))), (x) => x.p);
  return [...used.entries()].flatMap(([path, entries]): Issue[] => {
    const size = files.get(path)?.size ?? 0;
    const refs = entries.map(({ e }) => ref(e));
    if (size > NEAR_LIMIT_BYTES) {
      return [{
        key: `limit:${path}`, kind: 'near-limit', severity: 'warning', path, refs,
        title: `Файл почти упёрся в лимит GitHub 100 МБ: ${path}`,
        detail: `${formatBytes(size)}. Заменить такой файл через панель не получится — сожмите аудио (например, 96 кбит/с).`,
      }];
    }
    const tooBig = isAudioPath(path) ? size > config.settings.media.audioWarnMB * 1024 * 1024 : size > LARGE_IMAGE_BYTES;
    if (!tooBig) return [];
    return [{
      key: `large:${path}`, kind: 'large-file', severity: 'info', path, refs,
      title: `Большой файл: ${path}`, detail: `${formatBytes(size)} — дольше грузится у пользователей.`,
    }];
  });
}

function translationIssues({ docs, config }: HealthInput): Issue[] {
  const locales = config.locales.map((l) => l.code).filter((code) => docs[code]);
  return SECTIONS.flatMap((section) =>
    buildMatrix(docs, locales, config.settings.referenceLocale, section)
      .filter((row) => row.presentIn < locales.length && !row.id.startsWith('__no-id__'))
      .map((row) => {
        const missing = locales.filter((code) => !row.cells[code]).map((c) => c.toUpperCase());
        return {
          key: `translation:${section}:${row.id}`,
          kind: 'missing-translation' as const,
          severity: 'info' as const,
          title: `«${row.title}» есть не во всех гео`,
          detail: `${SECTION_LABEL[section]} · нет в: ${missing.join(', ')}`,
          refs: Object.entries(row.cells).flatMap(([locale, cell]) =>
            cell ? [{ locale, section, uid: cell.item.uid, title: cell.item.title }] : []),
        };
      }),
  );
}

function unsafePathIssues(items: readonly Located[], { files, config }: HealthInput): Issue[] {
  const byLocale = groupBy(items, (e) => e.locale);
  return [...byLocale.entries()].flatMap(([locale, entries]) => {
    const renames = planSafeRenames(entries, files, config);
    if (renames.length === 0) return [];
    return [{
      key: `unsafe:${locale}`,
      kind: 'unsafe-paths' as const,
      severity: 'info' as const,
      title: `${locale.toUpperCase()}: ${renames.length} файл(ов) с пробелами или не-латиницей в имени`,
      detail: 'Такие имена иногда ломаются при загрузке (так испортилось имя файла DE №12). Переименование не перезаливает файлы, но пользователи скачают их заново.',
      refs: entries.filter((e) => renames.some((r) => r.from === e.item.audioPath || r.from === e.item.imagePath)).map(ref),
      fix: { type: 'rename-files' as const, renames },
      fixLabel: 'Переименовать в безопасные имена',
    }];
  });
}

/** Target names: `<dir>/<id>.<ext>`, unique and not clashing with existing files. */
export function planSafeRenames(entries: readonly Located[], files: ReadonlyMap<string, FileInfo>, _config: ContentConfig): Rename[] {
  const taken = new Set(files.keys());
  const planned = new Map<string, string>();
  for (const { item } of entries) {
    for (const path of [item.audioPath, item.imagePath]) {
      if (!path || planned.has(path) || isAsciiSafePath(path) || !files.has(path) || files.get(path)?.pending) continue;
      const dir = dirname(path);
      // ids come from repository JSON: only a clean slug may become a file name.
      const stem = isValidId(item.id) ? item.id : 'file';
      const ext = extensionOf(path) || 'bin';
      let target = `${dir}/${stem}.${ext}`;
      for (let n = 2; taken.has(target); n += 1) target = `${dir}/${stem}-${n}.${ext}`;
      taken.add(target);
      planned.set(path, target);
    }
  }
  return [...planned.entries()].map(([from, to]) => ({ from, to }));
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return groups;
}

export function issueUids(issues: readonly Issue[], severities: ReadonlySet<Severity>): Set<string> {
  return new Set(issues.filter((i) => severities.has(i.severity)).flatMap((i) => i.refs.map((r) => r.uid)));
}
