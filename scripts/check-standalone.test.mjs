import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/*
 * The audit job in CI installs no dependencies, so that no package code can
 * rewrite what it audits. The check scripts must therefore run on Node alone:
 * they may import Node's own modules (`node:`) and each other, nothing else.
 */
const DIR = import.meta.dirname;
const SCRIPTS = readdirSync(DIR)
  .filter((f) => /^check-[a-z]+\.mjs$/.test(f))
  .sort();

/** Every module specifier in a file: static imports and re-exports, dynamic imports, require calls. */
function specifiers(/** @type {string} */ text) {
  const found = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/gm)) found.push(m[2] ?? '');
  for (const m of text.matchAll(/^\s*import\s*(['"])([^'"]+)\1/gm)) found.push(m[2] ?? '');
  for (const m of text.matchAll(/\bimport\s*\(\s*([^)]*)\)/g)) found.push(m[1] ?? '');
  for (const m of text.matchAll(/\b(?:require|createRequire)\s*\(\s*([^)]*)\)/g)) found.push(`require ${m[1] ?? ''}`);
  return found;
}

/** @type {string[]} */
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe('check scripts run on Node alone', () => {
  it('finds the check scripts', () => {
    expect(SCRIPTS).toEqual(
      expect.arrayContaining(['check-commits.mjs', 'check-data.mjs', 'check-dist.mjs', 'check-links.mjs', 'check-lockfile.mjs', 'check-tree.mjs']),
    );
  });

  it.each(SCRIPTS)('%s imports only node: modules and other check scripts', (file) => {
    const found = specifiers(readFileSync(join(DIR, file), 'utf8'));
    expect(found.length).toBeGreaterThan(0);
    for (const spec of found) expect(spec, file).toMatch(/^node:[a-z/_]+$|^\.\/check-[a-z]+\.mjs$/);
  });

  it('the import scan sees what it must refuse', () => {
    const bad = [
      "import { x } from 'vite';",
      'import "some-package";',
      "export * from '../src/thing.ts';",
      'const m = await import("pkg");',
      "const r = createRequire(import.meta.url); r('pkg');",
    ].join('\n');
    expect(specifiers(bad)).toEqual(['vite', '../src/thing.ts', 'some-package', '"pkg"', 'require import.meta.url']);
  });

  it('every check script loads from a folder with no node_modules anywhere above it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-standalone-'));
    made.push(dir);
    for (let d = dir; d !== dirname(d); d = dirname(d)) expect(existsSync(join(d, 'node_modules')), d).toBe(false);
    for (const file of SCRIPTS) copyFileSync(join(DIR, file), join(dir, file));
    for (const file of SCRIPTS) {
      // Importing runs no check (each script runs only as the main module), but it loads every import.
      const res = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(dir, file)).href)});`], {
        cwd: dir,
        env: { PATH: process.env.PATH ?? '' },
        encoding: 'utf8',
      });
      expect(res.status, `${file}: ${res.stderr}`).toBe(0);
    }
  });
});
