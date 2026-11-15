const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

const SPECIAL: Readonly<Record<string, string>> = {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', þ: 'th', '&': ' and ',
};

const APOSTROPHES = /['’`ʼ]/g;
const DEFAULT_MAX_LENGTH = 48;

/** ASCII slug usable as a content id and as a file name. */
export function slugify(input: string, maxLength = DEFAULT_MAX_LENGTH): string {
  const transliterated = Array.from(input.toLowerCase().replace(APOSTROPHES, ''))
    .map((ch) => CYRILLIC[ch] ?? SPECIAL[ch] ?? ch)
    .join('');
  const ascii = transliterated
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length <= maxLength) return ascii;
  return ascii.slice(0, maxLength).replace(/-+$/g, '');
}

/** Returns `base`, or `base-2`, `base-3`… — the first one not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || 'item';
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidId(id: string): boolean {
  return id.length > 0 && id.length <= 64 && ID_PATTERN.test(id);
}
