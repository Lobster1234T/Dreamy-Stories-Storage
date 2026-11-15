import { describe, expect, it } from 'vitest';
import { hasNumberPrefix, leadingNumber, numberedName, stripNumber, titleFromFileName } from './titles.ts';
import { isValidId, slugify, uniqueSlug } from './slug.ts';

describe('titles', () => {
  it.each([
    ['1. Рапунцель', 'Рапунцель'],
    ['4.Tres cerditos', 'Tres cerditos'],
    ['12) Foo', 'Foo'],
    ['  7 . Bar ', 'Bar'],
    ['28. 3 Dancing Princesses', '3 Dancing Princesses'],
    ['Unbekannte Geschichte', 'Unbekannte Geschichte'],
    ['3 Dancing Princesses', '3 Dancing Princesses'],
  ])('strips the number prefix from %s', (input, expected) => {
    expect(stripNumber(input)).toBe(expected);
  });

  it('detects a number prefix', () => {
    expect(hasNumberPrefix('5. X')).toBe(true);
    expect(hasNumberPrefix('X 5.')).toBe(false);
  });

  it('builds a 1-based numbered name', () => {
    expect(numberedName(0, ' Rapunzel ')).toBe('1. Rapunzel');
    expect(numberedName(51, 'Tiddalik')).toBe('52. Tiddalik');
  });

  it('derives a title from an uploaded file name', () => {
    expect(titleFromFileName('12. Der Löwe und die Maus.mp3')).toBe('Der Löwe und die Maus');
    expect(titleFromFileName('the_lost_dragon.MP3')).toBe('the lost dragon');
    expect(titleFromFileName('7.mp3')).toBe('7');
  });

  it('reads the leading number of a file name', () => {
    expect(leadingNumber('12. Der Löwe.mp3')).toBe(12);
    expect(leadingNumber('36.mp3')).toBe(36);
    expect(leadingNumber('Mermaid.mp3')).toBeNull();
    expect(leadingNumber('2026x')).toBe(2026);
  });
});

describe('slugify', () => {
  it.each([
    ['The Princess and the Pea', 'the-princess-and-the-pea'],
    ["Mother Holle's Surprise", 'mother-holles-surprise'],
    ['Рапунцель', 'rapuntsel'],
    ['Щелкунчик и Мышиный король', 'schelkunchik-i-myshinyy-korol'],
    ['Hänsel und Gretel', 'hansel-und-gretel'],
    ['Die Gänse-Liesel', 'die-ganse-liesel'],
    ['Süßer Brei', 'susser-brei'],
    ['Tom & Jerry', 'tom-and-jerry'],
    ['  !!!  ', ''],
    ['Un Œil, Deux Yeux', 'un-oeil-deux-yeux'],
  ])('slugifies %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('respects the max length without a trailing dash', () => {
    const slug = slugify('a very long title that keeps going and going forever', 20);
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('makes slugs unique', () => {
    expect(uniqueSlug('rapunzel', new Set())).toBe('rapunzel');
    expect(uniqueSlug('rapunzel', new Set(['rapunzel', 'rapunzel-2']))).toBe('rapunzel-3');
    expect(uniqueSlug('', new Set())).toBe('item');
  });

  it('validates ids', () => {
    expect(isValidId('the-lost-dragon')).toBe(true);
    expect(isValidId('Bad Id')).toBe(false);
    expect(isValidId('-x')).toBe(false);
    expect(isValidId('')).toBe(false);
  });
});
