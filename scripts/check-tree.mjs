#!/usr/bin/env node
// The repository holds only what belongs to the program.
//
// Every tracked file (`git ls-files`) must match an entry of the allow-list
// below: the page's source and tests, the check scripts, the end-to-end tests,
// the listed docs and the demo animation with its recording script, the two
// files under .github/, the collector's Python modules and tests, the five
// synthetic fixture files, the data file the collector writes for the site
// (src/data/sourced.json), and a few root files by exact name. Anything else
// fails: personal tool settings, editor folders, notes, dumps and scratch
// files stay out without being named one by one. Adding a file to the
// repository means adding its path to this list in the same pull request,
// where the reviewer sees it.
//
// Also refused:
//   - symlinks, submodules and executable files (none are needed: the scripts
//     run through `node`);
//   - files that are not UTF-8 text: a NUL byte (binary data, UTF-16 text) or
//     invalid UTF-8. The content checks below read UTF-8 only, so such a file
//     would otherwise pass unread. One path is the exception: docs/demo.gif,
//     the animation in the README, must instead be a GIF animation in the one
//     form that parseGif below allows. That stops the metadata blocks that
//     tools write (comments, XMP, colour profiles, other application data)
//     and anything appended, and caps the file at 2 MiB, 880x880 pixels, 400
//     frames and 60 s. It does not stop data hidden on purpose in the pixels,
//     in unused colour-table entries or in the fields the format leaves free
//     (parseGif lists them): that is for the reviewer, who sees the
//     animation, and for the caps. The file gets no text checks;
//   - in every tracked text file: e-mail addresses (none at all), absolute paths
//     from a developer's machine, private key headers and private network
//     addresses (RFC 1918). Tests that need such strings put them together at
//     run time;
//   - in every tracked text file except code (.js, .mjs, .ts, .tsx): host names
//     in a private namespace (*.local, *.lan, *.internal). In code, `x.local` is
//     usually a property, as in the built bundle. Python files (collector/) are
//     held to this rule on purpose: the collector handles data from outside, so
//     no attribute there may be named local, lan or internal.
// Loopback addresses (localhost, 127.0.0.1, ::1) are not looked for here: they
// are the same on every machine, reveal nothing about a person, and the test
// setup needs them (playwright.config.ts serves the built site on 127.0.0.1).
// The built site may not contain them; scripts/check-dist.mjs refuses them there.
//
// With --range <base> <head>, every path that a commit in base..head adds,
// copies or renames to must be on the list as well, so a file cannot enter the
// history in one commit and leave it in the next, and every version of
// docs/demo.gif that such a commit writes must pass parseGif too. A base of
// all zeros means every commit reachable from head. Apart from that file, only
// the paths of those commits are checked here; their content is covered by the
// secret scan in CI, not by the e-mail, path and host checks, which read the
// working tree.
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
  'bovenbouw.html',
  'deuren.html',
  'index.html',
  'onderbouw.html',
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
  'collector/.python-version',
  'collector/fixtures/synthetic/expected.json',
  'collector/fixtures/synthetic/extract.tsv',
  'collector/fixtures/synthetic/lock.json',
  'collector/fixtures/synthetic/professions.tsv',
  'collector/fixtures/synthetic/subjects.tsv',
  'docs/ci.md',
  'docs/collector.md',
  'docs/contributing.md',
  'docs/demo.gif',
  'docs/methodology.md',
  'docs/sources.md',
  'scripts/record-demo.mjs',
  'src/data/sourced.json',
];

/** The one tracked file that is not text: the animation in the README. */
export const DEMO_GIF = 'docs/demo.gif';

/**
 * Size cap for DEMO_GIF: it loads with the README on every visit to the
 * repository page and stays in the history for good. The recording at 880 px
 * and about 11 frames per second needs well under half of this.
 */
export const DEMO_GIF_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The largest width and height of DEMO_GIF, in pixels. The README column on
 * github.com is 880 pixels wide and the recording is made for that width; the
 * same height leaves room for a taller page. It also bounds what a viewer has
 * to decode per frame.
 */
export const DEMO_GIF_MAX_SIDE = 880;

/**
 * The shortest frame delay of DEMO_GIF, in hundredths of a second. Browsers
 * show a delay of 0 or 1 as a tenth of a second, so such a frame never runs as
 * written, and other viewers skip a frame with no delay at all.
 */
export const DEMO_GIF_MIN_DELAY_CS = 2;

/**
 * The most frames DEMO_GIF may have. Every frame brings fields that the parse
 * leaves free (its delay, its place on the screen) and has to be decoded by
 * every viewer, and the size cap alone would let in over 80,000 frames of one
 * pixel each. The recording at about 11 frames per second has under a fifth of
 * this.
 */
export const DEMO_GIF_MAX_FRAMES = 400;

/**
 * The longest DEMO_GIF may run once through, the sum of its frame delays, in
 * hundredths of a second: 60 s. The recording runs under a third of this.
 */
export const DEMO_GIF_MAX_DURATION_CS = 6000;

/** Patterns for the folders that grow with the program. */
export const PATTERNS = [
  {
    what: 'page entries, styles and tests at the top of src/',
    re: /^src\/(?:(?:main|doors|onderbouw|bovenbouw)\.tsx|(?:styles|doors|onderbouw|bovenbouw)\.css|[a-z][a-z0-9-]*\.test\.ts)$/,
  },
  { what: 'page modules and their tests', re: /^src\/(?:data|engine|i18n|ui)\/[A-Za-z][A-Za-z0-9]*(?:\.test)?\.tsx?$/ },
  { what: 'translations', re: /^src\/i18n\/[a-z]{2}\.json$/ },
  { what: 'CI check scripts and their tests', re: /^scripts\/check-[a-z]+(?:\.test)?\.mjs$/ },
  { what: 'end-to-end tests', re: /^e2e\/[a-z][a-z0-9-]*(?:\.spec)?\.ts$/ },
  // Flat modules only; collector/tests/test_layout.py checks that none shares a name with the standard library.
  { what: 'collector modules (Python, standard library only)', re: /^collector\/[a-z]+\.py$/ },
  { what: 'collector unit tests', re: /^collector\/tests\/(?:__init__|test_[a-z]+)\.py$/ },
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
 * @typedef {{ commits: number, paths: number, gifVersions: number, what: string }} HistoryResult
 */

/** What DEMO_GIF must be, for the messages. */
const GIF_FORM = 'a GIF animation in the form that parseGif in scripts/check-tree.mjs allows';

/**
 * Runs git and returns its output as bytes.
 * @param {string[]} args
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [input] written to git's standard input
 */
function gitBytes(args, root, env, input) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      env,
      input,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException & { stderr?: string }} */ (err);
    if (e.code === 'ENOENT') throw new Error('git is not available');
    throw new Error(`git ${args[0]} failed in ${root}: ${String(e.stderr ?? e.message).trim()}`);
  }
}

/**
 * @param {string[]} args
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {string} [input] written to git's standard input
 */
function git(args, root, env, input) {
  return gitBytes(args, root, env, input).toString('utf8');
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
 * @typedef {{ width: number, height: number, frames: number, durationCs: number }} GifInfo
 *   durationCs: the sum of the frame delays, in hundredths of a second
 */

/**
 * Parses DEMO_GIF and returns what it shows, or throws an Error that names the
 * first problem and its byte offset. The file must be a looping GIF animation
 * in exactly this form, which is what scripts/record-demo.mjs writes:
 *   - the header `GIF89a`;
 *   - the logical screen descriptor, at most DEMO_GIF_MAX_SIDE pixels wide and
 *     high, without a pixel aspect ratio, and its global colour table;
 *   - one NETSCAPE2.0 application extension, before the first image, holding
 *     only the loop count 0 (forever);
 *   - one to DEMO_GIF_MAX_FRAMES frames, each a graphic control extension (a
 *     delay of at least DEMO_GIF_MIN_DELAY_CS, transparency, disposal 0 to 3,
 *     no wait for user input) directly followed by an image descriptor inside
 *     the screen, without a local colour table, and its LZW data. The data
 *     must decode to exactly width x height pixels of the global colour table
 *     and end with the end code, followed by zero bits only, at most one byte
 *     past the end code's own. The delays add up to at most
 *     DEMO_GIF_MAX_DURATION_CS;
 *   - the trailer, as the last byte of the file;
 * and the file is at most `maxBytes` long.
 *
 * What this stops: the blocks that tools add to a GIF on their own (comments,
 * plain text, XMP and other metadata, colour profiles, any other application
 * data), anything appended after an image's data or after the trailer, a
 * truncated file, colour tables per frame, and files, screens, frame counts or
 * running times larger than the caps. What it does not stop: data hidden on
 * purpose where the format leaves room. That is in the pixels; in global
 * colour-table entries that no pixel uses; in the fields this parse leaves
 * free: in the screen descriptor the background colour index, the colour
 * resolution, the sort flag and the size of the global colour table, and in
 * each frame the delay (within the caps), the transparency flag and the
 * transparent colour index, the disposal method, the image's position and size
 * inside the screen, the interlace flag and the LZW code size; and in how the
 * encoder codes the pixels (where it puts clear codes, how it splits the data
 * into sub-blocks, whether one zero byte follows the end code). That is for
 * the reviewer, who sees the animation, and for the caps.
 * @param {Uint8Array} bytes
 * @param {number} [maxBytes]
 * @returns {GifInfo}
 */
export function parseGif(bytes, maxBytes = DEMO_GIF_MAX_BYTES) {
  let pos = 0;
  /** @type {(message: string) => never} */
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

  if (bytes.length > maxBytes) fail(`the file has ${bytes.length} bytes, more than the cap of ${maxBytes}`);
  need(6, 'the header');
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== 'GIF89a') fail(`the file starts with ${JSON.stringify(header)}, not with the GIF89a header`);
  pos = 6;
  const width = u16('the logical screen descriptor');
  const height = u16('the logical screen descriptor');
  const screenFlags = u8('the logical screen descriptor');
  u8('the logical screen descriptor'); // background colour index
  const aspect = u8('the logical screen descriptor');
  if (width === 0 || height === 0) fail('the logical screen has no area');
  if (width > DEMO_GIF_MAX_SIDE || height > DEMO_GIF_MAX_SIDE) {
    fail(`the logical screen is ${width}x${height} pixels, more than ${DEMO_GIF_MAX_SIDE} on a side`);
  }
  if (aspect !== 0) fail('the logical screen sets a pixel aspect ratio');
  if (!(screenFlags & 0x80)) fail('the file has no global colour table');
  const colours = 2 << (screenFlags & 7);
  need(3 * colours, 'the global colour table');
  pos += 3 * colours;

  let frames = 0;
  let durationCs = 0;
  let looping = false;
  /** @type {number | null} delay of a graphic control extension that waits for its image */
  let pendingDelay = null;
  for (;;) {
    const block = u8('the block after the last one (no trailer)');
    if (block === 0x3b) {
      if (pendingDelay !== null) fail('a graphic control extension has no image after it');
      if (frames === 0) fail('the file holds no image');
      if (pos !== bytes.length) fail(`${bytes.length - pos} bytes follow the trailer`);
      return { width, height, frames, durationCs };
    }
    if (block === 0x2c) {
      if (!looping) fail('the NETSCAPE2.0 extension that makes the animation loop must come before the first image');
      if (pendingDelay === null) fail(`image ${frames + 1} has no graphic control extension (frame delay) before it`);
      if (frames === DEMO_GIF_MAX_FRAMES) fail(`the animation has more than ${DEMO_GIF_MAX_FRAMES} frames`);
      if (durationCs + pendingDelay > DEMO_GIF_MAX_DURATION_CS) {
        fail(`the frame delays add up to more than ${DEMO_GIF_MAX_DURATION_CS} hundredths of a second`);
      }
      const left = u16('an image descriptor');
      const top = u16('an image descriptor');
      const w = u16('an image descriptor');
      const h = u16('an image descriptor');
      const flags = u8('an image descriptor');
      if (w === 0 || h === 0) fail('an image has no area');
      if (left + w > width || top + h > height) fail('an image reaches outside the logical screen');
      if (flags & 0x80) fail('an image has a local colour table; only the global one is allowed');
      // Without a local table its sort flag and size mean nothing; the rest is reserved. Interlacing may stay.
      if (flags & 0x3f) fail('an image descriptor sets reserved or local colour table bits');
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
      durationCs += pendingDelay;
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
      if (flags & 0x02) fail('a graphic control extension waits for user input');
      if (delay < DEMO_GIF_MIN_DELAY_CS) {
        fail(`a frame has a delay of ${delay} hundredths of a second, less than ${DEMO_GIF_MIN_DELAY_CS}`);
      }
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
    // An image needs the extension before it, so one that comes later is always a second one.
    if (looping) fail('a second NETSCAPE2.0 extension is not allowed');
    if (u8('the NETSCAPE2.0 extension') !== 3 || u8('the NETSCAPE2.0 extension') !== 1) {
      fail('the NETSCAPE2.0 extension holds something other than a loop count');
    }
    const loops = u16('the NETSCAPE2.0 extension');
    if (loops !== 0) fail(`the NETSCAPE2.0 extension sets ${loops} loops; the animation must loop forever (0)`);
    if (u8('the NETSCAPE2.0 extension') !== 0) fail('the NETSCAPE2.0 extension has more than one sub-block');
    looping = true;
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
 * (`colours` entries), and the end code follows with nothing after it but zero
 * bits: the rest of its byte and at most one more byte, which some encoders
 * write; otherwise what is wrong.
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
  const after = data.length - Math.ceil(bit / 8);
  if (after > 1) return `has ${after} bytes after the end code`;
  for (; bit < bits; bit++) {
    if (((data[bit >> 3] ?? 0) >> (bit & 7)) & 1) return 'has data after the end code';
  }
  return null;
}

/**
 * What `git ls-tree` lists at DEMO_GIF in a commit for which git cat-file
 * reports the path missing: nothing (null), or a submodule entry (mode 160000).
 * Any other entry means its object is not in the repository, and the check
 * cannot read it.
 * @param {string} root
 * @param {string} sha
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ object: string, type: string, size: number } | null}
 */
function submoduleEntry(root, sha, env) {
  const records = git(['ls-tree', '-z', sha, '--', DEMO_GIF], root, env)
    .split('\0')
    .filter((r) => r !== '');
  if (records.length === 0) return null;
  const m = /^(\d{6}) (\S+) ([0-9a-f]{40,64})\t(.*)$/s.exec(records[0] ?? '');
  if (records.length === 1 && m && m[4] === DEMO_GIF && m[1] === '160000') return { object: m[3] ?? '', type: 'submodule', size: 0 };
  throw new Error(`git cat-file reports ${sha}:${DEMO_GIF} missing, but git ls-tree lists: ${records.join(' | ')}`);
}

/**
 * Every version of DEMO_GIF that a commit in base..head writes: the object at
 * that path in the commit's tree when none of the commit's parents has the same
 * object there. That is a commit that adds, changes, copies or renames a file
 * to the path; a merge counts only with a version that none of its sides had
 * (the sides' own commits are in the range or in the base). A deletion writes
 * nothing. Each distinct object once, with the first commit that writes it.
 * @param {string} root
 * @param {Range} range
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ sha: string, object: string, type: string, size: number }[]}
 */
export function demoGifVersionsInHistory(root, range, env) {
  const opts = { cwd: root, env };
  const head = commitSha(range.head, opts);
  const revs = isAllZeros(range.base) ? [head] : [`${commitSha(range.base, opts)}..${head}`];
  const commits = git(['rev-list', '--reverse', '--parents', ...revs, '--'], root, env)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha = '', ...parents] = line.split(' ');
      return { sha, parents };
    });
  const shas = [...new Set(commits.flatMap((c) => [c.sha, ...c.parents]))];
  if (shas.length === 0) return [];
  // One line per `<commit>:<path>`: "<object> <type> <size>"; "<object> submodule" for a submodule
  // entry whose commit is not in this repository (it has no type or size here); or "<commit>:<path>
  // missing". Older git prints "missing" for such a submodule entry too, so a "missing" is confirmed
  // with git ls-tree, which lists the entry with its mode on every git version.
  const lines = git(['cat-file', '--batch-check'], root, env, shas.map((sha) => `${sha}:${DEMO_GIF}\n`).join('')).split('\n');
  /** @type {Map<string, { object: string, type: string, size: number } | null>} */
  const at = new Map();
  shas.forEach((sha, i) => {
    const line = lines[i] ?? '';
    const m = /^([0-9a-f]{40,64}) (\S+) (\d+)$/.exec(line);
    const submodule = /^([0-9a-f]{40,64}) submodule$/.exec(line);
    if (m) at.set(sha, { object: m[1] ?? '', type: m[2] ?? '', size: Number(m[3]) });
    else if (submodule) at.set(sha, { object: submodule[1] ?? '', type: 'submodule', size: 0 });
    else if (line === `${sha}:${DEMO_GIF} missing`) at.set(sha, submoduleEntry(root, sha, env));
    else throw new Error(`git cat-file gave an unexpected line for ${sha}:${DEMO_GIF}: ${line}`);
  });
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {{ sha: string, object: string, type: string, size: number }[]} */
  const versions = [];
  for (const { sha, parents } of commits) {
    const version = at.get(sha);
    if (!version || seen.has(version.object)) continue;
    if (parents.some((p) => at.get(p)?.object === version.object)) continue;
    seen.add(version.object);
    versions.push({ sha, ...version });
  }
  return versions;
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
        add('gif', `must be ${GIF_FORM}: ${err instanceof Error ? err.message : String(err)}`);
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
    // The parse above reads the working tree only; every version a commit wrote stays in the history.
    const versions = demoGifVersionsInHistory(root, range, env);
    for (const { sha, object, type, size } of versions) {
      let problem = null;
      if (type !== 'blob') problem = `it is a ${type}, not a file`;
      else if (size > DEMO_GIF_MAX_BYTES) problem = `the file has ${size} bytes, more than the cap of ${DEMO_GIF_MAX_BYTES}`;
      else {
        try {
          parseGif(gitBytes(['cat-file', 'blob', object], root, env));
        } catch (err) {
          problem = err instanceof Error ? err.message : String(err);
        }
      }
      if (problem === null) continue;
      const subject = git(['log', '-1', '--format=%s', sha, '--'], root, env).trim();
      violations.push({
        path: DEMO_GIF,
        rule: 'history-gif',
        message: `the version that commit ${sha.slice(0, 12)} "${subject}" writes is not ${GIF_FORM}: ${problem}. A later commit that replaces it does not take it out of the history: rewrite the branch so that no commit writes such a version.`,
      });
    }
    const what = isAllZeros(range.base) ? `all commits of ${range.head}` : `${range.base}..${range.head}`;
    history = { commits: commits.length, paths: added.size, gifVersions: versions.length, what };
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
      ? `; ${history.paths} paths added in the ${history.commits} commit(s) of ${history.what}, all on the list, and ${history.gifVersions} version(s) of ${DEMO_GIF} written in them, all in the allowed form`
      : '';
    const animation = gif
      ? `; ${DEMO_GIF} is a GIF animation in the allowed form (${gif.width}x${gif.height}, ${gif.frames} frames, ${(gif.durationCs / 100).toFixed(2)} s)`
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
