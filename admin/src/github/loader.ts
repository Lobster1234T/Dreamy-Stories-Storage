import type { ContentConfig, Docs, LocaleDoc, RepoFile } from '../core/types.ts';
import { CONFIG_PATH, detectLocales, parseConfig } from '../core/config.ts';
import { ParseError, createUid, emptyDoc, parseLocaleDoc } from '../core/parse.ts';
import type { UidFactory } from '../core/parse.ts';
import { localeFilePath } from '../core/serialize.ts';
import { assignMissingIds } from '../core/ids.ts';
import type { RepoBackend } from './backend.ts';

export interface LoadedRepo {
  readonly commitSha: string;
  readonly files: ReadonlyMap<string, RepoFile>;
  readonly truncated: boolean;
  readonly config: ContentConfig;
  readonly configExists: boolean;
  readonly docs: Docs;
  readonly parseErrors: Readonly<Record<string, string>>;
  /** Raw text of every loaded JSON file, to detect upstream changes later. */
  readonly texts: Readonly<Record<string, string | null>>;
}

/**
 * `atCommit` pins the snapshot (used right after publishing, so a lagging
 * branch read can never show the pre-publish state).
 */
/** Geo files are ~20 KB; anything this big is broken and would freeze the tab. */
export const MAX_JSON_BYTES = 8 * 1024 * 1024;

export async function loadRepo(backend: RepoBackend, makeUid: UidFactory = createUid, atCommit?: string): Promise<LoadedRepo> {
  const commitSha = atCommit ?? (await backend.getHead());
  const listing = await backend.listFiles(commitSha);
  const files = new Map(listing.files.map((file) => [file.path, file]));
  const tooBig = new Set<string>();
  const readPath = async (path: string): Promise<string | null> => {
    const file = files.get(path);
    if (!file) return null;
    if (file.size > MAX_JSON_BYTES) {
      tooBig.add(path);
      return null;
    }
    return backend.readText(file, commitSha);
  };
  const configText = await readPath(CONFIG_PATH);
  const config = parseConfig(configText, detectLocales(files.keys()));
  const codes = config.locales.map((locale) => locale.code);
  const localeTexts = await Promise.all(codes.map(async (code) => [code, await readPath(localeFilePath(code))] as const));
  const parsed = parseAll(localeTexts.filter(([code]) => !tooBig.has(localeFilePath(code))), config.settings.autoNumberTitles, makeUid);
  for (const code of codes) {
    if (tooBig.has(localeFilePath(code))) parsed.errors[code] = `${localeFilePath(code)}: файл слишком большой (больше 8 МБ) — похоже, он повреждён`;
  }
  const docs = assignMissingIds(parsed.docs, [config.settings.referenceLocale, ...codes]);
  const texts = Object.fromEntries([
    [CONFIG_PATH, configText],
    ...localeTexts.map(([code, text]) => [localeFilePath(code), text] as const),
  ]);
  return {
    commitSha,
    files,
    truncated: listing.truncated,
    config,
    configExists: configText !== null,
    docs,
    parseErrors: parsed.errors,
    texts,
  };
}

function parseAll(
  entries: ReadonlyArray<readonly [string, string | null]>,
  autoNumber: boolean,
  makeUid: UidFactory,
): { docs: Record<string, LocaleDoc>; errors: Record<string, string> } {
  const docs: Record<string, LocaleDoc> = {};
  const errors: Record<string, string> = {};
  for (const [code, text] of entries) {
    if (text === null) {
      docs[code] = emptyDoc(code);
      continue;
    }
    try {
      docs[code] = parseLocaleDoc(code, text, { autoNumber, makeUid });
    } catch (error) {
      errors[code] = error instanceof ParseError ? error.message : String(error);
    }
  }
  return { docs, errors };
}
