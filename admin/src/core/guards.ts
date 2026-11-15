export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  const strings = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return [...new Set(strings)];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function asIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = value.trim().slice(0, 10);
  return ISO_DATE.test(date) && !Number.isNaN(Date.parse(date)) ? date : null;
}

export function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function asNumberInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function pickUnknown(raw: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)));
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function todayIso(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
