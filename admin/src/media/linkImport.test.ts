import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadLinkAudio, fetchLinkInfo, getToolsStatus, installTools, parseLinkInfo, parseToolsStatus } from './linkImport.ts';

interface FakeReply {
  readonly status?: number;
  readonly json?: unknown;
  readonly blob?: Blob;
}

type Step = Response | { readonly throws: unknown };

function reply({ status = 200, json, blob }: FakeReply): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (json === undefined) throw new SyntaxError('not json');
      return json;
    },
    blob: async () => blob ?? new Blob([]),
  } as unknown as Response;
}

function stubFetch(...steps: Step[]): Array<{ url: string; init: RequestInit }> {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue = [...steps];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    if ('throws' in next) throw next.throws;
    return next;
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tools', () => {
  it('reads the status with the panel header', async () => {
    const status = { supported: true, installed: false, ytDlpVersion: null, stale: false, progress: null };
    const calls = stubFetch(reply({ json: status }));

    expect(await getToolsStatus()).toEqual(status);
    expect(calls[0].url).toBe('/__dreamy/tools');
    expect((calls[0].init.headers as Record<string, string>)['x-dreamy-admin']).toBe('1');
  });

  it('asks the local server to install or update the tools', async () => {
    const calls = stubFetch(reply({ json: { supported: true, installed: true, ytDlpVersion: '2026.10.26', stale: false } }));

    expect((await installTools(true)).ytDlpVersion).toBe('2026.10.26');
    expect(calls[0].init).toMatchObject({ method: 'POST', body: JSON.stringify({ update: true }) });
  });
});

describe('links', () => {
  it('parses link info and drops entries without a link', async () => {
    const entry = { url: 'https://youtu.be/a', title: 'A', duration: 61, uploader: 'U', license: '' };
    stubFetch(reply({ json: { title: 'List', isPlaylist: true, entries: [entry, { title: 'no url' }, 'junk'] } }));

    const info = await fetchLinkInfo('https://www.youtube.com/playlist?list=x');

    expect(info).toEqual({ title: 'List', isPlaylist: true, entries: [entry] });
  });

  it('returns the audio as an MP3 file named after the title', async () => {
    stubFetch(reply({ blob: new Blob(['mp3 bytes'], { type: 'audio/mpeg' }) }));

    const file = await downloadLinkAudio('https://youtu.be/a', 'Гадкий утёнок');

    expect(file.name).toMatch(/^[a-z0-9-]+\.mp3$/);
    expect(file.type).toBe('audio/mpeg');
    expect(file.size).toBe(9);
  });

  it('rejects an empty file', async () => {
    stubFetch(reply({ blob: new Blob([]) }));

    await expect(downloadLinkAudio('https://youtu.be/a', 'A')).rejects.toThrow(/пустой/);
  });
});

describe('errors', () => {
  it('shows the message the local server sent', async () => {
    stubFetch(reply({ status: 422, json: { error: 'Видео приватное — скачать нельзя.' } }));

    await expect(fetchLinkInfo('https://youtu.be/a')).rejects.toThrow('Видео приватное — скачать нельзя.');
  });

  it('explains a missing local server and network failures', async () => {
    stubFetch(reply({ status: 404 }), reply({ status: 500 }), { throws: new TypeError('Failed to fetch') });

    await expect(getToolsStatus()).rejects.toThrow(/start-admin\.cmd/);
    await expect(getToolsStatus()).rejects.toThrow(/500/);
    await expect(getToolsStatus()).rejects.toThrow(/Нет связи/);
  });

  it('passes a cancelled request through untouched', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new Error('aborted');
    stubFetch({ throws: abort });

    await expect(fetchLinkInfo('https://youtu.be/a', controller.signal)).rejects.toBe(abort);
  });

  it('rejects odd answers', () => {
    expect(() => parseToolsStatus(null)).toThrow();
    expect(() => parseLinkInfo({ entries: 'x' })).toThrow();
    expect(parseToolsStatus({ supported: 'yes', progress: { label: 1 } })).toEqual({ supported: false, installed: false, ytDlpVersion: null, stale: false, progress: null });
  });

  it('reads installation progress', () => {
    expect(parseToolsStatus({ supported: true, progress: { label: 'ffmpeg 6.1.1', received: 10, total: 'x' } }).progress)
      .toEqual({ label: 'ffmpeg 6.1.1', received: 10, total: null });
  });
});
