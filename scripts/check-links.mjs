#!/usr/bin/env node
// Checks that relative links in the Markdown files (*.md at the top level and
// docs/*.md) point to files or folders that exist in the repository.
//
// Covered: inline links and images [text](target), reference definitions
// [id]: target, and href/src attributes of HTML written in Markdown.
// Skipped: links with a scheme (https:, mailto:, ...), links to an anchor in the
// same file (#section), and everything inside code blocks or code spans.
// A #fragment or ?query on a relative link is removed before the file check.
//
// Usage: node scripts/check-links.mjs [root]   (default: the current directory)
// Exit codes: 0 clean, 1 broken links found (all listed), 2 the check could not run.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ file: string, line: number, target: string, message: string }} Violation
 */

/**
 * Markdown files to check, relative to `root`, `/`-separated.
 * @param {string} root
 */
export function markdownFiles(root) {
  /** @type {string[]} */
  const files = [];
  for (const name of readdirSync(root).sort()) {
    if (name.endsWith('.md') && statSync(join(root, name)).isFile()) files.push(name);
  }
  const docs = join(root, 'docs');
  if (existsSync(docs)) {
    for (const name of readdirSync(docs).sort()) {
      if (name.endsWith('.md') && statSync(join(docs, name)).isFile()) files.push(`docs/${name}`);
    }
  }
  return files;
}

/**
 * Blanks out fenced code blocks and code spans, keeping line breaks so line
 * numbers stay right.
 * @param {string} text
 */
function stripCode(text) {
  const blank = (/** @type {string} */ s) => ' '.repeat(s.length);
  /** @type {string | null} */
  let fence = null;
  return text
    .split('\n')
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === null) {
        if (marker) {
          fence = marker;
          return blank(line);
        }
        return line.replace(/(`+)[^`].*?\1/g, blank);
      }
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      return blank(line);
    })
    .join('\n');
}

/**
 * Link targets in a Markdown text with their line numbers.
 * @param {string} text
 * @returns {{ target: string, line: number }[]}
 */
export function linkTargets(text) {
  const clean = stripCode(text);
  /** @type {{ target: string, line: number }[]} */
  const out = [];
  const lineOf = (/** @type {number} */ index) => clean.slice(0, index).split('\n').length;
  const patterns = [
    /\]\(\s*<([^>\n]*)>/g, // [text](<target with spaces>)
    /\]\(\s*([^\s)<>]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g, // [text](target "title")
    /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)>?/gm, // [id]: target
    /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi, // <a href="target">
  ];
  for (const re of patterns) {
    for (const m of clean.matchAll(re)) out.push({ target: m[1] ?? '', line: lineOf(m.index) });
  }
  return out.sort((a, b) => a.line - b.line);
}

/**
 * @param {string} rootDir
 * @returns {{ violations: Violation[], checked: number, files: string[] }}
 */
export function checkLinks(rootDir) {
  const root = resolve(rootDir);
  const files = markdownFiles(root);
  /** @type {Violation[]} */
  const violations = [];
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const { target, line } of linkTargets(text)) {
      if (target === '' || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
      checked++;
      const pathPart = target.replace(/[?#].*$/, '');
      let decoded;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        violations.push({ file, line, target, message: 'is not a valid URL path' });
        continue;
      }
      const abs = decoded.startsWith('/') ? join(root, decoded) : resolve(root, dirname(file), decoded);
      const rel = relative(root, abs);
      if (rel === '..' || rel.startsWith(`..${sep}`)) {
        violations.push({ file, line, target, message: 'points outside the repository' });
      } else if (!existsSync(abs)) {
        violations.push({ file, line, target, message: `does not resolve (${rel.split(sep).join('/')} not found)` });
      }
    }
  }
  return { violations, checked, files };
}

/** @param {string[]} argv */
function main(argv) {
  const root = argv[0] ?? '.';
  let result;
  try {
    result = checkLinks(root);
  } catch (err) {
    console.error(`check:links: the check could not run: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const { violations, checked, files } = result;
  if (violations.length === 0) {
    console.log(`check:links: ${checked} relative link(s) in ${files.length} file(s) resolve (${files.join(', ')})`);
    return 0;
  }
  console.error(`check:links: ${violations.length} broken link(s):`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}: ${v.target} ${v.message}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
