// @vitest-environment node
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLinkApiMiddleware } from './linkAudioPlugin.ts';
import type { ToolManager, ToolsStatus } from './tools.ts';

const STATUS: ToolsStatus = { supported: true, installed: false, ytDlpVersion: null, stale: false };
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

const middleware = createLinkApiMiddleware(tools, { info: () => {}, error: () => {} });
const server = createServer((req, res) => middleware(req, res, () => {
  res.writeHead(200);
  res.end('next');
}));
let port = 0;

interface Reply {
  readonly status: number;
  readonly text: string;
  readonly json: unknown;
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
        resolve({ status: res.statusCode ?? 0, text, json });
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
