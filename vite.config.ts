import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { formatNotice, splitLicence } from './scripts/check-dist.mjs';
import { runtimePackages } from './scripts/check-lockfile.mjs';

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

// Licence notices of the bundled code, as one legal comment at the top of the entry
// script, added after minification so that it stays as written. It covers every
// runtime package of the lockfile (the set check:lock checks), with the version,
// the copyright lines and the licence text read from the installed package. The
// format and the check of the built site (check:dist) are in scripts/check-dist.mjs.
// The build fails when a package is not installed at its locked version or has no
// licence file or copyright line, and when the bundle holds code from a package
// that is not a runtime package of the lockfile.
function licenceNotice(): Plugin {
  let root = '';
  let notice = '';
  let runtimeNames = new Set<string>();
  return {
    name: 'licence-notice',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      const runtime = runtimePackages(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')));
      runtimeNames = new Set(runtime.map((p) => p.name));
      const entries = runtime.map((p) => {
        const dir = join(root, p.path);
        const installed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
        if (installed !== p.version) {
          this.error(`${p.name} is installed at ${String(installed)}, the lockfile has ${p.version}; run npm ci`);
        }
        const file = readdirSync(dir).find((f) => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(f));
        if (file === undefined) this.error(`${p.name} has no licence file, so its notice cannot be written`);
        return { ...p, ...splitLicence(readFileSync(join(dir, file), 'utf8')) };
      });
      try {
        notice = formatNotice(entries);
      } catch (err) {
        this.error(err instanceof Error ? err.message : String(err));
      }
    },
    outputOptions(options) {
      return { ...options, postBanner: (chunk) => (chunk.isEntry ? notice : '') };
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const id of chunk.moduleIds) {
          const name = bundledPackage(id);
          if (name !== null && !runtimeNames.has(name)) {
            this.error(`${chunk.fileName} bundles code from ${name}, which is not a runtime package of the lockfile, so it has no licence notice`);
          }
        }
      }
    },
  };
}

/** The package a module belongs to (after the last node_modules folder in its id), or null. */
function bundledPackage(id: string): string | null {
  const parts = id.replaceAll('\\', '/').split('/node_modules/');
  if (parts.length < 2) return null;
  const [first = '', second = ''] = (parts.at(-1) ?? '').split('/');
  return first.startsWith('@') ? `${first}/${second}` : first;
}

export default defineConfig({
  // Relative asset paths, so the built site works from any sub-path.
  base: './',
  plugins: [contentSecurityPolicy(), licenceNotice()],
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
