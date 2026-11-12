import { defineConfig, type Plugin } from 'vitest/config';

// Built page only (the dev server needs its own websocket): the page may load its own
// script and stylesheet and nothing else. default-src 'none' covers every fetch
// directive that is not listed (connections, fonts, media, frames, objects, workers,
// manifests), so the browser blocks even a same-origin image or request. The only
// image is the inline icon, a data: URL. The docs stay in the repository; the page
// explains itself in its "How it works" dialog.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  'img-src data:',
  "base-uri 'none'",
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
  plugins: [contentSecurityPolicy()],
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
