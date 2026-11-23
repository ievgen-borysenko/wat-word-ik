import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEMO_GIF_MAX_BYTES,
  DEMO_GIF_MAX_DURATION_CS,
  DEMO_GIF_MAX_FRAMES,
  DEMO_GIF_MAX_SIDE,
  DEMO_GIF_MIN_DELAY_CS,
  checkTree,
  onList,
  parseGif,
} from './check-tree.mjs';

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
  /** @param {string} path @param {string | Uint8Array} [content] */
  const write = (path, content = 'x\n') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
    git(['add', '--', path]);
  };
  return { dir, env, git, commit, write };
}

/** @param {ReturnType<typeof repo>} r */
const rules = (r) => checkTree(r.dir, r.env).violations.map((v) => `${v.path} ${v.rule}`);

/*
 * GIF parts for the tests, built at run time.
 */
/** @param {...(number | number[] | string | Uint8Array)} parts */
const bytes = (...parts) =>
  Buffer.concat(
    parts.map((p) => (typeof p === 'number' ? Buffer.from([p]) : typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))),
  );
const le16 = (/** @type {number} */ n) => [n & 0xff, n >> 8];

/** Data split into GIF sub-blocks of at most 255 bytes, then the terminator. */
function subBlocks(/** @type {Uint8Array | string} */ data) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'latin1') : Buffer.from(data);
  /** @type {Buffer[]} */
  const parts = [];
  for (let i = 0; i < buf.length; i += 255) {
    const chunk = buf.subarray(i, i + 255);
    parts.push(Buffer.from([chunk.length]), chunk);
  }
  return Buffer.concat([...parts, Buffer.from([0])]);
}

/**
 * LZW data as a GIF decoder reads it: a clear code, one literal code per pixel
 * (the table grows as the decoder sees it, up to 4096 entries), the end code.
 * @param {number[]} pixels colour indices
 * @param {number} [clearAt] also send a clear code before this pixel
 */
function lzw(pixels, clearAt = -1) {
  const minCodeSize = 2;
  const clear = 1 << minCodeSize;
  /** @type {number[]} */
  const out = [];
  let size = minCodeSize + 1;
  let next = clear + 2;
  let fresh = true;
  let acc = 0;
  let bits = 0;
  const put = (/** @type {number} */ code) => {
    acc |= code << bits;
    bits += size;
    for (; bits >= 8; bits -= 8, acc >>>= 8) out.push(acc & 0xff);
  };
  pixels.forEach((p, i) => {
    if (i === 0 || i === clearAt) {
      put(clear);
      size = minCodeSize + 1;
      next = clear + 2;
      fresh = true;
    }
    put(p);
    if (!fresh && next < 4096) {
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    fresh = false;
  });
  put(clear + 1);
  if (bits > 0) out.push(acc & 0xff);
  return Buffer.from(out);
}

/** Logical screen with a global table of two colours (black, white). */
const screen = (w = 2, h = 2) => bytes(...le16(w), ...le16(h), 0x80, 0, 0, [0, 0, 0, 255, 255, 255]);
const LOOP = bytes(0x21, 0xff, 11, 'NETSCAPE2.0', 3, 1, ...le16(0), 0);
const gce = (delayCs = 10) => bytes(0x21, 0xf9, 4, 0, ...le16(delayCs), 0, 0);
/** An image at (0, 0) of w x h pixels, alternating black and white unless `data` is given. */
const image = (w = 2, h = 2, /** @type {Uint8Array} */ data = lzw(Array.from({ length: w * h }, (_, i) => i % 2))) =>
  bytes(0x2c, ...le16(0), ...le16(0), ...le16(w), ...le16(h), 0, 2, subBlocks(data));
const TRAILER = bytes(0x3b);
/** Header, logical screen and loop extension: everything before the first frame. */
const start = (w = 2, h = 2) => bytes('GIF89a', screen(w, h), LOOP);
/** A frame: a delay of 0.1 s, then an image of w x h pixels. */
const frame = (/** @type {Uint8Array | undefined} */ data = undefined, w = 2, h = 2) => bytes(gce(), image(w, h, data));
/** Two frames of 2x2 pixels, 0.1 s each, looping forever. */
const GIF = bytes(start(), frame(), frame(), TRAILER);

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
    'collector/notes.txt',
  ])('refuses %s, which is not on the list', (path) => {
    const r = repo({ [path]: 'x\n' });
    expect(rules(r)).toEqual([`${path} not-listed`]);
    const message = checkTree(r.dir, r.env).violations[0]?.message ?? '';
    expect(message).toContain('not on the list');
    expect(message).toContain('same pull request');
  });

  describe('the collector (collector/)', () => {
    const LISTED = [
      'collector/.python-version',
      'collector/run.py',
      'collector/gate.py',
      'collector/tests/__init__.py',
      'collector/tests/test_gate.py',
      'collector/fixtures/synthetic/extract.tsv',
      'collector/fixtures/synthetic/professions.tsv',
      'collector/fixtures/synthetic/subjects.tsv',
      'collector/fixtures/synthetic/lock.json',
      'collector/fixtures/synthetic/expected.json',
      'docs/collector.md',
    ];

    it('lists its modules, tests, synthetic fixture and docs', () => {
      for (const path of LISTED) expect(onList(path), path).toBe(true);
      const r = repo(Object.fromEntries(LISTED.map((path) => [path, 'x\n'])));
      expect(rules(r)).toEqual([]);
    });

    it.each([
      'collector/notes.txt',
      'collector/README.md',
      'collector/Run.py',
      'collector/run_all.py',
      'collector/run.pyc',
      'collector/__pycache__/run.cpython-314.pyc',
      'collector/sub/gate.py',
      'collector/requirements.txt',
      'collector/.python-version.bak',
      'collector/tests/helper.py',
      'collector/tests/test_gate.txt',
      'collector/tests/data/sample.tsv',
      'collector/fixtures/real/extract.tsv',
      'collector/fixtures/synthetic/raw.xlsx',
      'collector/fixtures/synthetic/notes.md',
      // The fixture's five files are listed by name: another name of the same shape is not.
      'collector/fixtures/synthetic/notes.json',
      'collector/fixtures/synthetic/extra.tsv',
      'collector/fixtures/synthetic/extract.json',
      'collector/fixtures/synthetic/sub/extract.tsv',
      'collector/extract/knowledge.tsv',
      'collector/sandbox/fetch.sb',
      'docs/collector-notes.md',
    ])('refuses %s, which is not on the list (yet)', (path) => {
      expect(onList(path)).toBe(false);
      expect(rules(repo({ [path]: 'x\n' }))).toEqual([`${path} not-listed`]);
    });

    // Python is not code for the private-host rule: there `x.local` would be a property,
    // and the collector names none so.
    it('holds Python files to the private host name rule', () => {
      const path = 'collector/gate.py';
      expect(rules(repo({ [path]: 'import threading\nstate = threading.local()\n' }))).toEqual([`${path} private-host`]);
    });

    it('refuses an executable collector file, a binary fixture and a local path in a test', () => {
      const r = repo({
        'collector/run.py': 'print(1)\n',
        'collector/fixtures/synthetic/lock.json': Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
        'collector/tests/test_gate.py': `HOME = '/${'Users'}/someone/dev'\n`,
      });
      r.git(['update-index', '--chmod=+x', 'collector/run.py']);
      expect(new Set(rules(r))).toEqual(
        new Set(['collector/run.py executable', 'collector/fixtures/synthetic/lock.json encoding', 'collector/tests/test_gate.py local-path']),
      );
    });

    // The collector writes one file for the site: listed by name, like the fixture's files.
    it('lists the data file the collector writes for the site, and no other data file in src/', () => {
      for (const path of ['src/data/sourced.json', 'src/data/sourced.ts', 'src/data/sourced.test.ts', 'scripts/check-data.mjs', 'scripts/check-data.test.mjs']) {
        expect(onList(path), path).toBe(true);
      }
      for (const path of [
        'src/data/other.json',
        'src/data/Sourced.json',
        'src/data/sourced.json.bak',
        'src/data/sourced.tsv',
        'src/data/raw/sourced.json',
        'src/sourced.json',
        'src/engine/sourced.json',
        'collector/sourced.json',
      ]) {
        expect(onList(path), path).toBe(false);
        expect(rules(repo({ [path]: '{}\n' }))).toEqual([`${path} not-listed`]);
      }
      expect(rules(repo({ 'src/data/sourced.json': '{}\n' }))).toEqual([]);
    });

    it('refuses a stray collector file that a commit adds and a later one removes', () => {
      const r = repo();
      const base = r.commit('base');
      r.write('collector/notes.txt');
      r.commit('Add collector notes');
      r.git(['rm', '--quiet', 'collector/notes.txt']);
      r.commit('Remove them');
      const history = checkTree(r.dir, r.env, { base, head: 'HEAD' }).violations.map((v) => `${v.path} ${v.rule}`);
      expect(history).toEqual(['collector/notes.txt history']);
    });
  });

  it('lists every root file it allows by exact name only', () => {
    expect(onList('README.md')).toBe(true);
    expect(onList('docs/README.md')).toBe(false);
    expect(onList('README.md.bak')).toBe(false);
    expect(onList('package.json')).toBe(true);
    expect(onList('src/package.json')).toBe(false);
  });

  it('lists the four pages and their entries, and nothing that only looks like them', () => {
    for (const path of [
      'index.html',
      'deuren.html',
      'onderbouw.html',
      'bovenbouw.html',
      'src/main.tsx',
      'src/doors.tsx',
      'src/onderbouw.tsx',
      'src/bovenbouw.tsx',
      'src/styles.css',
      'src/doors.css',
      'src/onderbouw.css',
      'src/bovenbouw.css',
    ]) {
      expect(onList(path), path).toBe(true);
    }
    for (const path of [
      'src/deuren.html',
      'other.html',
      'src/other.tsx',
      'src/doors.ts',
      'src/notes.css',
      'docs/deuren.html',
      'src/onderbouw.html',
      'onderbouw.htm',
      'src/onderbouw.ts',
      'docs/onderbouw.html',
      'src/bovenbouw.html',
      'bovenbouw.htm',
      'src/bovenbouw.ts',
      'docs/bovenbouw.html',
      'middenbouw.html',
      'src/middenbouw.tsx',
    ]) {
      expect(onList(path), path).toBe(false);
    }
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
    // Forward-slash drive paths, one per token start; no `Users` part, so that the
    // macOS home-folder alternative cannot be what finds them.
    ['a forward-slash drive path in inline code', `Run it from \`${['C:', 'work', 'x'].join('/')}\`.\n`],
    ['a drive path as a link target', `See [the build](${['D:', 'dev', 'x'].join('/')}).\n`],
    ['a forward-slash drive path at the start of the file', `${['C:', 'work', 'x'].join('/')} holds it\n`],
    ['a forward-slash drive path at the start of a later line', `intro\n${['D:', 'dev', 'x'].join('/')} holds it\n`],
    ['a file URL pathname with a drive', `Open "/${['D:', 'dev', 'x'].join('/')}" there.\n`],
    ['a file URL with two slashes and a drive', `See file://${['D:', 'x'].join('/')} first.\n`],
    ['a file URL with a drive in angle brackets', `See <file:///${['D:', 'x'].join('/')}>.\n`],
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
      'scripts/check-tree.mjs': 'const m={a:/beta/};for(;;){e:/x/.test("");break}const u=c?/a/g:/b/g,v=a/b:/c/;\n',
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

  describe('the demo animation (docs/demo.gif)', () => {
    /** @param {Uint8Array} gif */
    const gifViolations = (gif) => {
      const r = repo({ 'docs/demo.gif': gif });
      return checkTree(r.dir, r.env).violations;
    };
    const FOUR = lzw([0, 1, 0, 1]);

    it('passes a GIF in the allowed form, and reports what it shows', () => {
      const r = repo({ 'docs/demo.gif': GIF });
      const result = checkTree(r.dir, r.env);
      expect(result.violations).toEqual([]);
      expect(result.gif).toEqual({ width: 2, height: 2, frames: 2, durationCs: 20 });
      expect(result.scanned).toBe(Object.keys(CLEAN).length);
    });

    it('passes the largest screen, the shortest delay, transparency, interlacing, a clear code inside the data and one zero byte after the end code', () => {
      const transparent = bytes(0x21, 0xf9, 4, 0x09, ...le16(DEMO_GIF_MIN_DELAY_CS), 1, 0);
      const interlaced = bytes(0x2c, ...le16(0), ...le16(0), ...le16(2), ...le16(2), 0x40, 2, subBlocks(bytes(FOUR, 0)));
      const side = DEMO_GIF_MAX_SIDE;
      const gif = bytes('GIF89a', screen(side, side), LOOP, transparent, image(2, 2, lzw([0, 1, 1, 0], 2)), gce(), interlaced, TRAILER);
      expect(parseGif(gif)).toEqual({ width: side, height: side, frames: 2, durationCs: DEMO_GIF_MIN_DELAY_CS + 10 });
    });

    it('passes the other fields it leaves free: background colour, colour resolution and sort flag, a transparent index without transparency, a disposal method, a frame smaller than the screen and data in sub-blocks of one byte', () => {
      const head = bytes('GIF89a', ...le16(2), ...le16(2), 0xf8, 1, 0, [0, 0, 0, 255, 255, 255], LOOP);
      const control = bytes(0x21, 0xf9, 4, 0x08, ...le16(10), 1, 0);
      const small = bytes(0x2c, ...le16(1), ...le16(1), ...le16(1), ...le16(1), 0, 2, ...[...lzw([1])].flatMap((b) => [1, b]), 0);
      expect(parseGif(bytes(head, control, small, TRAILER))).toEqual({ width: 2, height: 2, frames: 1, durationCs: 10 });
    });

    it('passes the most frames and the longest running time', () => {
      const last = DEMO_GIF_MAX_DURATION_CS - (DEMO_GIF_MAX_FRAMES - 1) * 10;
      expect(last).toBeGreaterThanOrEqual(DEMO_GIF_MIN_DELAY_CS);
      const gif = bytes(start(), ...Array.from({ length: DEMO_GIF_MAX_FRAMES - 1 }, () => frame()), gce(last), image(), TRAILER);
      expect(parseGif(gif)).toEqual({ width: 2, height: 2, frames: DEMO_GIF_MAX_FRAMES, durationCs: DEMO_GIF_MAX_DURATION_CS });
    });

    it('decodes a long run of codes past the full table of 4096 entries', () => {
      const side = 128;
      const pixels = Array.from({ length: side * side }, (_, i) => (i >> 3) % 2);
      const gif = bytes(start(side, side), frame(lzw(pixels, 5000), side, side), TRAILER);
      expect(parseGif(gif)).toEqual({ width: side, height: side, frames: 1, durationCs: 10 });
    });

    const big = () => {
      const side = DEMO_GIF_MAX_SIDE;
      const one = frame(lzw(Array.from({ length: side * side }, (_, i) => (i + Math.floor(i / side)) % 2)), side, side);
      return bytes(start(side, side), one, one, TRAILER);
    };

    it.each([
      ['the GIF87a header', () => bytes('GIF87a', GIF.subarray(6)), 'not with the GIF89a header'],
      ['a PNG', () => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), 'not with the GIF89a header'],
      ['text', () => bytes('# Demo\n'), 'not with the GIF89a header'],
      ['an empty file', () => bytes(), 'ends inside the header'],
      // What tools write on their own.
      ['a comment extension', () => bytes(start(), 0x21, 0xfe, subBlocks('made by someone'), frame(), TRAILER), 'comment'],
      ['a plain text extension', () => bytes(start(), 0x21, 0x01, 12, new Uint8Array(12), subBlocks('hello'), frame(), TRAILER), 'plain text'],
      ['an XMP extension', () => bytes(start(), 0x21, 0xff, 11, 'XMP DataXMP', subBlocks('<x:xmpmeta/>'), frame(), TRAILER), '"XMP DataXMP"'],
      ['a colour profile', () => bytes(start(), 0x21, 0xff, 11, 'ICCRGBG1012', subBlocks('profile'), frame(), TRAILER), '"ICCRGBG1012"'],
      ['another looping extension', () => bytes('GIF89a', screen(), 0x21, 0xff, 11, 'ANIMEXTS1.0', 3, 1, 0, 0, 0, frame(), TRAILER), '"ANIMEXTS1.0"'],
      ['an unknown extension', () => bytes(start(), 0x21, 0x02, subBlocks('x'), frame(), TRAILER), 'unknown extension 0x2'],
      ['an unknown block', () => bytes(start(), 0x00, frame(), TRAILER), 'unknown block type 0x0'],
      // Anything appended, and broken files.
      ['bytes after the trailer', () => bytes(GIF, 'someone was here'), 'bytes follow the trailer'],
      ['no trailer', () => GIF.subarray(0, GIF.length - 1), 'no trailer'],
      ['a file cut inside an image', () => GIF.subarray(0, GIF.length - 6), 'the file ends inside'],
      ['a file cut inside the colour table', () => GIF.subarray(0, 16), 'the file ends inside the global colour table'],
      ['text after the end code of an image', () => bytes(start(), frame(bytes(FOUR, 'hidden')), TRAILER), '6 bytes after the end code'],
      ['two zero bytes after the end code', () => bytes(start(), frame(bytes(FOUR, 0, 0)), TRAILER), '2 bytes after the end code'],
      ['a set bit after the end code', () => bytes(start(), frame(bytes(FOUR, 'h')), TRAILER), 'data after the end code'],
      ['too few pixels', () => bytes(start(), frame(lzw([0, 1, 0])), TRAILER), 'holds 3 pixels, the image 4'],
      ['too many pixels', () => bytes(start(), frame(lzw([0, 1, 0, 1, 0])), TRAILER), 'more pixels than the image'],
      ['a colour outside the table', () => bytes(start(), frame(lzw([0, 1, 3, 1])), TRAILER), 'outside its table of 2'],
      ['image data without an end code', () => bytes(start(), frame(FOUR.subarray(0, 2)), TRAILER), 'ends before the end code'],
      ['no image', () => bytes(start(), TRAILER), 'holds no image'],
      // The loop.
      ['no loop extension', () => bytes('GIF89a', screen(), frame(), TRAILER), 'must come before the first image'],
      ['a loop extension only after the first image', () => bytes('GIF89a', screen(), frame(), LOOP, frame(), TRAILER), 'must come before the first image'],
      ['a second NETSCAPE2.0 extension', () => bytes(start(), LOOP, frame(), TRAILER), 'second NETSCAPE2.0'],
      ['a loop count other than forever', () => bytes('GIF89a', screen(), 0x21, 0xff, 11, 'NETSCAPE2.0', 3, 1, ...le16(3), 0, frame(), TRAILER), 'must loop forever'],
      [
        'more data in the NETSCAPE2.0 extension',
        () => bytes('GIF89a', screen(), 0x21, 0xff, 11, 'NETSCAPE2.0', 3, 1, 0, 0, 5, 'hello', 0, frame(), TRAILER),
        'more than one sub-block',
      ],
      // Frames.
      ['an image without a graphic control extension', () => bytes(start(), image(), TRAILER), 'has no graphic control extension'],
      ['a frame delay of 0', () => bytes(start(), gce(0), image(), TRAILER), 'a delay of 0 hundredths'],
      ['a frame delay of 1', () => bytes(start(), gce(1), image(), TRAILER), 'a delay of 1 hundredths'],
      ['a frame that waits for user input', () => bytes(start(), 0x21, 0xf9, 4, 0x02, ...le16(10), 0, 0, image(), TRAILER), 'user input'],
      ['an undefined disposal method', () => bytes(start(), 0x21, 0xf9, 4, 0x1c, ...le16(10), 0, 0, image(), TRAILER), 'undefined disposal method'],
      ['a graphic control extension without an image', () => bytes(start(), frame(), gce(), TRAILER), 'no image after it'],
      ['two graphic control extensions in a row', () => bytes(start(), gce(), gce(), image(), TRAILER), 'not directly followed by its image'],
      [
        'an image outside the logical screen',
        () => bytes(start(), gce(), 0x2c, ...le16(1), ...le16(0), ...le16(2), ...le16(2), 0, 2, subBlocks(FOUR), TRAILER),
        'outside the logical screen',
      ],
      // Colour tables: one, global.
      [
        'a local colour table (here carrying text)',
        () => bytes(start(), gce(), 0x2c, ...le16(0), ...le16(0), ...le16(2), ...le16(2), 0x81, `a${AT}example.nl`, 2, subBlocks(FOUR), TRAILER),
        'local colour table',
      ],
      [
        'local colour table bits without a table',
        () => bytes(start(), gce(), 0x2c, ...le16(0), ...le16(0), ...le16(2), ...le16(2), 0x07, 2, subBlocks(FOUR), TRAILER),
        'reserved or local colour table bits',
      ],
      ['no global colour table', () => bytes('GIF89a', ...le16(2), ...le16(2), 0x00, 0, 0, LOOP, frame(), TRAILER), 'no global colour table'],
      // Size.
      ['a screen wider than the cap', () => bytes(start(DEMO_GIF_MAX_SIDE + 1, 2), frame(), TRAILER), `more than ${DEMO_GIF_MAX_SIDE} on a side`],
      ['a screen higher than the cap', () => bytes(start(2, DEMO_GIF_MAX_SIDE + 1), frame(), TRAILER), `more than ${DEMO_GIF_MAX_SIDE} on a side`],
      ['the largest screen there is', () => bytes(start(65535, 65535), frame(), TRAILER), `more than ${DEMO_GIF_MAX_SIDE} on a side`],
      [
        'a pixel aspect ratio',
        () => bytes('GIF89a', ...le16(2), ...le16(2), 0x80, 0, 49, [0, 0, 0, 255, 255, 255], LOOP, frame(), TRAILER),
        'pixel aspect ratio',
      ],
      ['a file over the size cap', big, `more than the cap of ${DEMO_GIF_MAX_BYTES}`],
      // Many tiny frames: within the size cap without these two caps.
      [
        'more frames than the cap',
        () => bytes(start(), ...Array.from({ length: DEMO_GIF_MAX_FRAMES + 1 }, () => frame()), TRAILER),
        `more than ${DEMO_GIF_MAX_FRAMES} frames`,
      ],
      [
        'frame delays that add up to more than the cap',
        () => bytes(start(), gce(DEMO_GIF_MAX_DURATION_CS - 1), image(), gce(DEMO_GIF_MIN_DELAY_CS), image(), TRAILER),
        `more than ${DEMO_GIF_MAX_DURATION_CS} hundredths of a second`,
      ],
    ])('refuses %s', (_what, make, message) => {
      const found = gifViolations(make());
      expect(found.map((v) => `${v.path} ${v.rule}`)).toEqual(['docs/demo.gif gif']);
      expect(found[0]?.message).toContain(message);
    });

    it('refuses the oversize GIF for its size alone', () => {
      const gif = big();
      expect(gif.length).toBeGreaterThan(DEMO_GIF_MAX_BYTES);
      expect(parseGif(gif, Infinity)).toMatchObject({ width: DEMO_GIF_MAX_SIDE, height: DEMO_GIF_MAX_SIDE, frames: 2 });
    });

    it.each([
      ['docs/other.gif', ['docs/other.gif not-listed', 'docs/other.gif encoding']],
      ['demo.gif', ['demo.gif not-listed', 'demo.gif encoding']],
      ['docs/ci.md', ['docs/ci.md encoding']],
      ['README.md', ['README.md encoding']],
    ])('refuses the same GIF at %s', (path, expected) => {
      expect(rules(repo({ [path]: GIF }))).toEqual(expected);
    });

    it('still refuses other binary files next to it', () => {
      const r = repo({ 'docs/demo.gif': GIF, 'docs/methodology.md': bytes([0x89, 0x50, 0x4e, 0x47, 0, 0]) });
      expect(rules(r)).toEqual(['docs/methodology.md encoding']);
    });

    it('lists the animation and its recording script by exact path only', () => {
      expect(onList('docs/demo.gif')).toBe(true);
      expect(onList('docs/demo2.gif')).toBe(false);
      expect(onList('docs/sub/demo.gif')).toBe(false);
      expect(onList('scripts/record-demo.mjs')).toBe(true);
      expect(onList('scripts/record-other.mjs')).toBe(false);
    });

    it('passes the committed animation', () => {
      const info = parseGif(readFileSync(resolve(import.meta.dirname, '..', 'docs', 'demo.gif')));
      expect(info.width).toBeLessThanOrEqual(DEMO_GIF_MAX_SIDE);
      expect(info.frames).toBeGreaterThan(1);
    });
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
      expect(found.history).toEqual({ commits: 2, paths: 1, gifVersions: 0, what: `${base}..HEAD` });
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

    describe('every version of docs/demo.gif that a commit writes', () => {
      const WITH_COMMENT = bytes(start(), 0x21, 0xfe, subBlocks('note'), frame(), TRAILER);
      const APPENDED = bytes(GIF, 'note');
      /** @param {ReturnType<typeof repo>} r @param {string} base */
      const gifFindings = (r, base) =>
        checkTree(r.dir, r.env, { base, head: 'HEAD' })
          .violations.filter((v) => v.rule === 'history-gif')
          .map((v) => v.message);

      it('refuses a version that a later commit replaces, in the range and with a base of zeros', () => {
        const r = repo({ 'docs/demo.gif': GIF });
        const base = r.commit('Add the animation');
        r.write('docs/demo.gif', WITH_COMMENT);
        const bad = r.commit('Add a comment to the animation');
        r.write('docs/demo.gif', GIF);
        r.commit('Put the recorded animation back');
        expect(rules(r)).toEqual([]);
        const found = checkTree(r.dir, r.env, { base, head: 'HEAD' });
        expect(found.violations.map((v) => `${v.path} ${v.rule}`)).toEqual(['docs/demo.gif history-gif']);
        expect(found.violations[0]?.message).toContain(`commit ${bad.slice(0, 12)} "Add a comment to the animation" writes`);
        expect(found.violations[0]?.message).toContain('a comment extension is not allowed');
        expect(found.history?.gifVersions).toBe(2);
        expect(inHistory(r, ZERO)).toEqual(['docs/demo.gif history-gif']);
        expect(inHistory(r, bad)).toEqual([]);
      });

      it('refuses a version that a rename brings to the path', () => {
        const r = repo({ 'docs/demo.gif': GIF });
        const base = r.commit('Add the animation');
        r.write('docs/methodology.md', APPENDED);
        r.commit('Keep a draft');
        r.git(['rm', '--quiet', 'docs/demo.gif']);
        r.git(['mv', 'docs/methodology.md', 'docs/demo.gif']);
        const renamed = r.commit('Use the draft as the animation');
        r.write('docs/demo.gif', GIF);
        r.commit('Put the recorded animation back');
        const found = gifFindings(r, base);
        expect(found).toHaveLength(1);
        expect(found[0]).toContain(`commit ${renamed.slice(0, 12)} "Use the draft as the animation"`);
        expect(found[0]).toContain('bytes follow the trailer');
      });

      it('passes a deletion and the version that comes back', () => {
        const r = repo({ 'docs/demo.gif': GIF });
        const base = r.commit('Add the animation');
        r.git(['rm', '--quiet', 'docs/demo.gif']);
        r.commit('Remove it');
        r.write('docs/demo.gif', GIF);
        r.commit('Bring it back');
        const found = checkTree(r.dir, r.env, { base, head: 'HEAD' });
        expect(found.violations).toEqual([]);
        expect(found.history?.gifVersions).toBe(1);
      });

      it('refuses a version from a merged branch and one that a merge writes itself', () => {
        const r = repo({ 'docs/demo.gif': GIF });
        const base = r.commit('Add the animation');
        r.git(['checkout', '--quiet', '-b', 'side']);
        r.write('docs/demo.gif', WITH_COMMENT);
        const side = r.commit('Side: comment');
        r.git(['checkout', '--quiet', 'main']);
        r.write('src/ui/Main.tsx', 'export {};\n');
        r.commit('Main work');
        r.git(['merge', '--quiet', '--no-ff', '--no-commit', 'side']);
        r.write('docs/demo.gif', APPENDED);
        const merge = r.commit('Merge side');
        r.write('docs/demo.gif', GIF);
        r.commit('Put the recorded animation back');
        const found = gifFindings(r, base);
        expect(found).toHaveLength(2);
        expect(found.some((m) => m.includes(`commit ${side.slice(0, 12)} "Side: comment"`))).toBe(true);
        expect(found.some((m) => m.includes(`commit ${merge.slice(0, 12)} "Merge side"`))).toBe(true);
      });

      // The size is checked before the version is read, so a huge one is never loaded;
      // parseGif refuses it with the same message, so this test cannot tell the two apart.
      it('refuses an oversize version', () => {
        const r = repo({ 'docs/demo.gif': GIF });
        const base = r.commit('Add the animation');
        r.write('docs/demo.gif', bytes(GIF.subarray(0, GIF.length - 1), new Uint8Array(DEMO_GIF_MAX_BYTES), TRAILER));
        r.commit('A big one');
        r.write('docs/demo.gif', GIF);
        r.commit('Put the recorded animation back');
        const found = gifFindings(r, base);
        expect(found).toHaveLength(1);
        expect(found[0]).toContain(`more than the cap of ${DEMO_GIF_MAX_BYTES}`);
      });

      it('refuses a folder at the path', () => {
        const r = repo({ 'docs/demo.gif': GIF });
        const base = r.commit('Add the animation');
        r.git(['rm', '--quiet', 'docs/demo.gif']);
        r.write('docs/demo.gif/frame.md');
        const folder = r.commit('Make it a folder');
        r.git(['rm', '--quiet', '-r', 'docs/demo.gif']);
        r.write('docs/demo.gif', GIF);
        r.commit('Put the recorded animation back');
        expect(inHistory(r, base)).toEqual(['docs/demo.gif/frame.md history', 'docs/demo.gif history-gif']);
        expect(gifFindings(r, base)[0]).toContain(`commit ${folder.slice(0, 12)} "Make it a folder" writes is not a GIF`);
        expect(gifFindings(r, base)[0]).toContain('it is a tree, not a file');
      });

      /**
       * A history in which one commit puts a submodule at docs/demo.gif and the
       * next one puts the animation back.
       * @param {'submodule' | 'commit'} type submodule: its commit is not in the repository; commit: it is
       */
      const submoduleHistory = (type) => {
        const r = repo({ 'docs/demo.gif': GIF });
        const base = r.commit('Add the animation');
        r.git(['rm', '--quiet', '--cached', 'docs/demo.gif']);
        r.git(['update-index', '--add', '--cacheinfo', `160000,${type === 'commit' ? base : 'a'.repeat(40)},docs/demo.gif`]);
        const submodule = r.commit('Make it a submodule');
        r.git(['rm', '--quiet', '--cached', 'docs/demo.gif']);
        r.write('docs/demo.gif', GIF);
        r.commit('Put the recorded animation back');
        return { r, base, submodule };
      };

      // git cat-file reports a submodule whose commit is not in the repository
      // as "<object> submodule", without a type or size.
      it.each(/** @type {const} */ ([
        ['whose commit is not in the repository', 'submodule'],
        ['that points to a commit of the repository', 'commit'],
      ]))('refuses a submodule at the path %s, and the command line exits 1', (_what, type) => {
        const { r, base, submodule } = submoduleHistory(type);
        expect(rules(r)).toEqual([]);
        expect(inHistory(r, base)).toEqual(['docs/demo.gif history-gif']);
        expect(gifFindings(r, base)[0]).toContain(`commit ${submodule.slice(0, 12)} "Make it a submodule" writes is not a GIF`);
        expect(gifFindings(r, base)[0]).toContain(`it is a ${type}, not a file`);
        const res = spawnSync(process.execPath, [SCRIPT, '--range', base, 'HEAD', r.dir], { env: r.env, encoding: 'utf8' });
        expect(res.status).toBe(1);
        expect(res.stderr).toContain(`docs/demo.gif: [history-gif] the version that commit ${submodule.slice(0, 12)}`);
      });

      /**
       * The environment of `r` with a stand-in for git first on PATH: it runs
       * the real git, but turns each "<object> submodule" line that
       * `git cat-file --batch-check` gives into `instead`, a shell word in which
       * $name is the name that was asked for.
       * @param {ReturnType<typeof repo>} r
       * @param {string} instead
       */
      const gitAnswering = (r, instead) => {
        const bin = join(dirname(r.dir), 'stand-in');
        mkdirSync(bin);
        const script = [
          '#!/bin/sh',
          '[ "$1" = cat-file ] && [ "$2" = --batch-check ] || exec "$REAL_GIT" "$@"',
          'while IFS= read -r name; do',
          '  answer=$(printf \'%s\\n\' "$name" | "$REAL_GIT" cat-file --batch-check) || exit $?',
          `  case "$answer" in *' submodule') echo ${instead} ;; *) printf '%s\\n' "$answer" ;; esac`,
          'done',
          '',
        ].join('\n');
        writeFileSync(join(bin, 'git'), script, { mode: 0o755 });
        const realGit = execFileSync('sh', ['-c', 'command -v git'], { env: r.env, encoding: 'utf8' }).trim();
        return { ...r.env, PATH: `${bin}:${r.env.PATH}`, REAL_GIT: realGit };
      };

      // Older git prints "<commit>:<path> missing" for such a submodule, the
      // same line as for a path that is not there; the stand-in answers so.
      it('refuses a submodule at the path also where git cat-file reports it missing', () => {
        const { r, base, submodule } = submoduleHistory('submodule');
        const env = gitAnswering(r, '"$name missing"');
        const asked = `${submodule}:docs/demo.gif\n${base}:docs/demo.gif\n`;
        const answer = execFileSync('git', ['cat-file', '--batch-check'], { cwd: r.dir, env, input: asked, encoding: 'utf8' }).split('\n');
        expect(answer[0]).toBe(`${submodule}:docs/demo.gif missing`);
        expect(answer[1]).toMatch(/^[0-9a-f]{40} blob \d+$/);
        const found = checkTree(r.dir, env, { base, head: 'HEAD' }).violations;
        expect(found.map((v) => `${v.path} ${v.rule}`)).toEqual(['docs/demo.gif history-gif']);
        expect(found[0]?.message).toContain(`commit ${submodule.slice(0, 12)} "Make it a submodule" writes is not a GIF`);
        expect(found[0]?.message).toContain('it is a submodule, not a file');
      });

      it('stops on a "missing" line for another name than the one asked', () => {
        const { r, base } = submoduleHistory('submodule');
        const env = gitAnswering(r, '"HEAD:docs/demo.gif missing"');
        expect(() => checkTree(r.dir, env, { base, head: 'HEAD' })).toThrow(/unexpected line .*: HEAD:docs\/demo\.gif missing$/);
      });
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

    it('reports the animation it checked, and exits 1 for one with something appended', () => {
      const good = repo({ 'docs/demo.gif': GIF });
      const ok = run(good.dir, good.env);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain('docs/demo.gif is a GIF animation in the allowed form (2x2, 2 frames, 0.20 s)');
      const r = repo({ 'docs/demo.gif': bytes(GIF, 'note') });
      const bad = run(r.dir, r.env);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain(
        'docs/demo.gif: [gif] must be a GIF animation in the form that parseGif in scripts/check-tree.mjs allows: 4 bytes follow the trailer',
      );
    });

    it('exits 1 for a version of the animation that only the history holds', () => {
      const r = repo({ 'docs/demo.gif': GIF });
      const base = r.commit('base');
      r.write('docs/demo.gif', bytes(start(), 0x21, 0xfe, subBlocks('note'), frame(), TRAILER));
      r.commit('Add a note to the animation');
      r.write('docs/demo.gif', GIF);
      r.commit('Put the animation back');
      expect(run(r.dir, r.env).status).toBe(0);
      const bad = spawnSync(process.execPath, [SCRIPT, '--range', base, 'HEAD', r.dir], { env: r.env, encoding: 'utf8' });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain('docs/demo.gif: [history-gif] the version that commit');
      expect(bad.stderr).toContain('"Add a note to the animation" writes is not a GIF');
      const ok = spawnSync(process.execPath, [SCRIPT, '--range', 'HEAD', 'HEAD', r.dir], { env: r.env, encoding: 'utf8' });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain('0 version(s) of docs/demo.gif written in them');
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
