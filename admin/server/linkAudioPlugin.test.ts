// @vitest-environment node
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLinkApiMiddleware, siteOrigins } from './linkAudioPlugin.ts';
import type { ToolManager, ToolsStatus } from './tools.ts';

const SITE = 'https://lobster1234t.github.io';
const STATUS: ToolsStatus = { supported: true, installed: false, ytDlpVersion: null, stale: false, progress: null };
const installs: boolean[] = [];
let failInstall = false;

const tools: ToolManager = {
  status: async () => STATUS,
  install: async (update) => {
    installs.push(update);
    if (failInstall) throw new Error('GitHub ответил 503');
    return { ...STATUS, installed: true, ytDlpVersion: '2026.10.26' };
  },
  paths: async () => null,
};

const middleware = createLinkApiMiddleware(tools, { info: () => {}, error: () => {} }, { allowedOrigins: [SITE] });
const server = createServer((req, res) => middleware(req, res, () => {
  res.writeHead(200);
  res.end('next');
}));
let port = 0;

interface Reply {
  readonly status: number;
  readonly text: string;
  readonly json: unknown;
  readonly headers: Record<string, string | string[] | undefined>;
}

function call(method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode ?? 0, text, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const panel = (): Record<string, string> => ({ 'x-dreamy-admin': '1', 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` });

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  installs.length = 0;
  failInstall = false;
});

describe('link API guard', () => {
  it('leaves other requests to the dev server', async () => {
    expect((await call('GET', '/index.html')).text).toBe('next');
  });

  it('rejects calls without the panel header or from another site', async () => {
    expect((await call('GET', '/__dreamy/tools')).status).toBe(403);
    expect((await call('GET', '/__dreamy/tools', { ...panel(), origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('GET', '/__dreamy/tools', { ...panel(), origin: 'not a url' })).status).toBe(403);
  });

  it('answers only on localhost, even for a DNS-rebinding page that looks same-origin', async () => {
    const rebinding = { ...panel(), host: `evil.example:${port}`, origin: `http://evil.example:${port}` };

    expect((await call('GET', '/__dreamy/tools', rebinding)).status).toBe(403);
    expect((await call('GET', '/__dreamy/tools', { ...panel(), host: `localhost:${port}`, origin: `http://localhost:${port}` })).status).toBe(200);
  });
});

describe('admin website through the helper', () => {
  const site = (): Record<string, string> => ({ ...panel(), origin: SITE });

  it('answers the CORS preflight of the website only', async () => {
    const preflight = { origin: SITE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-dreamy-admin' };

    const allowed = await call('OPTIONS', '/__dreamy/link-info', preflight);
    const foreign = await call('OPTIONS', '/__dreamy/link-info', { ...preflight, origin: 'https://evil.github.io' });

    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(SITE);
    expect(String(allowed.headers['access-control-allow-headers'])).toContain('x-dreamy-admin');
    expect(allowed.headers['access-control-allow-private-network']).toBe('true');
    expect(foreign.status).toBe(403);
  });

  it('serves the website with the allow-origin header', async () => {
    const reply = await call('GET', '/__dreamy/tools', site());

    expect(reply.status).toBe(200);
    expect(reply.headers['access-control-allow-origin']).toBe(SITE);
    expect((await call('GET', '/__dreamy/tools', { ...site(), origin: 'https://evil.github.io' })).status).toBe(403);
  });
});

describe('siteOrigins', () => {
  it('derives the GitHub Pages origin from admin/.env', () => {
    expect(siteOrigins('# panel\nVITE_DEFAULT_REPO=Lobster1234T/Dreamy-Stories-Storage\n', undefined)).toEqual([SITE]);
  });

  it('adds valid origins from DREAMY_SITE_ORIGIN and ignores junk', () => {
    expect(siteOrigins('VITE_DEFAULT_REPO=Lobster1234T/Dreamy-Stories-Storage', ' http://localhost:4173 , not a url, https://a.example/path ')).toEqual([
      SITE, 'http://localhost:4173', 'https://a.example',
    ]);
    expect(siteOrigins('', undefined)).toEqual([]);
    expect(siteOrigins('VITE_DEFAULT_REPO=bad owner/repo', undefined)).toEqual([]);
  });
});

describe('link API endpoints', () => {
  it('reports and installs the tools on request', async () => {
    expect((await call('GET', '/__dreamy/tools', panel())).json).toEqual(STATUS);

    const reply = await call('POST', '/__dreamy/tools/install', panel(), JSON.stringify({ update: true }));

    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({ installed: true, ytDlpVersion: '2026.10.26' });
    expect(installs).toEqual([true]);
  });

  it('turns a failed installation into a readable error', async () => {
    failInstall = true;

    const reply = await call('POST', '/__dreamy/tools/install', panel(), '{}');

    expect(reply.status).toBe(502);
    expect(reply.json).toEqual({ error: 'GitHub ответил 503' });
  });

  it('validates links and asks for the tools first', async () => {
    expect((await call('POST', '/__dreamy/link-info', panel(), JSON.stringify({ url: 'javascript:alert(1)' }))).status).toBe(400);
    expect((await call('POST', '/__dreamy/link-info', panel(), '{broken')).status).toBe(400);

    const reply = await call('POST', '/__dreamy/link-audio', panel(), JSON.stringify({ url: 'https://youtu.be/abc' }));

    expect(reply.status).toBe(409);
    expect(reply.json).toEqual({ error: 'Сначала установите инструменты для скачивания.' });
  });

  it('refuses unknown endpoints and oversized requests', async () => {
    expect((await call('GET', '/__dreamy/nope', panel())).status).toBe(404);
    expect((await call('POST', '/__dreamy/link-info', panel(), JSON.stringify({ url: `https://a.com/${'x'.repeat(9000)}` }))).status).toBe(413);
  });
});
