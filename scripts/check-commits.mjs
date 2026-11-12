#!/usr/bin/env node
// Checks commits before they become public: a personal e-mail address that
// slips into one commit stays in the public history for good.
//
// For every commit in <base>..<head>:
//   - the author and the committer e-mail are GitHub noreply addresses: the
//     personal form <digits>+<login> at users.noreply.github.com (bot logins
//     such as dependabot[bot] included), or GitHub's own noreply address, which
//     GitHub uses as committer of web merges and bot commits;
//   - every e-mail address anywhere in the message (subject and body) follows
//     the same rule. The only exception is GitHub's support address in the
//     sign-off trailer that Dependabot writes ("Signed-off-by: dependabot[bot]");
//   - the message has no trailers other than Co-Authored-By and Signed-off-by.
//     Trailers are parsed by git itself (`git interpret-trailers --parse
//     --no-divider`), so a "key: value" line inside the message body, such as
//     the YAML block of a Dependabot message, is not mistaken for a trailer.
//
// The raw addresses of the commit objects are read (%ae/%ce), not the ones a
// .mailmap rewrites for display.
//
// No address is written literally in this file: the repository check
// (scripts/check-tree.mjs) refuses e-mail addresses in tracked files.
//
// Usage: node scripts/check-commits.mjs <base> <head>
//   <base> of all zeros means: every commit reachable from <head> (CI uses this
//   on pushes, so a cancelled earlier run never leaves commits unchecked).
// Exit codes: 0 clean, 1 violations found (all listed), 2 usage or git error.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findEmails } from './check-dist.mjs';

const AT = '@';

/** A personal or bot noreply address of a GitHub account: <digits>+<login>@users.noreply.github.com. */
export const NOREPLY_RE = /^\d+\+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\[bot\])?@users\.noreply\.github\.com$/i;

/** GitHub's own noreply address (committer of web merges and of signed bot commits). */
export const GITHUB_NOREPLY = `noreply${AT}github.com`;

/** The sign-off value Dependabot writes; the only place GitHub's support address may appear. */
export const DEPENDABOT_SIGN_OFF = `dependabot[bot] <support${AT}github.com>`;

/** Trailer keys allowed in a commit message (compared without regard to case). */
export const TRAILER_KEYS = ['Co-Authored-By', 'Signed-off-by'];

/**
 * @typedef {{ sha: string, authorEmail: string, committerEmail: string, subject: string, message: string }} Commit
 * @typedef {{ key: string, value: string }} Trailer
 * @typedef {{ sha: string, rule: string, message: string }} Violation
 * @typedef {{ cwd?: string, env?: NodeJS.ProcessEnv }} GitOptions
 */

/** @param {string} address */
export function allowedAddress(address) {
  const a = address.toLowerCase();
  return a === GITHUB_NOREPLY || NOREPLY_RE.test(a);
}

/**
 * @param {string[]} args
 * @param {GitOptions} opts
 * @param {string} [input]
 */
function git(args, opts, input) {
  return execFileSync('git', args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Resolves `rev` to a commit SHA or throws a clear error.
 * @param {string} rev
 * @param {GitOptions} opts
 */
function commitSha(rev, opts) {
  try {
    return git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`], opts).trim();
  } catch {
    throw new Error(`"${rev}" is not a commit in this repository (is the history fetched? use fetch-depth: 0)`);
  }
}

/**
 * Commits in base..head, oldest first; an all-zero base means every commit of head.
 * @param {string} base
 * @param {string} head
 * @param {GitOptions} [opts]
 * @returns {Commit[]}
 */
export function listCommits(base, head, opts = {}) {
  const headSha = commitSha(head, opts);
  const range = /^0+$/.test(base) ? [headSha] : [`${commitSha(base, opts)}..${headSha}`];
  const out = git(['log', '--reverse', '--no-mailmap', '--format=%H%x1f%ae%x1f%ce%x1f%B%x1e', ...range, '--'], opts);
  return out
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec !== '')
    .map((rec) => {
      const [sha = '', authorEmail = '', committerEmail = '', message = ''] = rec.split('\x1f');
      return { sha, authorEmail, committerEmail, subject: message.split('\n')[0] ?? '', message };
    });
}

/**
 * The trailers of a commit message, as git reads them.
 * @param {string} message
 * @param {GitOptions} [opts]
 * @returns {Trailer[]}
 */
export function parseTrailers(message, opts = {}) {
  const out = git(['interpret-trailers', '--parse', '--no-divider'], opts, message);
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const sep = line.indexOf(':');
      return sep === -1 ? { key: line.trim(), value: '' } : { key: line.slice(0, sep).trim(), value: line.slice(sep + 1).trim() };
    });
}

/**
 * @param {Commit} c
 * @param {Trailer[]} trailers
 * @returns {Violation[]}
 */
export function checkCommit(c, trailers) {
  /** @type {Violation[]} */
  const violations = [];
  const short = c.sha.slice(0, 12);
  /** @param {string} rule @param {string} message */
  const add = (rule, message) => violations.push({ sha: c.sha, rule, message: `${short} "${c.subject}": ${message}` });

  if (!allowedAddress(c.authorEmail)) add('author', `author e-mail <${c.authorEmail}> is not a GitHub noreply address`);
  if (!allowedAddress(c.committerEmail)) {
    add('committer', `committer e-mail <${c.committerEmail}> is not a GitHub noreply address`);
  }

  const allowedKeys = new Set(TRAILER_KEYS.map((k) => k.toLowerCase()));
  for (const t of trailers) {
    if (!allowedKeys.has(t.key.toLowerCase())) {
      add('trailer', `trailer "${t.key}" is not allowed (only ${TRAILER_KEYS.join(' and ')})`);
    }
  }

  // Dependabot's own sign-off is the one place GitHub's support address may appear.
  const signedByDependabot = trailers.some(
    (t) => t.key.toLowerCase() === 'signed-off-by' && t.value === DEPENDABOT_SIGN_OFF,
  );
  const isDependabotSignOff = (/** @type {string} */ line) =>
    /^signed-off-by:\s*(.*)$/i.exec(line.trim())?.[1] === DEPENDABOT_SIGN_OFF;
  const text = signedByDependabot ? c.message.split('\n').filter((l) => !isDependabotSignOff(l)).join('\n') : c.message;
  const addresses = new Set([
    ...[...text.matchAll(/<([^<>\s]+@[^<>\s]+)>/g)].map((m) => m[1] ?? ''),
    ...[...findEmails(text)].map((m) => m.value),
  ]);
  for (const address of addresses) {
    if (!allowedAddress(address)) add('message', `the message contains <${address}>, which is not a GitHub noreply address`);
  }
  return violations;
}

/**
 * @param {Commit[]} commits
 * @param {GitOptions} [opts]
 * @returns {Violation[]}
 */
export function checkCommits(commits, opts = {}) {
  return commits.flatMap((c) => checkCommit(c, parseTrailers(c.message, opts)));
}

/** @param {string[]} argv */
function main(argv) {
  const [base, head, ...rest] = argv;
  if (!base || !head || rest.length > 0) {
    console.error('usage: node scripts/check-commits.mjs <base> <head>   (npm run check:commits -- <base> <head>)');
    return 2;
  }
  /** @type {Violation[]} */
  let violations;
  /** @type {Commit[]} */
  let commits;
  try {
    commits = listCommits(base, head);
    violations = checkCommits(commits);
  } catch (err) {
    console.error(`check:commits: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const what = /^0+$/.test(base) ? `all commits of ${head}` : `${base}..${head}`;
  if (violations.length === 0) {
    console.log(
      `check:commits: ${commits.length} commit(s) in ${what}: every address is a GitHub noreply address, trailers only ${TRAILER_KEYS.join(' and ')}`,
    );
    return 0;
  }
  console.error(`check:commits: ${violations.length} violation(s) in ${commits.length} commit(s) of ${what}:`);
  for (const v of violations) console.error(`  [${v.rule}] ${v.message}`);
  console.error('The rules and how to fix a commit: docs/contributing.md, section "Commits".');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
