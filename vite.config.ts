import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

// Copies docs/*.md next to the built page, so the footer links work on any host.
function copyDocs(): Plugin {
  return {
    name: 'copy-docs',
    apply: 'build',
    generateBundle() {
      const dir = resolve(import.meta.dirname, 'docs');
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md')) continue;
        this.emitFile({
          type: 'asset',
          fileName: `docs/${file}`,
          source: readFileSync(resolve(dir, file), 'utf8'),
        });
      }
    },
  };
}

// Built page only (the dev server needs its own websocket): no network access at all.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  // Relative asset paths, so the built site works from any sub-path.
  base: './',
  plugins: [copyDocs(), contentSecurityPolicy()],
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
