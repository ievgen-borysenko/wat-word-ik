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
//     would otherwise pass unread;
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
  'docs/methodology.md',
  'docs/sources.md',
];

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
 * @param {string} rootDir
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Range} [range] also check the paths that commits in base..head add
 * @returns {{ violations: Violation[], checked: number, scanned: number, history: HistoryResult | null }}
 */
export function checkTree(rootDir, env = process.env, range) {
  const root = resolve(rootDir);
  const entries = trackedEntries(root, env);
  /** @type {Violation[]} */
  const violations = [];
  let scanned = 0;
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
  return { violations, checked: entries.length, scanned, history };
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
  const { violations, checked, scanned, history } = result;
  if (violations.length === 0) {
    const inHistory = history
      ? `; ${history.paths} paths added in the ${history.commits} commit(s) of ${history.what}, all on the list`
      : '';
    console.log(
      `check:tree: ${checked} tracked files, all on the list; no symlinks, submodules or executables; ${scanned} UTF-8 text files without e-mail addresses, local paths, private keys or private network addresses${inHistory}`,
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
