#!/usr/bin/env node
// The repository holds only what belongs to the program.
//
// Every tracked file (`git ls-files`) must match an entry of the allow-list
// below: the page's source and tests, the check scripts, the end-to-end tests,
// the listed docs, the two files under .github/ and a few root files by exact
// name. Anything else fails: personal tool settings, editor folders, notes,
// dumps and scratch files stay out without being named one by one. Adding a
// file to the repository means adding its path to this list in the same pull
// request, where the reviewer sees it.
//
// Also refused:
//   - symlinks, submodules and executable files (none are needed: the scripts
//     run through `node`);
//   - files that are not UTF-8 text: a NUL byte (binary data, UTF-16 text) or
//     invalid UTF-8. The content checks below read UTF-8 only, so such a file
//     would otherwise pass unread. One path is the exception: docs/demo.gif,
//     the animation in the README, must instead parse as a GIF of at most
//     2 MiB that holds images and nothing else (parseGif below: no comments,
//     no text, no metadata, nothing after the image data or the trailer). It
//     gets no text checks; what its pixels show is for the reviewer to see;
//   - in every tracked text file: e-mail addresses (none at all), absolute paths
//     from a developer's machine, private key headers and private network
//     addresses (RFC 1918). Tests that need such strings put them together at
//     run time;
//   - in every tracked text file except code (.js, .mjs, .ts, .tsx): host names
//     in a private namespace (*.local, *.lan, *.internal). In code, `x.local` is
//     usually a property, as in the built bundle.
// Loopback addresses (localhost, 127.0.0.1, ::1) are not looked for here: they
// are the same on every machine, reveal nothing about a person, and the test
// setup needs them (playwright.config.ts serves the built site on 127.0.0.1).
// The built site may not contain them; scripts/check-dist.mjs refuses them there.
//
// With --range <base> <head>, every path that a commit in base..head adds,
// copies or renames to must be on the list as well, so a file cannot enter the
// history in one commit and leave it in the next. A base of all zeros means
// every commit reachable from head. Only the paths of those commits are checked
// here; their content is covered by the secret scan in CI, not by the e-mail,
// path and host checks, which read the working tree.
//
// Usage: node scripts/check-tree.mjs [--range <base> <head>] [repo]   (repo
// defaults to the current directory)
// Exit codes: 0 clean, 1 violations found (all listed), 2 the check could not run
// (bad arguments, git unavailable, not a repository, no tracked files, unknown
// revision, unreadable file).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commitSha, isAllZeros } from './check-commits.mjs';
import { LOCAL_PATH_RE, PRIVATE_ADDRESS_RE, PRIVATE_KEY_RE, findEmails, findPrivateHostNames, where } from './check-dist.mjs';

/** Files at the top of the repository, by exact name. */
export const ROOT_FILES = [
  '.gitignore',
  '.nvmrc',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'index.html',
  'package-lock.json',
  'package.json',
  'playwright.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
];

/** Other files by exact path. */
export const EXACT_PATHS = [
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  'docs/ci.md',
  'docs/contributing.md',
  'docs/demo.gif',
  'docs/methodology.md',
  'docs/sources.md',
];

/** The one tracked file that is not text: the animation in the README. */
export const DEMO_GIF = 'docs/demo.gif';

/**
 * Size cap for DEMO_GIF: it loads with the README on every visit to the
 * repository page and stays in the history for good. The recording at 880 px
 * and about 11 frames per second needs well under half of this.
 */
export const DEMO_GIF_MAX_BYTES = 2 * 1024 * 1024;

/** Patterns for the folders that grow with the program. */
export const PATTERNS = [
  { what: 'page entry, styles and tests at the top of src/', re: /^src\/(?:main\.tsx|styles\.css|[a-z][a-z0-9-]*\.test\.ts)$/ },
  { what: 'page modules and their tests', re: /^src\/(?:data|engine|i18n|ui)\/[A-Za-z][A-Za-z0-9]*(?:\.test)?\.tsx?$/ },
  { what: 'translations', re: /^src\/i18n\/[a-z]{2}\.json$/ },
  { what: 'CI check scripts and their tests', re: /^scripts\/check-[a-z]+(?:\.test)?\.mjs$/ },
  { what: 'end-to-end tests', re: /^e2e\/[a-z][a-z0-9-]*(?:\.spec)?\.ts$/ },
];

const ALLOWED_EXACT = new Set([...ROOT_FILES, ...EXACT_PATHS]);

/** @param {string} path */
export function onList(path) {
  return ALLOWED_EXACT.has(path) || PATTERNS.some((p) => p.re.test(path));
}

/** Code files, where `x.local` is a property rather than a host name. */
const CODE_FILE_RE = /\.(?:[cm]?js|tsx?)$/;

/**
 * @typedef {{ path: string, rule: string, message: string }} Violation
 * @typedef {{ mode: string, path: string }} Entry
 * @typedef {{ base: string, head: string }} Range
 * @typedef {{ commits: number, paths: number, what: string }} HistoryResult
 */

/**
 * @param {string[]} args
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 */
function git(args, root, env) {
  try {
    return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException & { stderr?: string }} */ (err);
    if (e.code === 'ENOENT') throw new Error('git is not available');
    throw new Error(`git ${args[0]} failed in ${root}: ${String(e.stderr ?? e.message).trim()}`);
  }
}

/**
 * Tracked entries with their git modes.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Entry[]}
 */
export function trackedEntries(root, env = process.env) {
  const out = git(['ls-files', '--stage', '-z'], root, env);
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  for (const record of out.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const [mode = ''] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    entries.set(path, { mode, path }); // one entry per path, also during a merge
  }
  if (entries.size === 0) throw new Error(`no tracked files in ${root}`);
  return [...entries.values()];
}

/**
 * Every path that a commit in base..head adds, copies or renames to, with the
 * first commit that does so. Merge commits count with what they add themselves
 * (`--cc`); what a merge brings in is checked in the commits it brings.
 * @param {string} root
 * @param {Range} range
 * @param {NodeJS.ProcessEnv} env
 */
export function pathsAddedInHistory(root, range, env) {
  const opts = { cwd: root, env };
  const head = commitSha(range.head, opts);
  const revs = isAllZeros(range.base) ? [head] : [`${commitSha(range.base, opts)}..${head}`];
  const commits = git(['rev-list', '--reverse', ...revs, '--'], root, env).split('\n').filter((sha) => sha !== '');
  /** @type {Map<string, string>} path -> sha */
  const added = new Map();
  for (const sha of commits) {
    const out = git(['diff-tree', '-r', '-z', '--name-only', '--no-commit-id', '--root', '--cc', '--diff-filter=ACR', sha], root, env);
    for (const path of out.split('\0')) if (path !== '' && !added.has(path)) added.set(path, sha);
  }
  return { commits, added };
}

/** @param {Uint8Array} bytes */
function utf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * @typedef {{ width: number, height: number, frames: number, durationCs: number, loops: number | null }} GifInfo
 *   durationCs: the sum of the frame delays, in hundredths of a second; loops: the
 *   loop count of the NETSCAPE2.0 extension (0 = forever), null without one
 */

/**
 * Parses a GIF strictly and returns what it shows, or throws an Error that names
 * the first problem and its byte offset. The file may hold, in this order:
 *   - the header `GIF89a`;
 *   - the logical screen descriptor and its global colour table;
 *   - at most one NETSCAPE2.0 application extension, before the first image,
 *     holding exactly a loop count;
 *   - one or more images, each an optional graphic control extension (frame
 *     delay, transparency, disposal) directly followed by an image descriptor
 *     inside the logical screen, its local colour table and its LZW data. The
 *     data must decode to exactly width x height pixels of the colour table and
 *     end with the end code, followed by zero bits only;
 *   - the trailer, as the last byte of the file.
 * Refused: a comment, plain text or any other application extension (XMP,
 * colour profiles, other tools' data), an unknown block, GIF87a, bytes after
 * the end code of an image or after the trailer, a truncated file, and a file
 * larger than `maxBytes`. What is left is pixels, their colours and timing.
 * @param {Uint8Array} bytes
 * @param {number} [maxBytes]
 * @returns {GifInfo}
 */
export function parseGif(bytes, maxBytes = DEMO_GIF_MAX_BYTES) {
  let pos = 0;
  /** @param {string} message @returns {never} */
  const fail = (message) => {
    throw new Error(`${message} (at byte ${pos})`);
  };
  /** @param {number} n @param {string} what */
  const need = (n, what) => {
    if (pos + n > bytes.length) fail(`the file ends inside ${what}`);
  };
  /** @param {string} what */
  const u8 = (what) => {
    need(1, what);
    return /** @type {number} */ (bytes[pos++]);
  };
  /** @param {string} what */
  const u16 = (what) => u8(what) | (u8(what) << 8);
  /** @param {number} entries @param {string} what */
  const skipColourTable = (entries, what) => {
    need(3 * entries, what);
    pos += 3 * entries;
  };

  if (bytes.length > maxBytes) fail(`the file has ${bytes.length} bytes, more than the cap of ${maxBytes}`);
  need(6, 'the header');
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== 'GIF89a') fail(`the file starts with ${JSON.stringify(header)}, not with the GIF89a header`);
  pos = 6;
  const width = u16('the logical screen descriptor');
  const height = u16('the logical screen descriptor');
  const screenFlags = u8('the logical screen descriptor');
  u8('the logical screen descriptor'); // background colour index
  u8('the logical screen descriptor'); // pixel aspect ratio
  if (width === 0 || height === 0) fail('the logical screen has no area');
  const globalColours = screenFlags & 0x80 ? 2 << (screenFlags & 7) : 0;
  skipColourTable(globalColours, 'the global colour table');

  let frames = 0;
  let durationCs = 0;
  /** @type {number | null} */
  let loops = null;
  /** @type {number | null} delay of a graphic control extension that waits for its image */
  let pendingDelay = null;
  for (;;) {
    const block = u8('the block after the last one (no trailer)');
    if (block === 0x3b) {
      if (pendingDelay !== null) fail('a graphic control extension has no image after it');
      if (frames === 0) fail('the file holds no image');
      if (pos !== bytes.length) fail(`${bytes.length - pos} bytes follow the trailer`);
      return { width, height, frames, durationCs, loops };
    }
    if (block === 0x2c) {
      const left = u16('an image descriptor');
      const top = u16('an image descriptor');
      const w = u16('an image descriptor');
      const h = u16('an image descriptor');
      const flags = u8('an image descriptor');
      if (w === 0 || h === 0) fail('an image has no area');
      if (left + w > width || top + h > height) fail('an image reaches outside the logical screen');
      if (flags & 0x18) fail('an image descriptor has reserved bits set');
      const colours = flags & 0x80 ? 2 << (flags & 7) : globalColours;
      skipColourTable(flags & 0x80 ? colours : 0, 'a local colour table');
      if (colours === 0) fail('an image has no colour table');
      const minCodeSize = u8('the image data');
      if (minCodeSize < 2 || minCodeSize > 8) fail(`an image has the LZW code size ${minCodeSize}, not 2 to 8`);
      const start = pos;
      /** @type {Uint8Array[]} */
      const chunks = [];
      for (let size = u8('the image data'); size !== 0; size = u8('the image data')) {
        need(size, 'an image data sub-block');
        chunks.push(bytes.subarray(pos, pos + size));
        pos += size;
      }
      const problem = lzwProblem(concatBytes(chunks), minCodeSize, w * h, colours);
      if (problem !== null) {
        pos = start;
        fail(`the data of image ${frames + 1} ${problem}`);
      }
      frames++;
      durationCs += pendingDelay ?? 0;
      pendingDelay = null;
      continue;
    }
    if (block !== 0x21) fail(`unknown block type 0x${block.toString(16)}`);
    const label = u8('an extension');
    if (label === 0xfe) fail('a comment extension is not allowed');
    if (label === 0x01) fail('a plain text extension is not allowed');
    if (label !== 0xf9 && label !== 0xff) fail(`unknown extension 0x${label.toString(16)}`);
    if (pendingDelay !== null) fail('a graphic control extension is not directly followed by its image');
    if (label === 0xf9) {
      if (u8('a graphic control extension') !== 4) fail('a graphic control extension does not have 4 bytes');
      const flags = u8('a graphic control extension');
      const delay = u16('a graphic control extension');
      u8('a graphic control extension'); // transparent colour index
      if (flags & 0xe0) fail('a graphic control extension has reserved bits set');
      if (((flags >> 2) & 7) > 3) fail('a graphic control extension has an undefined disposal method');
      if (u8('a graphic control extension') !== 0) fail('a graphic control extension has more than one sub-block');
      pendingDelay = delay;
      continue;
    }
    const idSize = u8('an application extension');
    need(idSize, 'an application extension');
    const id = String.fromCharCode(...bytes.subarray(pos, pos + idSize));
    if (idSize !== 11 || id !== 'NETSCAPE2.0') {
      fail(`the application extension ${JSON.stringify(id)} is not allowed; only NETSCAPE2.0 (the loop count) is`);
    }
    pos += idSize;
    if (loops !== null) fail('a second NETSCAPE2.0 extension is not allowed');
    if (frames > 0) fail('the NETSCAPE2.0 extension comes after the first image');
    if (u8('the NETSCAPE2.0 extension') !== 3 || u8('the NETSCAPE2.0 extension') !== 1) {
      fail('the NETSCAPE2.0 extension holds something other than a loop count');
    }
    loops = u16('the NETSCAPE2.0 extension');
    if (u8('the NETSCAPE2.0 extension') !== 0) fail('the NETSCAPE2.0 extension has more than one sub-block');
  }
}

/** @param {Uint8Array[]} chunks */
function concatBytes(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Decodes GIF LZW data far enough to count its pixels, without building them:
 * null when the codes give exactly `pixels` pixels, each a colour of the table
 * (`colours` entries), and the end code follows with nothing but zero bits after
 * it; otherwise what is wrong.
 * @param {Uint8Array} data
 * @param {number} minCodeSize
 * @param {number} pixels
 * @param {number} colours
 * @returns {string | null}
 */
function lzwProblem(data, minCodeSize, pixels, colours) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  // The length in pixels of each table entry. A new entry is the previous
  // code's pixels plus one, so lengths are all the count needs.
  const length = new Uint32Array(4096);
  /** @param {number} c */
  const lengthOf = (c) => (c < clear ? 1 : /** @type {number} */ (length[c]));
  const bits = data.length * 8;
  let bit = 0;
  let size = minCodeSize + 1;
  let next = end + 1;
  let prev = -1;
  let count = 0;
  for (;;) {
    if (bit + size > bits) return 'ends before the end code';
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= (((data[bit >> 3] ?? 0) >> (bit & 7)) & 1) << i;
    if (code === clear) {
      size = minCodeSize + 1;
      next = end + 1;
      prev = -1;
      continue;
    }
    if (code === end) break;
    let len;
    if (code < clear) {
      // Every pixel comes from a code below the clear code: checking these checks all colours.
      if (code >= colours) return `uses colour ${code}, outside its table of ${colours}`;
      len = 1;
    } else if (code > end && code < next) {
      len = lengthOf(code);
    } else if (code === next && prev !== -1) {
      len = lengthOf(prev) + 1;
    } else {
      return `has the code ${code}, which is not in the table`;
    }
    count += len;
    if (count > pixels) return `holds more pixels than the image (${pixels})`;
    if (prev !== -1 && next < 4096) {
      length[next] = lengthOf(prev) + 1;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    prev = code;
  }
  if (count !== pixels) return `holds ${count} pixels, the image ${pixels}`;
  for (; bit < bits; bit++) {
    if (((data[bit >> 3] ?? 0) >> (bit & 7)) & 1) return 'has data after the end code';
  }
  return null;
}

/**
 * @param {string} rootDir
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Range} [range] also check the paths that commits in base..head add
 * @returns {{ violations: Violation[], checked: number, scanned: number, gif: GifInfo | null, history: HistoryResult | null }}
 */
export function checkTree(rootDir, env = process.env, range) {
  const root = resolve(rootDir);
  const entries = trackedEntries(root, env);
  /** @type {Violation[]} */
  const violations = [];
  let scanned = 0;
  /** @type {GifInfo | null} */
  let gif = null;
  for (const { mode, path } of entries) {
    /** @param {string} rule @param {string} message */
    const add = (rule, message) => violations.push({ path, rule, message });
    if (!onList(path)) {
      add(
        'not-listed',
        'is not on the list of files that belong in this repository. Adding a file means adding its path to the list in scripts/check-tree.mjs in the same pull request.',
      );
    }
    if (mode === '120000') add('symlink', 'is a symlink; commit the file itself');
    else if (mode === '160000') add('submodule', 'is a submodule; the repository takes no submodules');
    else if (mode === '100755') add('executable', 'has the executable bit; no file here needs it (git update-index --chmod=-x)');
    else if (mode !== '100644') add('mode', `has the unexpected git mode ${mode}`);
    if (mode !== '100644' && mode !== '100755') continue;

    let bytes;
    try {
      bytes = readFileSync(join(root, path));
    } catch {
      add('missing', 'is tracked but missing from the working tree');
      continue;
    }
    if (path === DEMO_GIF) {
      try {
        gif = parseGif(bytes);
      } catch (err) {
        add('gif', `must be a GIF that holds images and nothing else: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }
    const nul = bytes.indexOf(0);
    if (nul !== -1) {
      add('encoding', `has a NUL byte at offset ${nul} (binary data or UTF-16 text); tracked files must be UTF-8 text`);
      continue;
    }
    const text = utf8(bytes);
    if (text === null) {
      add('encoding', 'is not valid UTF-8; tracked files must be UTF-8 text');
      continue;
    }
    scanned++;
    for (const m of findEmails(text)) {
      add('email', `contains an e-mail address at ${where(text, m.index, m.value.length)}`);
    }
    for (const m of text.matchAll(LOCAL_PATH_RE)) {
      add('local-path', `contains an absolute local path at ${where(text, m.index, m[0].length)}`);
    }
    for (const m of text.matchAll(PRIVATE_KEY_RE)) {
      add('private-key', `contains a private key header at ${where(text, m.index, m[0].length)}`);
    }
    for (const m of text.matchAll(PRIVATE_ADDRESS_RE)) {
      add('private-host', `contains a private network address (RFC 1918) at ${where(text, m.index, m[0].length)}`);
    }
    if (!CODE_FILE_RE.test(path)) {
      for (const m of findPrivateHostNames(text)) {
        add('private-host', `contains the private host name ${m.value} at ${where(text, m.index, m.value.length)}`);
      }
    }
  }

  /** @type {HistoryResult | null} */
  let history = null;
  if (range) {
    const { commits, added } = pathsAddedInHistory(root, range, env);
    for (const [path, sha] of added) {
      if (onList(path)) continue;
      const subject = git(['log', '-1', '--format=%s', sha, '--'], root, env).trim();
      violations.push({
        path,
        rule: 'history',
        message: `is added in commit ${sha.slice(0, 12)} "${subject}" and is not on the list. No commit may add such a file, not even one that a later commit removes: rewrite the branch so that no commit adds it.`,
      });
    }
    const what = isAllZeros(range.base) ? `all commits of ${range.head}` : `${range.base}..${range.head}`;
    history = { commits: commits.length, paths: added.size, what };
  }
  return { violations, checked: entries.length, scanned, gif, history };
}

const USAGE = 'usage: node scripts/check-tree.mjs [--range <base> <head>] [repo]   (npm run check:tree -- --range <base> <head>)';

/** @param {string[]} argv */
function main(argv) {
  /** @type {Range | undefined} */
  let range;
  let args = argv;
  if (args[0] === '--range') {
    const [, base, head, ...rest] = args;
    if (!base || !head) {
      console.error(USAGE);
      return 2;
    }
    range = { base, head };
    args = rest;
  }
  if (args.length > 1 || args[0]?.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const root = args[0] ?? '.';
  let result;
  try {
    result = checkTree(root, process.env, range);
  } catch (err) {
    console.error(`check:tree: the check could not run: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const { violations, checked, scanned, gif, history } = result;
  if (violations.length === 0) {
    const inHistory = history
      ? `; ${history.paths} paths added in the ${history.commits} commit(s) of ${history.what}, all on the list`
      : '';
    const animation = gif
      ? `; ${DEMO_GIF} holds images only (${gif.width}x${gif.height}, ${gif.frames} frames, ${(gif.durationCs / 100).toFixed(2)} s)`
      : '';
    console.log(
      `check:tree: ${checked} tracked files, all on the list; no symlinks, submodules or executables; ${scanned} UTF-8 text files without e-mail addresses, local paths, private keys or private network addresses${animation}${inHistory}`,
    );
    return 0;
  }
  console.error(`check:tree: ${violations.length} violation(s) in ${checked} tracked files${history ? ` and ${history.commits} commit(s)` : ''}:`);
  for (const v of violations) console.error(`  ${v.path}: [${v.rule}] ${v.message}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
