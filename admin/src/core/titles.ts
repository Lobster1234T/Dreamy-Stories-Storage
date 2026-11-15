/** "12. Title", "12.Title", "12) Title" → captures the number prefix. */
const NUMBER_PREFIX = /^\s*\d{1,4}\s*[.)]\s*/;

export function stripNumber(name: string): string {
  return name.replace(NUMBER_PREFIX, '').trim();
}

export function hasNumberPrefix(name: string): boolean {
  return NUMBER_PREFIX.test(name);
}

/** position is zero-based; the app shows numbers starting from 1. */
export function numberedName(position: number, title: string): string {
  return `${position + 1}. ${title.trim()}`;
}

/** Title without extension and leading number, from an uploaded file name. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{2,4}$/i, '');
  return stripNumber(base.replace(/[_]+/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Leading number of a file name ("12. Foo.mp3" → 12), or null. */
export function leadingNumber(fileName: string): number | null {
  const match = /^\s*(\d{1,4})(?=\D|$)/.exec(fileName);
  return match ? Number(match[1]) : null;
}
