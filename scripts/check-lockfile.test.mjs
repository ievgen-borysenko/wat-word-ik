import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIME_LICENSES, auditLockfile, licenseAllowed } from './check-lockfile.mjs';

const SCRIPT = resolve(import.meta.dirname, 'check-lockfile.mjs');
const INTEGRITY = `sha512-${'A'.repeat(86)}==`;

/**
 * @param {string} name
 * @param {Record<string, unknown>} [extra]
 */
const pkg = (name, extra = {}) => ({
  version: '1.0.0',
  resolved: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
  integrity: INTEGRITY,
  license: 'MIT',
  ...extra,
});

/** @param {Record<string, Record<string, unknown>>} [packages] */
const lock = (packages = {}) => ({
  name: 'x',
  lockfileVersion: 3,
  packages: {
    '': { name: 'x', version: '0.0.0' },
    'node_modules/preact': pkg('preact'),
    'node_modules/vite': pkg('vite', { dev: true, license: 'MIT' }),
    ...packages,
  },
});

/** @param {ReturnType<typeof lock>} l */
const rules = (l) => auditLockfile(l).violations.map((v) => `${v.pkg} ${v.rule}`);

describe('check-lockfile', () => {
  it('passes a clean lockfile', () => {
    const r = auditLockfile(lock());
    expect(r.violations).toEqual([]);
    expect(r.checked).toBe(2);
    expect(r.runtime).toEqual([{ pkg: 'preact@1.0.0', license: 'MIT' }]);
  });

  it.each([
    'https://registry.yarnpkg.com/a/-/a-1.0.0.tgz',
    'http://registry.npmjs.org/a/-/a-1.0.0.tgz',
    'https://registry.npmjs.org.evil.example/a/-/a-1.0.0.tgz',
    // Put together at run time: the tree check refuses anything shaped like an e-mail address.
    `git+ssh://${['git', 'github.com'].join('@')}/someone/a.git#abc`,
    'file:../a',
  ])('rejects a package resolved from %s', (resolved) => {
    expect(rules(lock({ 'node_modules/a': pkg('a', { resolved }) }))).toEqual(['node_modules/a source']);
  });

  it('rejects a package without resolved', () => {
    expect(rules(lock({ 'node_modules/a': pkg('a', { resolved: undefined }) }))).toEqual(['node_modules/a source']);
  });

  it('rejects a link', () => {
    expect(rules(lock({ 'node_modules/a': { resolved: 'packages/a', link: true } }))).toEqual(['node_modules/a source']);
  });

  it('rejects a missing or weak integrity hash', () => {
    const l = lock({
      'node_modules/a': pkg('a', { integrity: undefined }),
      'node_modules/b': pkg('b', { integrity: 'sha1-abcdefabcdefabcdefabcdefabc=' }),
    });
    expect(rules(l)).toEqual(['node_modules/a integrity', 'node_modules/b integrity']);
  });

  it('accepts a bundled dependency without its own download', () => {
    const l = lock({ 'node_modules/a/node_modules/b': { version: '1.0.0', inBundle: true, license: 'ISC' } });
    expect(rules(l)).toEqual([]);
  });

  it.each(['GPL-3.0-only', 'AGPL-3.0', 'MPL-2.0', 'UNLICENSED', 'SEE LICENSE IN LICENSE.txt', 'MIT AND GPL-2.0'])(
    'rejects a runtime package licensed %s',
    (license) => {
      expect(rules(lock({ 'node_modules/a': pkg('a', { license }) }))).toEqual(['node_modules/a license']);
    },
  );

  it('rejects a runtime package without a licence', () => {
    expect(rules(lock({ 'node_modules/a': pkg('a', { license: undefined }) }))).toEqual(['node_modules/a license']);
  });

  it('counts optional and devOptional packages as runtime, dev ones (also dev and optional) not', () => {
    // devOptional: a dev dependency that is also an optional dependency of a
    // runtime package, so it can end up in the page.
    const l = lock({
      'node_modules/a': pkg('a', { optional: true, license: 'GPL-3.0-only' }),
      'node_modules/b': pkg('b', { devOptional: true, optional: true, license: 'GPL-3.0-only' }),
      'node_modules/c': pkg('c', { dev: true, license: 'MPL-2.0' }),
      'node_modules/d': pkg('d', { dev: true, optional: true, license: 'MPL-2.0' }),
      'node_modules/e': pkg('e', { devOptional: true, license: undefined }),
    });
    expect(rules(l)).toEqual(['node_modules/a license', 'node_modules/b license', 'node_modules/e license']);
  });

  it('rejects an old lockfile format', () => {
    expect(auditLockfile({ lockfileVersion: 1 }).violations.map((v) => v.rule)).toEqual(['format']);
  });

  it.each([
    ['MIT', true],
    ['(MIT OR Apache-2.0)', true],
    ['(GPL-3.0-only OR MIT)', true],
    ['MIT AND ISC', true],
    ['(MIT AND GPL-2.0-only)', false],
    ['Apache-2.0 WITH LLVM-exception', false],
    ['(MIT', false],
    ['MIT OR', false],
    ['', false],
  ])('licence expression %s allowed: %s', (expr, ok) => {
    expect(licenseAllowed(expr, RUNTIME_LICENSES)).toBe(ok);
  });

  describe('command line', () => {
    /** @type {string[]} */
    const made = [];
    afterEach(() => {
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
    });
    /** @param {string} content */
    const run = (content) => {
      const dir = mkdtempSync(join(tmpdir(), 'check-lock-'));
      made.push(dir);
      const file = join(dir, 'package-lock.json');
      writeFileSync(file, content);
      return spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
    };

    it('exits 0 on a clean lockfile', () => {
      const r = run(JSON.stringify(lock()));
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('preact@1.0.0 (MIT)');
    });

    it('exits 1 and lists every violation', () => {
      const r = run(JSON.stringify(lock({ 'node_modules/a': pkg('a', { resolved: 'file:../a', license: 'GPL-3.0-only' }) })));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('[source]');
      expect(r.stderr).toContain('[license]');
    });

    it('exits 2 on unreadable JSON', () => {
      expect(run('{').status).toBe(2);
    });
  });
});
