import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTree, onList } from './check-tree.mjs';

/*
 * The strings this check refuses (e-mail addresses, home folders, key headers,
 * private network addresses) are put together at run time, so this file holds
 * none of them.
 */
const AT = '@';
const SCRIPT = resolve(import.meta.dirname, 'check-tree.mjs');
const ip = (/** @type {number[]} */ ...octets) => octets.join('.');
const ZERO = '0'.repeat(40);

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
 * @param {Record<string, string | Uint8Array>} [extra]
 */
function repo(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'check-tree-'));
  made.push(root);
  const dir = join(root, 'repo');
  mkdirSync(dir);
  const gitconfig = join(root, 'gitconfig');
  writeFileSync(gitconfig, '');
  const who = `dev${AT}example.com`;
  // The identity is part of the base environment: `git merge` needs one too, and a
  // CI runner has no account to derive it from.
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: root,
    LANG: 'C',
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'A',
    GIT_AUTHOR_EMAIL: who,
    GIT_COMMITTER_NAME: 'C',
    GIT_COMMITTER_EMAIL: who,
  };
  /** @param {string[]} args */
  const git = (args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--quiet', '--initial-branch=main']);
  for (const [path, content] of Object.entries({ ...CLEAN, ...extra })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(['add', '--all']);
  /** @param {string} message */
  const commit = (message) => {
    execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '--quiet', '--no-verify', '--allow-empty', '-m', message], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return git(['rev-parse', 'HEAD']);
  };
  /** @param {string} path @param {string} [content] */
  const write = (path, content = 'x\n') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
    git(['add', '--', path]);
  };
  return { dir, env, git, commit, write };
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

  it.each([
    ['root home', `See /${'root'}/project/x\n`],
    ['a mount point', `Copied from /${'mnt'}/c/work/x\n`],
    ['a Windows drive path with slashes', `Built in ${['D:', 'dev', 'Alice', 'wat-word-ik'].join('/')}\n`],
    ['a Windows drive path with backslashes', `Built in ${['D:', 'dev', 'Alice'].join('\\')}\n`],
    ['a UNC path', `Copied from ${'\\'.repeat(2)}${['nas', 'share', 'site'].join('\\')}\n`],
    ['a drive path in inline code', `Run it from \`${['C:', 'Users', 'x'].join('\\')}\`.\n`],
    ['a drive path as a link target', `See [the build](${['D:', 'dev', 'x'].join('/')}).\n`],
    ['a drive path at the start of a line', `${['C:', 'Users', 'x'].join('\\')} holds it\n`],
    ['a backslash drive path after =', `Set ROOT=${['D:', 'dev', 'x'].join('\\')} first.\n`],
    ['a backslash drive path in brackets', `The folder [${['C:', 'Users', 'x'].join('\\')}] holds it.\n`],
    ['a backslash drive path as a later PATH entry', `PATH=bin;${['D:', 'tools', 'bin'].join('\\')}\n`],
    ['a backslash drive path in Markdown emphasis', `Open **${['C:', 'Users', 'x'].join('\\')}** first.\n`],
  ])('refuses a local path: %s', (_what, content) => {
    expect(rules(repo({ 'docs/ci.md': content }))).toEqual(['docs/ci.md local-path']);
  });

  it.each([
    ['docs/ci.md', `The printer is at ${ip(192, 168, 1, 20)}.\n`],
    ['README.md', `Server ${ip(10, 0, 0, 5)} and ${ip(172, 16, 4, 1)}\n`],
    ['src/ui/App.tsx', `const host = '${ip(192, 168, 0, 1)}';\n`],
    ['.github/workflows/ci.yml', `env:\n  HOST: ${ip(10, 1, 2, 3)}\n`],
  ])('refuses a private network address in %s', (path, content) => {
    const found = rules(repo({ [path]: content }));
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found)).toEqual(new Set([`${path} private-host`]));
  });

  it.each([
    ['docs/ci.md', 'Open nas.local in a browser.\n'],
    ['README.md', 'The build server is ci.lan.\n'],
    ['.github/workflows/ci.yml', 'env:\n  REGISTRY: npm.corp.internal\n'],
  ])('refuses a private host name in %s', (path, content) => {
    expect(rules(repo({ [path]: content }))).toEqual([`${path} private-host`]);
  });

  it('does not take a property in code for a host name, nor a public address for a private one', () => {
    const r = repo({
      'src/ui/App.tsx': 'export const f = (e: { local: number }) => e.local;\n',
      'docs/ci.md': `Not private: ${ip(172, 32, 0, 1)}, ${ip(11, 0, 0, 1)}, version 10.0.0.\n`,
    });
    expect(rules(r)).toEqual([]);
  });

  it('does not take URLs, times, CSS or Markdown tables for Windows paths', () => {
    const r = repo({
      'docs/ci.md': '| a | b |\n|:---|---:|\nAt 12:30 see https://example.com/x and data:image/png.\n',
      'src/styles.css': 'a:hover { color: red; }\n',
      'src/ui/App.tsx': 'export const re = { a: /[a-z]/, b: "\\n" };\n',
    });
    expect(rules(r)).toEqual([]);
  });

  it('does not take a one-letter key or label before a regular expression for a drive', () => {
    const r = repo({
      'src/ui/App.tsx': 'export const r={a:/beta/},o={b:/x/g},t=(c:boolean)=>c?r:/re/;\n',
      'scripts/check-tree.mjs': 'const m={a:/beta/};for(;;){e:/x/.test("");break}\n',
    });
    expect(rules(r)).toEqual([]);
  });

  it('accepts loopback addresses in the test setup and the docs', () => {
    const r = repo({
      'playwright.config.ts': `const ORIGIN = 'http://${ip(127, 0, 0, 1)}:4173';\n`,
      'docs/ci.md': 'Serve it on localhost or [::1].\n',
    });
    expect(rules(r)).toEqual([]);
  });

  it.each([
    ['a NUL byte (binary)', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])],
    ['UTF-16 text', Buffer.from(`\ufeff# CI\nMail someone${AT}example.com\n`, 'utf16le')],
    ['a NUL byte after the first 8000 bytes', Buffer.concat([Buffer.from('x'.repeat(9000)), Buffer.from([0])])],
    ['invalid UTF-8', Uint8Array.from([0x23, 0x20, 0xff, 0xfe, 0x41, 0x0a])],
  ])('refuses a file that is not UTF-8 text: %s', (_what, bytes) => {
    expect(rules(repo({ 'docs/ci.md': bytes }))).toEqual(['docs/ci.md encoding']);
  });

  describe('history (--range)', () => {
    /** @param {ReturnType<typeof repo>} r @param {string} base */
    const inHistory = (r, base, head = 'HEAD') =>
      checkTree(r.dir, r.env, { base, head }).violations.map((v) => `${v.path} ${v.rule}`);

    it('refuses a file that a commit adds and a later one removes', () => {
      const r = repo();
      const base = r.commit('base');
      r.write('notes.md');
      const bad = r.commit('Add my notes');
      r.git(['rm', '--quiet', 'notes.md']);
      r.commit('Remove my notes');
      expect(rules(r)).toEqual([]);
      const found = checkTree(r.dir, r.env, { base, head: 'HEAD' });
      expect(found.violations.map((v) => `${v.path} ${v.rule}`)).toEqual(['notes.md history']);
      expect(found.violations[0]?.message).toContain(`${bad.slice(0, 12)} "Add my notes"`);
      expect(found.history).toEqual({ commits: 2, paths: 1, what: `${base}..HEAD` });
    });

    it('refuses a path that a rename brings in, and file names with spaces or new lines', () => {
      const r = repo();
      const base = r.commit('base');
      r.git(['mv', 'docs/ci.md', 'docs/ci draft.md']);
      r.commit('Rename');
      r.git(['mv', 'docs/ci draft.md', 'docs/ci.md']);
      r.write('odd\nname.md');
      r.commit('Rename back, add an odd name');
      r.git(['rm', '--quiet', 'odd\nname.md']);
      r.commit('Remove it');
      expect(inHistory(r, base)).toEqual(['docs/ci draft.md history', 'odd\nname.md history']);
    });

    it('checks only the range, or every commit with a base of zeros', () => {
      const r = repo();
      r.commit('first');
      r.write('scratch.txt');
      r.commit('Add scratch');
      r.git(['rm', '--quiet', 'scratch.txt']);
      const base = r.commit('Remove scratch');
      r.write('src/ui/Extra.tsx', 'export {};\n');
      r.commit('Add a listed file');
      expect(inHistory(r, base)).toEqual([]);
      expect(inHistory(r, ZERO)).toEqual(['scratch.txt history']);
    });

    it('sees files that a merge adds itself and files that the merged commits add', () => {
      const r = repo();
      const base = r.commit('base');
      r.git(['checkout', '--quiet', '-b', 'side']);
      r.write('side-notes.md');
      r.commit('Side notes');
      r.git(['rm', '--quiet', 'side-notes.md']);
      r.commit('Remove side notes');
      r.git(['checkout', '--quiet', 'main']);
      r.write('src/ui/Main.tsx', 'export {};\n');
      r.commit('Main work');
      r.git(['merge', '--quiet', '--no-ff', '--no-commit', 'side']);
      r.write('merge-notes.md');
      r.git(['rm', '--quiet', '--cached', 'merge-notes.md']);
      r.write('merge-only.md');
      r.commit('Merge side');
      r.git(['rm', '--quiet', 'merge-only.md']);
      r.commit('Clean up');
      const found = inHistory(r, base);
      expect(found).toContain('side-notes.md history');
      expect(found).toContain('merge-only.md history');
      expect(found).not.toContain('src/ui/Main.tsx history');
    });

    it('refuses an unknown base', () => {
      const r = repo();
      r.commit('base');
      expect(() => inHistory(r, '1234567890abcdef1234567890abcdef12345678')).toThrow(/not a commit/);
    });
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

    it('exits 1 for a file that only the history holds, 0 without it in the range', () => {
      const r = repo();
      const base = r.commit('base');
      r.write('notes.md');
      r.commit('Add notes');
      r.git(['rm', '--quiet', 'notes.md']);
      const after = r.commit('Remove notes');
      const bad = spawnSync(process.execPath, [SCRIPT, '--range', base, 'HEAD', r.dir], { env: r.env, encoding: 'utf8' });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('notes.md: [history] is added in commit');
      const ok = spawnSync(process.execPath, [SCRIPT, '--range', after, 'HEAD', r.dir], { env: r.env, encoding: 'utf8' });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain('0 paths added in the 0 commit(s)');
    });

    it('exits 2 on bad arguments or an unknown revision', () => {
      const r = repo();
      r.commit('base');
      /** @param {string[]} args */
      const status = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: r.dir, env: r.env, encoding: 'utf8' }).status;
      expect(status(['--range'])).toBe(2);
      expect(status(['--range', 'HEAD'])).toBe(2);
      expect(status(['--range', 'HEAD', 'HEAD', '.', 'extra'])).toBe(2);
      expect(status(['--other'])).toBe(2);
      expect(status(['--range', 'no-such-ref', 'HEAD'])).toBe(2);
      expect(status(['--range', 'HEAD', 'HEAD'])).toBe(0);
    });

    it('exits 2 when git is not available', () => {
      const r = repo();
      const res = run(r.dir, { PATH: join(r.dir, 'no-such-bin') });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('git is not available');
    });
  });
});
