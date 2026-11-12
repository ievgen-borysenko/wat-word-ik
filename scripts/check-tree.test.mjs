import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTree, onList } from './check-tree.mjs';

/*
 * The strings this check refuses (e-mail addresses, home folders, key headers)
 * are put together at run time, so this file holds none of them.
 */
const AT = '@';
const SCRIPT = resolve(import.meta.dirname, 'check-tree.mjs');

/** @type {string[]} */
const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CLEAN = {
  'README.md': '# Title\n',
  'package.json': '{}\n',
  'src/main.tsx': 'export {};\n',
  'src/ui/App.tsx': 'export {};\n',
  'src/ui/store.test.ts': 'export {};\n',
  'src/i18n/nl.json': '{}\n',
  'scripts/check-tree.mjs': '// x\n',
  'e2e/smoke.spec.ts': 'export {};\n',
  'docs/ci.md': '# CI\n',
  '.github/workflows/ci.yml': 'name: CI\n',
};

/**
 * A throw-away repository in its own temp directory, with the files staged
 * (check:tree reads the index, so no commit is needed). Git runs without the
 * machine's global or system config and without inherited GIT_* variables.
 * @param {Record<string, string>} [extra]
 */
function repo(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-tree-'));
  made.push(root);
  const dir = join(root, 'repo');
  mkdirSync(dir);
  const gitconfig = join(root, 'gitconfig');
  writeFileSync(gitconfig, '');
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, LANG: 'C', GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };
  /** @param {string[]} args */
  const git = (args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--quiet', '--initial-branch=main']);
  for (const [path, content] of Object.entries({ ...CLEAN, ...extra })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(['add', '--all']);
  return { dir, env, git };
}

/** @param {ReturnType<typeof repo>} r */
const rules = (r) => checkTree(r.dir, r.env).violations.map((v) => `${v.path} ${v.rule}`);

describe('check-tree', () => {
  it('passes a tree of listed files', () => {
    const r = repo();
    const result = checkTree(r.dir, r.env);
    expect(result.violations).toEqual([]);
    expect(result.checked).toBe(Object.keys(CLEAN).length);
  });

  it.each([
    'notes.md',
    'TODO.txt',
    'dump.sql',
    'scratch/try.js',
    '.tool/config.json',
    '.editor/settings.json',
    'docs/draft.md',
    'src/extra/thing.ts',
    'src/ui/App.tsx.orig',
    'scripts/helper.sh',
    'e2e/report.html',
    '.github/workflows/other.yml',
    '.env',
  ])('refuses %s, which is not on the list', (path) => {
    const r = repo({ [path]: 'x\n' });
    expect(rules(r)).toEqual([`${path} not-listed`]);
    const message = checkTree(r.dir, r.env).violations[0]?.message ?? '';
    expect(message).toContain('not on the list');
    expect(message).toContain('same pull request');
  });

  it('lists every root file it allows by exact name only', () => {
    expect(onList('README.md')).toBe(true);
    expect(onList('docs/README.md')).toBe(false);
    expect(onList('README.md.bak')).toBe(false);
    expect(onList('package.json')).toBe(true);
    expect(onList('src/package.json')).toBe(false);
  });

  it('refuses an executable file', () => {
    const r = repo();
    r.git(['update-index', '--chmod=+x', 'scripts/check-tree.mjs']);
    expect(rules(r)).toEqual(['scripts/check-tree.mjs executable']);
  });

  it('refuses a symlink', () => {
    const r = repo();
    symlinkSync('README.md', join(r.dir, 'docs', 'methodology.md'));
    r.git(['add', 'docs/methodology.md']);
    expect(rules(r)).toEqual(['docs/methodology.md symlink']);
  });

  it('refuses a submodule', () => {
    const r = repo();
    r.git(['update-index', '--add', '--cacheinfo', `160000,${'a'.repeat(40)},src/vendor`]);
    expect(rules(r)).toEqual(['src/vendor not-listed', 'src/vendor submodule']);
  });

  it.each([
    ['email', 'README.md', `Contact: someone${AT}example.com\n`],
    ['email', 'docs/ci.md', `Use 12345+someone${AT}users.noreply.github.com\n`],
    ['local-path', 'src/main.tsx', `// built in /${'Users'}/someone/dev\n`],
    ['local-path', 'docs/ci.md', `Log in /${['private', 'var', 'folders'].join('/')}/x\n`],
    ['private-key', 'src/ui/App.tsx', `const k = "-----BEGIN RSA PRI${'VATE'} KEY-----";\n`],
  ])('refuses %s in the content of %s', (rule, path, content) => {
    expect(rules(repo({ [path]: content }))).toEqual([`${path} ${rule}`]);
  });

  it('scans the content of files that are not on the list too', () => {
    expect(rules(repo({ 'notes.md': `mail someone${AT}example.com\n` }))).toEqual(['notes.md not-listed', 'notes.md email']);
  });

  describe('command line', () => {
    /**
     * @param {string} dir
     * @param {NodeJS.ProcessEnv} env
     */
    const run = (dir, env) => spawnSync(process.execPath, [SCRIPT, dir], { env, encoding: 'utf8' });

    it('exits 0 on a clean tree', () => {
      const r = repo();
      const res = run(r.dir, r.env);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('all on the list');
    });

    it('exits 1 and explains how to add a file', () => {
      const r = repo({ 'notes.md': 'x\n' });
      const res = run(r.dir, r.env);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('notes.md: [not-listed]');
      expect(res.stderr).toContain('scripts/check-tree.mjs');
    });

    it('exits 2 when there are no tracked files', () => {
      const r = repo();
      r.git(['rm', '-r', '--cached', '--quiet', '.']);
      const res = run(r.dir, r.env);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('no tracked files');
    });

    it('exits 2 outside a repository', () => {
      const dir = mkdtempSync(join(tmpdir(), 'check-tree-norepo-'));
      made.push(dir);
      const res = run(dir, { PATH: process.env.PATH ?? '', GIT_CEILING_DIRECTORIES: dirname(dir), HOME: dir });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('could not run');
    });

    it('exits 2 when git is not available', () => {
      const r = repo();
      const res = run(r.dir, { PATH: join(r.dir, 'no-such-bin') });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('git is not available');
    });
  });
});
