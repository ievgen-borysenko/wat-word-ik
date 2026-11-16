#!/usr/bin/env node
// Audit of package-lock.json:
//   - every package is downloaded from the public npm registry over HTTPS
//     (no git URLs, tarball URLs on other hosts, local files or links);
//   - every package has an `integrity` hash (sha512), so `npm ci` refuses a
//     tarball that differs from the one that was reviewed;
//   - every runtime package, which can end up in the shipped page, has a licence
//     from a short allow-list of permissive licences. Runtime means every entry
//     without `dev`: an entry with `devOptional` (a dev dependency that is also
//     an optional dependency of a runtime package) counts as runtime too.
// The same set of runtime packages (runtimePackages below) decides which
// licence notices the built site carries: the build (vite.config.ts) writes
// one notice for all of them at the top of each built script that bundles
// package code (with four pages, the shared chunk that holds that code, not
// the page scripts), and scripts/check-dist.mjs requires one for each package
// in the shipped scripts taken together.
//
// Usage: node scripts/check-lockfile.mjs [package-lock.json]
// Exit codes: 0 clean, 1 violations found (all listed), 2 the file could not be read.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REGISTRY = 'https://registry.npmjs.org/';
export const RUNTIME_LICENSES = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD']);

/**
 * @typedef {{ version?: string, resolved?: string, integrity?: string, license?: string,
 *   dev?: boolean, devOptional?: boolean, link?: boolean, inBundle?: boolean }} LockEntry
 * @typedef {{ lockfileVersion?: number, packages?: Record<string, LockEntry> }} Lockfile
 * @typedef {{ pkg: string, rule: string, message: string }} Violation
 */

/**
 * True when the SPDX expression is satisfied by the allow-list:
 * every operand of AND must be allowed, one operand of OR is enough.
 * WITH (licence exceptions) and anything unparsable count as not allowed.
 * @param {string} expression
 * @param {Set<string>} allowed
 */
export function licenseAllowed(expression, allowed) {
  const tokens = expression.replace(/([()])/g, ' $1 ').trim().split(/\s+/);
  let pos = 0;
  /** @returns {boolean} */
  const primary = () => {
    const tok = tokens[pos++];
    if (tok === '(') {
      const value = orExpr();
      if (tokens[pos++] !== ')') throw new Error('unbalanced parentheses');
      return value;
    }
    if (tok === undefined || tok === ')' || /^(AND|OR|WITH)$/i.test(tok)) throw new Error('unexpected token');
    if (tokens[pos]?.toUpperCase() === 'WITH') {
      pos += 2;
      return false;
    }
    return allowed.has(tok);
  };
  /** @returns {boolean} */
  const andExpr = () => {
    let value = primary();
    while (tokens[pos]?.toUpperCase() === 'AND') {
      pos++;
      value = primary() && value;
    }
    return value;
  };
  /** @returns {boolean} */
  const orExpr = () => {
    let value = andExpr();
    while (tokens[pos]?.toUpperCase() === 'OR') {
      pos++;
      value = andExpr() || value;
    }
    return value;
  };
  try {
    const value = orExpr();
    return pos === tokens.length && value;
  } catch {
    return false;
  }
}

/**
 * Package name of a lockfile key (`node_modules/a/node_modules/@s/b` is `@s/b`).
 * @param {string} key
 */
const packageName = (key) => key.replace(/^(?:.*\/)?node_modules\//, '') || key;

/**
 * A runtime package can end up in the shipped page: every entry without `dev`.
 * An entry with `devOptional` (a dev dependency that is also an optional
 * dependency of a runtime package) counts as runtime too.
 * @param {LockEntry} entry
 */
const isRuntime = (entry) => !entry.dev;

/**
 * The runtime packages of the lockfile, as the licence check above sees them:
 * the build writes a licence notice for each of them at the top of each built
 * script that bundles package code (the shared chunk that holds that code, not
 * the page scripts), and check:dist requires one for each in the shipped scripts
 * taken together. `path` is the lockfile key, the folder the package is
 * installed in.
 * @param {Lockfile} lock
 * @returns {{ path: string, name: string, version: string, license: string }[]}
 */
export function runtimePackages(lock) {
  if (typeof lock !== 'object' || lock === null || (lock.lockfileVersion ?? 0) < 2 || typeof lock.packages !== 'object') {
    throw new Error('expected lockfileVersion 2 or 3 with a "packages" map');
  }
  return Object.entries(lock.packages ?? {})
    .filter(([key, entry]) => key !== '' && isRuntime(entry))
    .map(([key, entry]) => ({ path: key, name: packageName(key), version: entry.version ?? '', license: entry.license ?? '' }));
}

/**
 * @param {Lockfile} lock
 * @returns {{ violations: Violation[], checked: number, runtime: { pkg: string, license: string }[] }}
 */
export function auditLockfile(lock) {
  /** @type {Violation[]} */
  const violations = [];
  /** @type {{ pkg: string, license: string }[]} */
  const runtime = [];
  if (typeof lock !== 'object' || lock === null || (lock.lockfileVersion ?? 0) < 2 || typeof lock.packages !== 'object') {
    violations.push({ pkg: '(lockfile)', rule: 'format', message: 'expected lockfileVersion 2 or 3 with a "packages" map' });
    return { violations, checked: 0, runtime };
  }
  let checked = 0;
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === '') continue; // the project itself
    checked++;
    const pkg = packageName(key);
    /** @param {string} rule @param {string} message */
    const add = (rule, message) => violations.push({ pkg: key, rule, message });

    if (entry.link) {
      add('source', `is a link to ${entry.resolved ?? 'a local folder'}, not a registry package`);
      continue;
    }
    // A bundled dependency ships inside its parent's tarball, which the parent's
    // integrity hash already covers; it has no download of its own.
    if (!entry.inBundle) {
      if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith(REGISTRY)) {
        add('source', `resolved from ${entry.resolved ?? '(nowhere)'}, expected ${REGISTRY}`);
      }
      if (typeof entry.integrity !== 'string' || entry.integrity === '') add('integrity', 'has no integrity hash');
      else if (!entry.integrity.split(/\s+/).some((h) => h.startsWith('sha512-'))) {
        add('integrity', `has no sha512 integrity hash (${entry.integrity.slice(0, 12)}...)`);
      }
    }
    if (isRuntime(entry)) {
      const license = entry.license;
      if (typeof license !== 'string' || license === '') add('license', `runtime package ${pkg} declares no licence`);
      else if (!licenseAllowed(license, RUNTIME_LICENSES)) {
        add('license', `runtime package ${pkg} is licensed ${license}, allowed: ${[...RUNTIME_LICENSES].join(', ')}`);
      } else runtime.push({ pkg: `${pkg}@${entry.version ?? '?'}`, license });
    }
  }
  return { violations, checked, runtime };
}

/** @param {string[]} argv */
function main(argv) {
  const file = argv[0] ?? 'package-lock.json';
  /** @type {Lockfile} */
  let lock;
  try {
    lock = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`check:lock: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const { violations, checked, runtime } = auditLockfile(lock);
  const runtimeList = runtime.map((r) => `${r.pkg} (${r.license})`).join(', ') || 'none';
  if (violations.length === 0) {
    console.log(`check:lock: ${checked} packages from ${REGISTRY}, all with sha512 integrity`);
    console.log(`check:lock: runtime packages and licences: ${runtimeList}`);
    return 0;
  }
  console.error(`check:lock: ${violations.length} violation(s) in ${file}:`);
  for (const v of violations) console.error(`  ${v.pkg}: [${v.rule}] ${v.message}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
