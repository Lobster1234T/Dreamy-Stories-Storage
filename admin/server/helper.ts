/**
 * Link helper for the admin website: the same "add by link" API as the local panel,
 * served on http://127.0.0.1:<LINK_HELPER_PORT> for the site on GitHub Pages.
 * Started by admin/start-helper.cmd; runs on plain Node (no npm install needed).
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINK_HELPER_PORT } from '../src/core/links.ts';
import { createLinkApiMiddleware, siteOrigins } from './linkAudioPlugin.ts';
import type { ApiLogger } from './linkAudioPlugin.ts';
import { createToolManager } from './tools.ts';

const adminDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(): string {
  try {
    return readFileSync(path.join(adminDir, '.env'), 'utf8');
  } catch {
    return '';
  }
}

const stamp = (): string => new Date().toLocaleTimeString('ru-RU');
const log: ApiLogger = {
  info: (message) => console.log(`${stamp()}  ${message}`),
  error: (message) => console.error(`${stamp()}  ОШИБКА: ${message}`),
};

const origins = siteOrigins(readEnvFile(), process.env.DREAMY_SITE_ORIGIN);
const tools = createToolManager({ dir: path.join(adminDir, '.tools'), log: log.info });
const handle = createLinkApiMiddleware(tools, log, { allowedOrigins: origins });

const server = createServer((req, res) => handle(req, res, () => {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Помощник админки: здесь только скачивание по ссылке.');
}));

server.on('error', (error: NodeJS.ErrnoException) => {
  log.error(error.code === 'EADDRINUSE'
    ? `порт ${LINK_HELPER_PORT} занят — помощник уже запущен в другом окне?`
    : error.message);
  process.exitCode = 1;
});

server.listen(LINK_HELPER_PORT, '127.0.0.1', () => {
  if (origins.length === 0) log.error('не нашёл адрес сайта: в admin/.env нет VITE_DEFAULT_REPO=владелец/репозиторий.');
  log.info(`Помощник запущен. Сайт ${origins.join(', ')} теперь может скачивать сказки по ссылке.`);
  log.info('Не закрывайте это окно, пока добавляете сказки. Чтобы остановить — закройте его.');
});
