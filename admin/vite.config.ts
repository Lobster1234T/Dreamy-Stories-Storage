import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { linkAudioPlugin } from './server/linkAudioPlugin.ts';
import { LINK_HELPER_PORT } from './src/core/links.ts';

/**
 * Content-Security-Policy is injected only into the production build:
 * the dev server needs inline scripts for React Fast Refresh.
 * The token lives in browser storage, so we lock down where scripts
 * may come from and where requests may go.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://raw.githubusercontent.com blob: data:",
  "media-src 'self' https://raw.githubusercontent.com blob:",
  // raw.githubusercontent.com: file contents in token-less modes (no API quota).
  // 127.0.0.1: the link helper on this computer (start-helper.cmd) for "add by link".
  `connect-src 'self' https://api.github.com https://raw.githubusercontent.com http://127.0.0.1:${LINK_HELPER_PORT}`,
  "font-src 'self' data:",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  // No upgrade-insecure-requests: it would rewrite the helper's http://127.0.0.1 to https.
  // GitHub Pages already forces HTTPS for the page and every other URL here is https.
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative base: works on GitHub Pages (/<repo>/) and when served from any folder.
  base: './',
  // linkAudioPlugin: "add by link" downloads on this computer; dev server only (start-admin.cmd).
  plugins: [react(), cspPlugin(), linkAudioPlugin()],
  // Downloaded tools and coverage reports are not part of the app: no reloads when they change.
  server: { watch: { ignored: ['**/.tools/**', '**/coverage/**'] } },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/github/**', 'src/store/**', 'src/media/**'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
