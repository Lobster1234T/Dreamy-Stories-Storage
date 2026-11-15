/**
 * Links to story audio (YouTube videos, playlists, direct files): parsing what the user
 * pasted and turning video titles into story titles. Pure helpers shared by the panel
 * and its local download server.
 */
import { stripNumber } from './titles.ts';

export const MAX_LINKS = 50;
const MAX_LINK_LENGTH = 2000;
const MAX_TITLE_LENGTH = 120;

/** Normalized http(s) URL, or null for anything else. */
export function normalizeLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text || text.length > MAX_LINK_LENGTH) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface ParsedLinks {
  readonly links: readonly string[];
  readonly invalid: readonly string[];
  readonly truncated: boolean;
}

/** Unique links from pasted text: one per line or separated by spaces. */
export function parseLinks(text: string, max = MAX_LINKS): ParsedLinks {
  const links: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const link = normalizeLink(token);
    if (!link) invalid.push(token);
    else if (!links.includes(link)) links.push(link);
  }
  return { links: links.slice(0, max), invalid, truncated: links.length > max };
}

/** Licence and promo phrases that are never part of a story title. */
const NOISE_WORDS = [
  /no[\s-]*copyright(?:\s+(?:music|story|stories|audio|video))?/gi,
  /(?:copyright|royalty)[\s-]*free/gi,
  /free[\s-]*to[\s-]*use/gi,
  /creative\s+commons/gi,
  /\bcc[\s-]*by(?:[\s-]*(?:sa|nc|nd))*(?:[\s-]*\d(?:\.\d)?)?\b/gi,
  /\bncs\b/gi,
  /без\s+авторских\s+прав/gi,
  /свободн\S*\s+лицензи\S*/gi,
];

/** Separator-delimited parts that only describe the genre ("Bedtime Stories for Kids"). */
const GENERIC_PARTS = [
  /^(?:the\s+)?(?:best\s+)?(?:short\s+)?(?:bedtime|sleep|sleepy|fairy|moral|kids?|children'?s?)\s+(?:stories|story|tales?)(?:\s+(?:for|with)\s+(?:kids|children|toddlers|babies|sleep))?$/i,
  /^(?:stories|story|tales?|fairy\s+tales?)\s+for\s+(?:kids|children|toddlers|babies)$/i,
  /^(?:full\s+)?(?:audio\s*book|audio\s+story|full\s+story|full\s+audio(?:book)?)$/i,
  /^(?:english|русский|deutsch|español|français|italiano|português)$/i,
  /^(?:аудио)?сказк[аи](?:\s+(?:на\s+ночь|для\s+детей|для\s+малышей))?$/i,
  /^(?:аудиокнига|аудиосказк[аи])$/i,
];

/** Bracketed tags like "(No Copyright)", "[HD]", "(Full Audiobook)". */
const TAG_WORDS = /copyright|royalty|free|ncs|creative|cc\s*by|авторск|лицензи|\bhd\b|\b4k\b|official|audio|full|bedtime|для детей|на ночь/i;

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu;
const SEPARATOR = /\s+[|•·~]\s+|\s*\|\s*|\s+[-–—]\s+/;
const EDGE_PUNCTUATION = /^[\s|•·~:,.\-–—]+|[\s|•·~:,\-–—]+$/g;

function withoutNoise(text: string): string {
  return NOISE_WORDS.reduce((acc, pattern) => acc.replace(pattern, ' '), text).replace(/\s+/g, ' ').trim();
}

function isGeneric(part: string): boolean {
  const cleaned = withoutNoise(part).replace(EDGE_PUNCTUATION, '');
  return cleaned === '' || GENERIC_PARTS.some((pattern) => pattern.test(cleaned));
}

/**
 * Story title from a video title: drops emojis, hashtags, licence tags and genre
 * parts ("Bedtime Stories for Kids"), keeps the first meaningful part.
 */
export function cleanLinkTitle(raw: string): string {
  const base = raw.replace(EMOJI, ' ').replace(HASHTAG, ' ').replace(/\s+/g, ' ').trim();
  const untagged = base.replace(/[([{【]([^)\]}】]*)[)\]}】]/g, (match, inner: string) => (TAG_WORDS.test(inner) ? ' ' : match));
  const parts = untagged.split(SEPARATOR).map((part) => part.trim()).filter(Boolean);
  const meaningful = parts.find((part) => !isGeneric(part)) ?? '';
  const title = stripNumber(withoutNoise(meaningful)).replace(EDGE_PUNCTUATION, '').replace(/\s+/g, ' ').trim();
  return (title || base).slice(0, MAX_TITLE_LENGTH).trim();
}

/** Short label for where a link points: "youtube.com", "archive.org". */
export function linkHost(link: string): string {
  try {
    return new URL(link).hostname.replace(/^(?:www|m|music)\./, '');
  } catch {
    return '';
  }
}
