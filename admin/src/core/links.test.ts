import { describe, expect, it } from 'vitest';
import { cleanLinkTitle, linkHost, normalizeLink, parseLinks } from './links.ts';

describe('normalizeLink', () => {
  it('accepts http and https links only', () => {
    expect(normalizeLink(' https://youtu.be/abc ')).toBe('https://youtu.be/abc');
    expect(normalizeLink('http://archive.org/download/x/a.mp3')).toBe('http://archive.org/download/x/a.mp3');
    expect(normalizeLink('javascript:alert(1)')).toBeNull();
    expect(normalizeLink('ftp://example.com/a.mp3')).toBeNull();
    expect(normalizeLink('not a link')).toBeNull();
    expect(normalizeLink(42)).toBeNull();
    expect(normalizeLink(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
  });
});

describe('parseLinks', () => {
  it('splits lines and spaces, drops duplicates and reports junk', () => {
    const parsed = parseLinks('https://youtu.be/a\nhttps://youtu.be/a  not-a-link\n\nhttp://x.org/f.mp3');

    expect(parsed.links).toEqual(['https://youtu.be/a', 'http://x.org/f.mp3']);
    expect(parsed.invalid).toEqual(['not-a-link']);
    expect(parsed.truncated).toBe(false);
  });

  it('caps the number of links', () => {
    const parsed = parseLinks('https://a.com/1 https://a.com/2 https://a.com/3', 2);

    expect(parsed.links).toEqual(['https://a.com/1', 'https://a.com/2']);
    expect(parsed.truncated).toBe(true);
  });
});

describe('cleanLinkTitle', () => {
  it.each([
    ['The Ugly Duckling | Bedtime Stories for Kids | No Copyright', 'The Ugly Duckling'],
    ['Bedtime Story | The Ugly Duckling (No Copyright)', 'The Ugly Duckling'],
    ['🐺 Little Red Riding Hood 🌙 #bedtimestories #nocopyright', 'Little Red Riding Hood'],
    ['Колобок | Сказка на ночь | Без авторских прав', 'Колобок'],
    ['12. Cinderella - Fairy Tale for Kids [Royalty Free]', 'Cinderella'],
    ['Fairy Tales for Kids — Thumbelina', 'Thumbelina'],
    ['The Tortoise and the Hare - Bedtime Story (Free to use)', 'The Tortoise and the Hare'],
    ['Hansel and Gretel | CC BY 4.0', 'Hansel and Gretel'],
  ])('turns %j into %j', (raw, expected) => {
    expect(cleanLinkTitle(raw)).toBe(expected);
  });

  it('keeps meaningful brackets and hyphenated words', () => {
    expect(cleanLinkTitle('Cinderella (Golden Book)')).toBe('Cinderella (Golden Book)');
    expect(cleanLinkTitle('Spider-Man and the Magic Hat')).toBe('Spider-Man and the Magic Hat');
  });

  it('falls back to the original text when everything looks like noise', () => {
    expect(cleanLinkTitle('No Copyright')).toBe('No Copyright');
  });

  it('limits very long titles', () => {
    expect(cleanLinkTitle('A'.repeat(300))).toHaveLength(120);
  });
});

describe('linkHost', () => {
  it('shows the site without common prefixes', () => {
    expect(linkHost('https://www.youtube.com/watch?v=x')).toBe('youtube.com');
    expect(linkHost('https://m.youtube.com/watch?v=x')).toBe('youtube.com');
    expect(linkHost('https://archive.org/download/a.mp3')).toBe('archive.org');
    expect(linkHost('bad')).toBe('');
  });
});
