import { afterEach, describe, expect, it } from 'vitest';
import { clearAuth, defaultCoords, isValidCoords, loadSavedAuth, parseSavedAuth, repoKey, saveAuth } from './auth.ts';
import { memoize } from './selectors.ts';
import {
  audioUploadPath,
  computeTargetSize,
  imageUploadPath,
  processImage,
  readAudioDuration,
  validateAudioFile,
  validateImageFile,
} from '../media/media.ts';
import { DEFAULT_MEDIA } from '../core/config.ts';
import { makeConfig } from '../test/fixtures.ts';
import { clearBlobs, getBlob, localPreviewUrl, putBlob, restoreBlobs } from './persistence.ts';

const coords = { owner: 'Lobster', repo: 'Dreamy-Stories', branch: 'main' };

afterEach(() => clearAuth());

describe('auth storage', () => {
  it('validates coordinates', () => {
    expect(isValidCoords(coords)).toBe(true);
    expect(isValidCoords({ ...coords, owner: 'bad owner' })).toBe(false);
    expect(isValidCoords({ ...coords, repo: '..' })).toBe(false);
    expect(isValidCoords({ ...coords, branch: 'feature/x' })).toBe(true);
    expect(isValidCoords({ ...coords, branch: 'a..b' })).toBe(false);
  });

  it('saves to local or session storage and reads it back', () => {
    saveAuth({ coords, mode: 'github', token: 'tkn' }, true);
    expect(window.localStorage.length).toBe(1);
    expect(loadSavedAuth()).toEqual({ coords, mode: 'github', token: 'tkn' });
    saveAuth({ coords, mode: 'readonly', token: null }, false);
    expect(window.localStorage.length).toBe(0);
    expect(loadSavedAuth()?.mode).toBe('readonly');
    clearAuth();
    expect(loadSavedAuth()).toBeNull();
  });

  it('ignores malformed saved data', () => {
    expect(parseSavedAuth(null)).toBeNull();
    expect(parseSavedAuth({ coords, mode: 'hacker' })).toBeNull();
    expect(parseSavedAuth({ coords: { owner: '', repo: 'x', branch: 'main' }, mode: 'github' })).toBeNull();
    expect(parseSavedAuth({ coords, mode: 'sandbox', token: '  ' })).toEqual({ coords, mode: 'sandbox', token: null });
    window.localStorage.setItem('dreamy-admin:auth:v1', '{broken');
    expect(loadSavedAuth()).toBeNull();
  });

  it('derives the repository from a GitHub Pages URL or a fallback', () => {
    expect(defaultCoords('lobster1234t.github.io', '/Dreamy-Stories-Storage/', undefined))
      .toEqual({ owner: 'lobster1234t', repo: 'Dreamy-Stories-Storage', branch: 'main' });
    expect(defaultCoords('localhost', '/', 'me/repo')).toEqual({ owner: 'me', repo: 'repo', branch: 'main' });
    expect(defaultCoords('localhost', '/', undefined)).toEqual({ owner: '', repo: '', branch: 'main' });
    expect(repoKey(coords, 'sandbox')).toBe('sandbox:lobster/dreamy-stories@main');
  });
});

describe('memoize', () => {
  it('returns the cached result for identical arguments', () => {
    let calls = 0;
    const double = memoize((value: { n: number }) => {
      calls += 1;
      return { n: value.n * 2 };
    });
    const input = { n: 2 };
    expect(double(input)).toBe(double(input));
    expect(calls).toBe(1);
    double({ n: 2 });
    expect(calls).toBe(2);
  });
});

describe('media helpers', () => {
  it('computes crop and scale', () => {
    expect(computeTargetSize(2000, 1000, 512, true)).toEqual({ sx: 500, sy: 0, sw: 1000, sh: 1000, width: 512, height: 512 });
    expect(computeTargetSize(400, 300, 512, false)).toEqual({ sx: 0, sy: 0, sw: 400, sh: 300, width: 400, height: 300 });
    expect(computeTargetSize(4000, 2000, 0, false).width).toBe(4000);
  });

  it('validates files', () => {
    expect(validateAudioFile(new File(['x'], 'a.mp3', { type: 'audio/mpeg' }))).toBeNull();
    expect(validateAudioFile(new File(['x'], 'a.wav', { type: 'audio/wav' }))).toMatch(/MP3/);
    const huge = new File(['x'], 'big.mp3', { type: 'audio/mpeg' });
    Object.defineProperty(huge, 'size', { value: 120 * 1024 * 1024 });
    expect(validateAudioFile(huge)).toMatch(/лимита GitHub/);
    expect(validateImageFile(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull();
    expect(validateImageFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).toMatch(/картинка/);
  });

  it('builds hashed upload paths', async () => {
    const config = makeConfig();
    const blob = new Blob(['hello'], { type: 'image/png' });
    expect(await audioUploadPath(config, 'stories', 'ru', 'rapunzel', blob)).toBe('stories/ru/rapunzel-aaf4c61d.mp3');
    expect(await audioUploadPath(config, 'lullabies', 'ru', 'moon', blob)).toBe('lullabies/moon-aaf4c61d.mp3');
    expect(await imageUploadPath(config, 'stories', 'rapunzel', blob)).toBe('images/rapunzel-aaf4c61d.png');
    expect(await imageUploadPath(config, 'lullabies', 'moon', new Blob(['hello'], { type: 'image/jpeg' }))).toBe('lullaby_images/moon-aaf4c61d.jpg');
  });

  it('falls back gracefully where the browser APIs are missing', async () => {
    const file = new Blob(['x'], { type: 'image/png' });
    expect(await processImage(file, DEFAULT_MEDIA)).toBe(file);
    expect(await readAudioDuration(new Blob(['x']))).toBeNull();
  });
});

describe('pending upload storage', () => {
  it('stores, restores and clears files', async () => {
    await putBlob('repo', 'images/a.jpg', new Blob(['a']));
    expect(await getBlob('repo', 'images/a.jpg')).not.toBeNull();
    await clearBlobs('repo', ['images/a.jpg']);
    expect(await getBlob('repo', 'images/a.jpg')).toBeNull();
    await restoreBlobs('repo', ['missing.jpg']);
    expect(localPreviewUrl('repo', 'missing.jpg')).toBeNull();
    await putBlob('repo-a', 'images/b.jpg', new Blob(['b']));
    expect(await getBlob('repo-b', 'images/b.jpg')).toBeNull();
  });
});
