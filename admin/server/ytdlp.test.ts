import { describe, expect, it } from 'vitest';
import {
  downloadArgs,
  friendlyError,
  infoArgs,
  MAX_PLAYLIST_ITEMS,
  mp3Args,
  needsConversion,
  parseChecksums,
  parseInfo,
  pickDownloadedFile,
} from './ytdlp.ts';

const OPTIONS = { nodePath: 'C:\\Program Files\\nodejs\\node.exe' };
const VIDEO = 'https://www.youtube.com/watch?v=abc123';

describe('command lines', () => {
  it('ends option parsing before the link and enables Node for YouTube', () => {
    const args = infoArgs('-o evil', OPTIONS);

    expect(args.slice(-2)).toEqual(['--', '-o evil']);
    expect(args).toContain('--ignore-config');
    expect(args).toContain(`node:${OPTIONS.nodePath}`);
    expect(args).toContain(`1:${MAX_PLAYLIST_ITEMS}`);
  });

  it('downloads one audio stream with the bundled ffmpeg', () => {
    const args = downloadArgs(VIDEO, 'C:\\tmp\\source.%(ext)s', 'C:\\tools', OPTIONS);

    expect(args.slice(-2)).toEqual(['--', VIDEO]);
    expect(args).toEqual(expect.arrayContaining(['--no-playlist', 'bestaudio/best', '--ffmpeg-location', 'C:\\tools', 'C:\\tmp\\source.%(ext)s']));
    expect(args[args.indexOf('--playlist-items') + 1]).toBe('1');
  });

  it('converts the first audio stream to a 128k MP3 without tags', () => {
    const args = mp3Args('in.webm', 'out.mp3');

    expect(args).toEqual(expect.arrayContaining(['-nostdin', 'libmp3lame', '128k', '-map_metadata']));
    expect(args.at(-1)).toBe('out.mp3');
    expect(args[args.indexOf('-i') + 1]).toBe('in.webm');
  });
});

describe('downloaded files', () => {
  it('keeps MP3 files and converts the rest', () => {
    expect(needsConversion('source.mp3')).toBe(false);
    expect(needsConversion('source.MP3')).toBe(false);
    expect(needsConversion('source.m4a')).toBe(true);
    expect(needsConversion('source.webm')).toBe(true);
  });

  it('skips partial and temporary files', () => {
    expect(pickDownloadedFile(['source.webm.part', 'source.webm.ytdl', 'source.webm'], 'source.')).toBe('source.webm');
    expect(pickDownloadedFile(['source.m4a.part-Frag3', 'other.mp3'], 'source.')).toBeNull();
  });
});

describe('parseInfo', () => {
  it('describes a single video', () => {
    const info = parseInfo({ title: 'Cinderella', duration: 754.4, channel: 'Tales', license: 'Creative Commons Attribution license (reuse allowed)', webpage_url: VIDEO }, VIDEO);

    expect(info).toEqual({
      title: 'Cinderella',
      isPlaylist: false,
      entries: [{ url: VIDEO, title: 'Cinderella', duration: 754, uploader: 'Tales', license: 'Creative Commons Attribution license (reuse allowed)' }],
    });
  });

  it('lists playlist entries and drops private or deleted videos', () => {
    const info = parseInfo({
      _type: 'playlist',
      title: 'Bedtime stories',
      entries: [
        { url: 'https://www.youtube.com/watch?v=1', title: 'One', duration: 60, uploader: 'U' },
        { url: 'https://www.youtube.com/watch?v=2', title: '[Private video]' },
        { url: 'not a url', title: 'Broken' },
        null,
      ],
    }, 'https://www.youtube.com/playlist?list=x');

    expect(info.isPlaylist).toBe(true);
    expect(info.title).toBe('Bedtime stories');
    expect(info.entries).toEqual([{ url: 'https://www.youtube.com/watch?v=1', title: 'One', duration: 60, uploader: 'U', license: '' }]);
  });

  it('falls back to the requested link and rejects garbage', () => {
    expect(parseInfo({ title: '' }, VIDEO).entries[0]).toMatchObject({ url: VIDEO, title: VIDEO, duration: null });
    expect(() => parseInfo('nope', VIDEO)).toThrow();
  });
});

describe('parseChecksums', () => {
  it('reads sha256 lines and ignores the rest', () => {
    const hash = 'a'.repeat(64);
    const sums = parseChecksums(`${hash}  yt-dlp.exe\r\n${'B'.repeat(64)} *yt-dlp_macos\nnot a checksum\n`);

    expect(sums.get('yt-dlp.exe')).toBe(hash);
    expect(sums.get('yt-dlp_macos')).toBe('b'.repeat(64));
    expect(sums.size).toBe(2);
  });
});

describe('friendlyError', () => {
  it('explains common failures in plain words', () => {
    expect(friendlyError("ERROR: [youtube] abc: Sign in to confirm you're not a bot")).toMatch(/не бот/);
    expect(friendlyError('ERROR: [youtube] abc: Sign in to confirm your age')).toMatch(/возрастным/);
    expect(friendlyError('ERROR: [youtube] abc: Private video. Sign in if you have access')).toMatch(/приватное/);
    expect(friendlyError('ERROR: Unsupported URL: https://example.com')).toMatch(/не поддерживается/);
    expect(friendlyError('ERROR: unable to download: HTTP Error 404: Not Found')).toMatch(/404/);
  });

  it('falls back to the last error line', () => {
    expect(friendlyError('WARNING: x\nERROR: something odd happened\n')).toBe('Не удалось скачать: something odd happened');
    expect(friendlyError('')).toBe('Не удалось скачать по ссылке.');
  });
});
