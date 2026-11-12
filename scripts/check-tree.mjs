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
//   - in every tracked text file: e-mail addresses (none at all), absolute paths
//     from a developer's machine, private key headers. Tests that need such
//     strings put them together at run time.
//
// Usage: node scripts/check-tree.mjs [repo]   (default: the current directory)
// Exit codes: 0 clean, 1 violations found (all listed), 2 the check could not run
// (git unavailable, not a repository, no tracked files, unreadable file).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCAL_PATH_RE, PRIVATE_KEY_RE, findEmails, where } from './check-dist.mjs';

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

/**
 * @typedef {{ path: string, rule: string, message: string }} Violation
 * @typedef {{ mode: string, path: string }} Entry
 */

/**
 * Tracked entries with their git modes.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Entry[]}
 */
export function trackedEntries(root, env = process.env) {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '--stage', '-z'], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException & { stderr?: string }} */ (err);
    if (e.code === 'ENOENT') throw new Error('git is not available');
    throw new Error(`git ls-files failed in ${root}: ${String(e.stderr ?? e.message).trim()}`);
  }
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
 * @param {string} rootDir
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ violations: Violation[], checked: number, scanned: number }}
 */
export function checkTree(rootDir, env = process.env) {
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
    if (bytes.subarray(0, 8000).includes(0)) continue; // binary: not on the list anyway
    scanned++;
    const text = bytes.toString('utf8');
    for (const m of findEmails(text)) {
      add('email', `contains an e-mail address at ${where(text, m.index, m.value.length)}`);
    }
    for (const m of text.matchAll(LOCAL_PATH_RE)) {
      add('local-path', `contains an absolute local path at ${where(text, m.index, m[0].length)}`);
    }
    for (const m of text.matchAll(PRIVATE_KEY_RE)) {
      add('private-key', `contains a private key header at ${where(text, m.index, m[0].length)}`);
    }
  }
  return { violations, checked: entries.length, scanned };
}

/** @param {string[]} argv */
function main(argv) {
  const root = argv[0] ?? '.';
  let result;
  try {
    result = checkTree(root);
  } catch (err) {
    console.error(`check:tree: the check could not run: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const { violations, checked, scanned } = result;
  if (violations.length === 0) {
    console.log(
      `check:tree: ${checked} tracked files, all on the list; no symlinks, submodules or executables; ${scanned} text files without e-mail addresses, local paths or private keys`,
    );
    return 0;
  }
  console.error(`check:tree: ${violations.length} violation(s) in ${checked} tracked files:`);
  for (const v of violations) console.error(`  ${v.path}: [${v.rule}] ${v.message}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
