#!/usr/bin/env node
// Checks the e-mail addresses in a range of commits before it becomes public.
//
// Every commit in <base>..<head> must have an author AND a committer e-mail on
// the allow-list below, and every e-mail in a trailer line of the message
// (Co-Authored-By:, Signed-off-by:, ...) must be on it too. A personal address
// that slips into one commit stays in the public history for good.
//
// The raw addresses of the commit objects are read (%ae/%ce), not the ones
// rewritten by a .mailmap, which only changes how they are displayed.
//
// Usage: node scripts/check-commits.mjs <base> <head>
//   <base> of all zeros (a new branch) means: every commit reachable from <head>.
// Exit codes: 0 clean, 1 violations found (all listed), 2 usage or git error.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findEmails } from './check-dist.mjs';

export const ALLOWED_EMAILS = new Set([
  '10108630+ievgen-borysenko@users.noreply.github.com',
  '310343018+xevbor@users.noreply.github.com',
  'noreply@github.com',
  '49699333+dependabot[bot]@users.noreply.github.com',
]);

/** Also allowed in trailers: Dependabot signs its commits off with this address. */
export const ALLOWED_TRAILER_EMAILS = new Set([...ALLOWED_EMAILS, 'support@github.com']);

/** A trailer line, e.g. "Co-Authored-By: Name <address>". */
const TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*:\s/;

/**
 * @typedef {{ sha: string, authorEmail: string, committerEmail: string, subject: string, body: string }} Commit
 * @typedef {{ sha: string, rule: string, message: string }} Violation
 * @typedef {{ cwd?: string, env?: NodeJS.ProcessEnv }} GitOptions
 */

/**
 * @param {string[]} args
 * @param {GitOptions} opts
 */
function git(args, opts) {
  return execFileSync('git', args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
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
  const out = git(['log', '--reverse', '--no-mailmap', '--format=%H%x1f%ae%x1f%ce%x1f%s%x1f%B%x1e', ...range, '--'], opts);
  return out
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec !== '')
    .map((rec) => {
      const [sha = '', authorEmail = '', committerEmail = '', subject = '', body = ''] = rec.split('\x1f');
      return { sha, authorEmail, committerEmail, subject, body };
    });
}

/**
 * @param {Commit[]} commits
 * @returns {Violation[]}
 */
export function checkCommits(commits) {
  /** @type {Violation[]} */
  const violations = [];
  for (const c of commits) {
    const short = c.sha.slice(0, 12);
    /** @param {string} rule @param {string} message */
    const add = (rule, message) => violations.push({ sha: c.sha, rule, message: `${short} "${c.subject}": ${message}` });
    if (!ALLOWED_EMAILS.has(c.authorEmail.toLowerCase())) {
      add('author', `author e-mail <${c.authorEmail}> is not on the allow-list`);
    }
    if (!ALLOWED_EMAILS.has(c.committerEmail.toLowerCase())) {
      add('committer', `committer e-mail <${c.committerEmail}> is not on the allow-list`);
    }
    for (const line of c.body.split('\n')) {
      if (!TRAILER_LINE.test(line)) continue;
      const bracketed = [...line.matchAll(/<([^<>\s]+@[^<>\s]+)>/g)].map((m) => m[1] ?? '');
      const bare = [...findEmails(line)].map((m) => m.value);
      for (const address of new Set([...bracketed, ...bare])) {
        if (!ALLOWED_TRAILER_EMAILS.has(address.toLowerCase())) {
          add('trailer', `trailer "${line.trim().slice(0, 100)}" names an address that is not on the allow-list`);
        }
      }
    }
  }
  return violations;
}

/** @param {string[]} argv */
function main(argv) {
  const [base, head, ...rest] = argv;
  if (!base || !head || rest.length > 0) {
    console.error('usage: node scripts/check-commits.mjs <base> <head>   (npm run check:commits -- <base> <head>)');
    return 2;
  }
  /** @type {Commit[]} */
  let commits;
  try {
    commits = listCommits(base, head);
  } catch (err) {
    console.error(`check:commits: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const violations = checkCommits(commits);
  const what = /^0+$/.test(base) ? `all commits of ${head}` : `${base}..${head}`;
  if (violations.length === 0) {
    console.log(`check:commits: ${commits.length} commit(s) in ${what}, every author and committer e-mail is on the allow-list`);
    return 0;
  }
  console.error(`check:commits: ${violations.length} violation(s) in ${commits.length} commit(s) of ${what}:`);
  for (const v of violations) console.error(`  [${v.rule}] ${v.message}`);
  console.error(`allowed: ${[...ALLOWED_EMAILS].join(', ')}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
