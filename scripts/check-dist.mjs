#!/usr/bin/env node
// Audit of the BUILT site (dist/) before it is published.
//
// The page promises: no accounts, no ads, no analytics, no cookies or storage,
// no network requests at run time. This script checks that the files we are
// about to ship keep that promise and carry nothing else:
//
//   1. paths    every shipped file is on an allow-list (the pages index.html and
//               deuren.html and the JS and CSS bundles; no source maps, hidden
//               files, JSON dumps, docs, tests, images) and is a regular file,
//               and both pages are there;
//   2. refs     every file except index.html is referenced by another shipped
//               file, and every local reference in a page exists;
//   3. size     JS, CSS and the whole tree stay within a budget;
//   4. content  no absolute local paths, local or private hosts, private keys,
//               source map comments, e-mail addresses (none at all), URLs outside
//               an allow-list or protocol-relative URLs;
//   5. runtime  the JS names no browser API that talks to the network, stores
//               data or starts a worker, and no way to send data to the page's
//               own host without one (an image request, a navigation, a URL
//               written into an element, a link other than the one to the other
//               view, a string that starts a query string);
//   6. html     each page carries a Content-Security-Policy meta that lets the
//               page load its own script and stylesheet and nothing else
//               (default-src 'none'); it loads nothing from another host, has
//               no inline scripts or event handlers and no local URL with a
//               query string;
//   7. notice   the JS carries the licence notice of every runtime package of
//               the lockfile (see NOTICE_HEAD below).
//
// Usage: node scripts/check-dist.mjs [dir] [lockfile]
//        (defaults: dist, package-lock.json)
// Exit codes: 0 clean, 1 violations found (all of them are listed), 2 the audit
// itself could not run (missing directory, unreadable file or lockfile).

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtimePackages } from './check-lockfile.mjs';

/** Future public repository; links to it may appear in shipped files. */
export const REPO_URL = 'https://github.com/ievgen-borysenko/wat-word-ik';

/** Paths (relative to dist, `/`-separated) that may be shipped. Nothing else. */
export const SHIPPED_PATHS = [
  /^index\.html$/,
  /^deuren\.html$/,
  /^assets\/[A-Za-z0-9_-]+\.js$/,
  /^assets\/[A-Za-z0-9_-]+\.css$/,
];

/**
 * The HTML pages: index.html (the floors view) and deuren.html (the doors view).
 * Both are required: a tree without one of them is refused ('missing'). Each gets
 * the checks of checkPage.
 */
export const PAGES = ['index.html', 'deuren.html'];

/** Size budget in bytes (1 kB = 1000 bytes, as in Vite's build report). */
export const BUDGET = { js: 150_000, css: 40_000, total: 400_000 };

/** URLs allowed in shipped text: XML namespaces (not fetched) and the repository. */
export const ALLOWED_URLS = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/XML/1998/namespace',
];

/**
 * Content-Security-Policy: the sources each directive may list. default-src must
 * be exactly 'none', so every fetch directive that is not listed (connect, font,
 * media, frame, object, worker, manifest, ...) falls back to it. Only the page's
 * own script and stylesheet may come from 'self'; images only from data: (the
 * inline icon). Any directive not in this table may only be 'none'.
 */
export const CSP_ALLOWED = new Map([
  ['default-src', ["'none'"]],
  ['script-src', ["'self'", "'none'"]],
  ['style-src', ["'self'", "'none'"]],
  ['img-src', ['data:', "'none'"]],
  ['base-uri', ["'none'"]],
  ['form-action', ["'none'"]],
]);
/** Directives that default-src does not cover, so the policy must set them. */
const CSP_REQUIRED = ['default-src', 'base-uri', 'form-action'];

/**
 * Absolute paths from a developer's machine: macOS and Linux home folders (root's
 * included), macOS temporary and volume folders, Linux and WSL mount points; on
 * Windows, paths from a drive root (a drive letter, a colon, a slash or one or two
 * backslashes, then a path character) and UNC paths (two or four backslashes, a
 * host name, a backslash).
 *
 * Two rules for drive paths, one per separator:
 *   - backslash form (a drive letter, a colon, one or two backslashes, a path
 *     character): the drive letter must not follow a letter or digit;
 *   - forward-slash form (a drive letter, a colon, a slash, a path character):
 *     the drive letter must start a token, that is, stand at the start of the
 *     text or a line, or after whitespace, a quote, a backtick or `(`, with at
 *     most one slash in between (the pathname of a file URL); or anywhere right
 *     after `file://` or `file:///`. Minified JavaScript mostly puts a
 *     one-letter object key, ternary branch or label before `:/regex/` right
 *     after punctuation (`{a:/b/}`, `,b:/x/g`, `c?a:/re/`, `x.a:`, `x=a:`,
 *     `;e:`, `}a:`), which this rule lets through; a ternary branch after a
 *     keyword and a space it does not, so that one is still reported (see the
 *     gaps). A key or label is never followed by a colon and a backslash, so
 *     the backslash form needs no such rule.
 * Accepted gaps:
 *   - not found, forward-slash form: a drive path right after any other
 *     character, such as `=D:/x`, `[D:/x]`, `<D:/x>`, an element's text right
 *     after `>` (`<code>D:/x</code>`), a dev-server path (`/@fs/D:/x`), a later
 *     entry of a PATH-like list, Markdown emphasis around it, or curly quotes;
 *   - still reported, forward-slash form: a one-letter key, label or case value
 *     after whitespace and directly followed by a regular expression (`case a:`
 *     or `{ a:` with no space before the `/`; write `a: /x/`); a ternary branch
 *     after a keyword (`c?await a:`, `c?typeof a:` or `c?new a:` directly
 *     followed by a regular expression); a regular expression or string at a
 *     token start whose text begins with a slash, a one-letter word, a colon
 *     and a slash (`f(/a:` or `"/a:` followed by a slash);
 *   - still reported, backslash form: a one-letter word followed by a colon and
 *     an escape, such as an escaped new line in a string or a backslash class
 *     in a regular expression, whatever precedes it short of a letter or digit.
 * Not on the list at all, because they also appear in ordinary text or code and
 * say nothing about a person: `~/`, `/opt/`; a colon that is not followed by a
 * separator and a path character (`a:hover`, `12:30`, Markdown table rules,
 * `https:`); a drive-relative path without a separator; UNC paths written with
 * forward slashes, which in the built site are refused as protocol-relative URLs
 * and in the repository cannot be told from `//` comments.
 */
export const LOCAL_PATH_RE =
  /\/Users\/|\/home\/|\/root\/|\/private\/var\/|\/var\/folders\/|\/Volumes\/|\/mnt\/|(?<![A-Za-z0-9])[A-Za-z]:\\{1,2}(?=[A-Za-z0-9_$~.-])|(?<=(?:^|[\s"'`(])\/?|file:\/\/\/?)[A-Za-z]:\/(?=[A-Za-z0-9_$~.-])|(?<![\\\w])\\{2}(?:\\{2})?[A-Za-z0-9_$.-]+\\{1,2}[A-Za-z0-9_$.-]/g;

/** Header of a PEM or OpenPGP private key. */
export const PRIVATE_KEY_RE = /-----BEGIN[A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g;

/** Loopback and unspecified addresses: the same on every machine, but the page talks to no host. */
export const LOCAL_HOST_RE = /\blocalhost\b|\b127\.0\.0\.1\b|\b0\.0\.0\.0\b|\[::1\]/gi;

/** Private network addresses (RFC 1918): they reveal a home or office network. */
export const PRIVATE_ADDRESS_RE = /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g;

/** Forbidden in every shipped text file. */
const FORBIDDEN_CONTENT = [
  { rule: 'local-path', what: 'absolute local path', re: LOCAL_PATH_RE },
  { rule: 'local-host', what: 'local host address', re: LOCAL_HOST_RE },
  { rule: 'private-host', what: 'private network address (RFC 1918)', re: PRIVATE_ADDRESS_RE },
  { rule: 'private-key', what: 'private key header', re: PRIVATE_KEY_RE },
  { rule: 'source-map', what: 'source map reference', re: /sourceMappingURL|[#@]\s*sourceURL=/g },
];

/*
 * E-mail addresses, URLs and host names are found by locating a fixed marker
 * ('@', '://', '//', '.local') first and growing the match outwards. A plain
 * global regex such as /[\w.]+@.../g takes quadratic time on a long run of
 * letters (a minified bundle, a data: URI).
 */
const EMAIL_LOCAL = /[A-Za-z0-9._%+-]/;
const EMAIL_DOMAIN = /[A-Za-z0-9.-]/;
const EMAIL_SHAPE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const SCHEME_CHAR = /[A-Za-z0-9+.-]/;
const URL_CHAR = /[^\s"'`<>()\\{}|^[\]]/;
const HOST_CHAR = /[A-Za-z0-9.-]/;

/**
 * @param {string} text
 * @param {string} needle
 * @returns {Generator<number>}
 */
function* indexesOf(text, needle) {
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) yield i;
}

/**
 * @param {string} text
 * @returns {Generator<{ index: number, value: string }>}
 */
export function* findEmails(text) {
  for (const at of indexesOf(text, '@')) {
    let start = at;
    while (start > 0 && EMAIL_LOCAL.test(text.charAt(start - 1))) start--;
    let end = at + 1;
    while (end < text.length && EMAIL_DOMAIN.test(text.charAt(end))) end++;
    const domain = EMAIL_SHAPE.exec(text.slice(at + 1, end));
    if (start < at && domain) yield { index: start, value: `${text.slice(start, at)}@${domain[0]}` };
  }
}

/**
 * Absolute URLs with any scheme followed by '://'.
 * @param {string} text
 * @returns {Generator<{ index: number, value: string }>}
 */
export function* findUrls(text) {
  for (const sep of indexesOf(text, '://')) {
    let start = sep;
    while (start > 0 && SCHEME_CHAR.test(text.charAt(start - 1))) start--;
    while (start < sep && !/[A-Za-z]/.test(text.charAt(start))) start++;
    if (start === sep) continue;
    let end = sep + 3;
    while (end < text.length && URL_CHAR.test(text.charAt(end))) end++;
    yield { index: start, value: text.slice(start, end).replace(/[.,;:!?]+$/, '') };
  }
}

/**
 * Protocol-relative URLs (`//host/path`): a '//' at the start of a string, an
 * attribute value or a CSS url(), directly followed by a dotted host name.
 * A '//' after a scheme (https://) or inside a word is not one.
 * @param {string} text
 * @returns {Generator<{ index: number, value: string }>}
 */
export function* findProtocolRelative(text) {
  for (const i of indexesOf(text, '//')) {
    const before = i === 0 ? '' : text.charAt(i - 1);
    if (before !== '' && !/["'`(=,\s]/.test(before)) continue;
    const host = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/.exec(text.slice(i + 2, i + 2 + 256));
    if (!host) continue;
    const after = text.charAt(i + 2 + host[0].length);
    if (after !== '' && !/[/:?#"'`)\s]/.test(after)) continue;
    let end = i + 2 + host[0].length;
    while (end < text.length && URL_CHAR.test(text.charAt(end))) end++;
    yield { index: i, value: text.slice(i, end) };
  }
}

/**
 * Host names in a private namespace: `*.local` (mDNS), `*.lan`, `*.internal`.
 * Used for HTML and CSS only: in minified JS, `x.local` is usually a property.
 * @param {string} text
 * @returns {Generator<{ index: number, value: string }>}
 */
export function* findPrivateHostNames(text) {
  // Not followed by a hyphen or by another label (x.local.example.com); a full stop ends a sentence.
  for (const m of text.matchAll(/\.(?:local|lan|internal)\b(?!-|\.[A-Za-z0-9])/gi)) {
    let start = m.index;
    while (start > 0 && HOST_CHAR.test(text.charAt(start - 1))) start--;
    while (start < m.index && !/[A-Za-z0-9]/.test(text.charAt(start))) start++;
    if (start < m.index) yield { index: start, value: text.slice(start, m.index + m[0].length) };
  }
}

/*
 * Browser APIs that send data, store it or run code elsewhere. Minifiers rename
 * local variables but never global or property names, so a whole-word match finds:
 *   - direct calls and member access: fetch(u), window.fetch, navigator.sendBeacon,
 *     document.cookie, navigator.serviceWorker.register, new Worker(u);
 *   - aliasing: const f = fetch;
 *   - bracket access with a literal: window["fetch"], self[`localStorage`].
 * It does NOT find a name assembled at run time ("fe" + "tch", atob(...), char
 * codes) used with bracket access, or an API reached by iterating over window.
 * eval and the Function constructor are forbidden too, so code cannot be built
 * from strings; the remaining gaps are covered by the CSP meta (default-src 'none') and
 * by the end-to-end tests, which record every request the page makes and, after
 * using every control, find no cookies, local or session storage, IndexedDB
 * databases, service workers, Cache Storage or origin private file system entries.
 * A UI string containing one of these words ("cookie", "fetch", "caches") is
 * reported as well: reword the string.
 */
/** @type {[name: string, pattern: RegExp][]} */
export const RUNTIME_APIS = [
  ['fetch', /\bfetch\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['WebTransport', /\bWebTransport\b/],
  ['RTCPeerConnection', /\bRTCPeerConnection\b/],
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['document.cookie', /\bcookie\b/],
  ['cookieStore', /\bcookieStore\b/],
  ['caches (Cache Storage)', /\bcaches\b/],
  ['navigator.storage (file system)', /\bnavigator\s*\.\s*storage\b|\bgetDirectory\b/],
  ['serviceWorker', /\bserviceWorker\b/],
  ['Worker', /\bWorker\b/],
  ['SharedWorker', /\bSharedWorker\b/],
  ['importScripts', /\bimportScripts\b/],
  ['eval', /\beval\b/],
  ['Function constructor', /\bnew\s+Function\b|(?<![.\w$])Function\s*\(/],
];

/*
 * Ways to send data to the page's own host without the APIs above. A request
 * to the own host is not blocked by connect-src, and the host's logs keep its
 * query string. This scan finds:
 *   - the Image and Audio constructors (new Image(), Image(), aliasing);
 *   - writes to location (location = u, location.href, .search, .pathname and
 *     the other parts but the hash; location.assign(u), location.replace(u));
 *   - open(u), window.open(u);
 *   - URL properties written directly (.src, .srcset, .href, .action,
 *     .formAction, .poster, .ping, .search), also with a literal in brackets;
 *   - URL attributes as keys of element props (src:, srcset:, poster:, ping:,
 *     formAction:), the form that JSX compiles to;
 *   - links as keys of element props (href:, quoted or not, the shorthand {href},
 *     a computed literal key, a method or getter) and setAttribute("href", ...),
 *     with one exception:
 *     the link to the other view, in the exact shape the build writes it
 *     (VIEW_LINK_HREF_RE below), at most VIEW_LINK_HREFS_MAX times in all the
 *     scripts together. That shape is a template literal with a literal page
 *     (deuren.html or ./), a literal `#` and one name; everything after a `#`
 *     is the fragment, which the browser never sends to a host, so that link
 *     carries nothing off the page, whatever the name holds (see hrefProps);
 *   - a string literal that starts a query string ("?key=", "/path?key=",
 *     "./x?key=", also as a template literal) where an expression begins.
 * It does NOT find a property or attribute name assembled at run time
 * (el[k] = v, setAttribute(k, v), a computed key in element props), a URL
 * built from character codes, aliasing of open or location,
 * history.pushState/replaceState with a query (the page writes its own hash
 * with replaceState; a query written there reaches the host on the next
 * reload), or a link written as markup text (innerHTML and the like). The CSP
 * (default-src 'none') makes the browser block image, media, frame and object
 * loads in any case; a navigation is not a load that CSP can block, so for
 * those the end-to-end guard, which refuses every request with a query
 * string, is the remaining layer, for the paths the tests take. A UI string
 * containing "Image", "Audio" or "open(" is reported as well: reword the
 * string.
 */
/** @type {[name: string, pattern: RegExp][]} */
export const REQUEST_SINKS = [
  ['Image or Audio constructor', /\b(?:Image|Audio)\b/],
  [
    'write to location',
    /\blocation\s*(?:\.\s*(?:href|search|pathname|host|hostname|port|protocol|origin)\s*)?=(?!=)|\blocation\s*\.\s*(?:assign|replace)\s*\(/,
  ],
  ['window.open', /\b(?:window|self|globalThis|top|parent)\s*\.\s*open\s*\(|(?<![\w$.])open\s*\(/],
  [
    'URL property write',
    /\.\s*(?:src|srcset|href|action|formAction|poster|ping|search)\s*=(?!=)|\[\s*(["'`])(?:src|srcset|href|action|formAction|poster|ping|search)\1\s*\]\s*=(?!=)/,
  ],
  ['URL attribute in element props', /(?<![\w$.-])(["'`]?)(?:src|srcset|poster|ping|formAction|formaction)\1\s*:/],
  ['query string literal', /(?<=(?:^|[=(,:+[{;!&|?>]|\breturn)\s*)(["'`])(?:\.{0,2}\/[^"'`\s?]*)?\?[A-Za-z_][\w.-]*=/],
];

/**
 * `href` as a key of element props, in every form an object literal can define it:
 * `href:` quoted or not (matched as the URL attributes above are), the shorthand
 * `{href}`, a computed literal key `["href"]:`, and a method or getter `href(){}`;
 * also `setAttribute("href", ...)`.
 */
export const HREF_PROP_RE =
  /(?<![\w$.-])(["'`]?)href\1\s*:|(?<=[{,]\s*)href(?=\s*[,}])|\[\s*(["'`])href\2\s*\]\s*:|(?<![\w$.])href\s*\(|\bsetAttribute\s*\(\s*(["'`])href\3/g;

/**
 * The only `href` prop allowed, tried where HREF_PROP_RE found the key: the link
 * to the other view as the build writes it (src/ui/OtherViewLink.tsx), for example
 * href:`deuren.html#${t}`. The key unquoted, no space, a template literal that
 * holds exactly a literal page (deuren.html or ./), a literal `#` and one
 * identifier or member expression, and then the end of the value (`,` or `}`):
 * no query string, no other text, no second expression, no concatenation. The
 * minifier may rename the identifier. When a build writes the link in any other
 * shape (a changed source or minifier), this audit refuses it and the real-build
 * test in check-dist.test.mjs fails, so the new shape is reviewed before it ships.
 */
export const VIEW_LINK_HREF_RE = /href:`(?:deuren\.html|\.\/)#\$\{[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\}`(?=[,}])/y;

/** The links to the other view the scripts may hold in all: the real build has two, one on each page. */
export const VIEW_LINK_HREFS_MAX = 2;

/**
 * The `href` props of one script, by position: the links to the other view
 * (VIEW_LINK_HREF_RE) and every other one, which is refused.
 * @param {string} text
 * @returns {{ viewLinks: number[], others: number[] }}
 */
export function hrefProps(text) {
  /** @type {number[]} */
  const viewLinks = [];
  /** @type {number[]} */
  const others = [];
  for (const m of text.matchAll(HREF_PROP_RE)) {
    VIEW_LINK_HREF_RE.lastIndex = m.index;
    (VIEW_LINK_HREF_RE.test(text) ? viewLinks : others).push(m.index);
  }
  return { viewLinks, others };
}

/** Attributes whose value is a URL that the browser may load or navigate to. */
const URL_ATTRS = new Set([
  'src',
  'href',
  'action',
  'formaction',
  'poster',
  'data',
  'background',
  'ping',
  'manifest',
  'xlink:href',
  'srcset',
]);

/*
 * Licence notices. The pages bundle the code of their runtime dependencies (the
 * lockfile entries without `dev`, runtimePackages in check-lockfile.mjs), and
 * their licences ask that the copyright and permission notice go with every
 * copy. The build (vite.config.ts) writes one legal comment at the top of each
 * script that bundles package code (the chunk both pages share) with
 * formatNotice below, from each installed package's own
 * licence file: every package with its version, licence and copyright lines,
 * then each distinct licence text once, with the packages it applies to.
 *
 * This audit installs no dependencies, so it cannot read those files. It
 * checks the notice against the reviewed lockfile instead: every runtime
 * package is named with its locked version and licence, followed by at least
 * one copyright line, and a licence text names it; for MIT, that text holds
 * the sentence that asks for the notice. A notice for a package that is not a
 * runtime package of the lockfile, at that version, is refused too. Whether
 * the copyright lines and texts are the packages' own is not checked here: the
 * build copies them from the installed files. The notice passes the content
 * checks above like the rest of the script, and counts towards its budget.
 */

/** First line of the notice. */
export const NOTICE_HEAD = '/*! Licences of the third-party code bundled in this file';
const NOTICE_SUBHEAD = '(generated at build time from the licence file of each package).';
/** Starts the line above each licence text: `Licence text of a, b:`. */
const TEXT_HEAD = 'Licence text of ';
/** A package line: `<name> <version>, licence <SPDX expression>`. */
const PACKAGE_LINE = /^(\S+) (\S+), licence (.+)$/;

/** The sentence of the MIT licence that asks for the notice in every copy. */
export const MIT_NOTICE_SENTENCE =
  'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.';

/**
 * A copyright line of a licence file: `Copyright (c) 2015 ...`, `Copyright 2015
 * ...`, `(c) 2015 ...`, `© 2015 ...`. Case-sensitive, so that a wrapped line of
 * the licence text (`COPYRIGHT HOLDERS BE LIABLE`, `copyright holder nor`) and
 * the template line of the Apache licence (`Copyright [yyyy]`) stay in the text.
 */
const COPYRIGHT_LINE = /^\s*(?:Copyright\s+(?:\([cC]\)|©|\d)|\([cC]\)\s*\d|©\s*\d)/;

/**
 * @typedef {{ name: string, version: string, license: string, copyright: string[], text: string }} NoticeEntry
 * @typedef {{ name: string, version: string, license: string }} RuntimePackage
 */

/** @param {string} text */
const squash = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * Splits a package's licence file into its copyright lines and its licence text.
 * @param {string} file the contents of the licence file
 * @returns {{ copyright: string[], text: string }}
 */
export function splitLicence(file) {
  const lines = file
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd());
  return {
    copyright: lines.filter((l) => COPYRIGHT_LINE.test(l)).map((l) => l.trim()),
    text: lines
      .filter((l) => !COPYRIGHT_LINE.test(l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}

/**
 * The legal comment for the top of each script that bundles package code; empty without entries.
 * Throws when an entry has no copyright line or no text, or when a text would
 * end the comment early.
 * @param {NoticeEntry[]} entries
 */
export function formatNotice(entries) {
  if (entries.length === 0) return '';
  const sorted = [...entries].sort((a, b) => (a.name === b.name ? 0 : a.name < b.name ? -1 : 1));
  /** @type {Map<string, { text: string, names: string[] }>} */
  const texts = new Map();
  const lines = [NOTICE_SUBHEAD, ''];
  for (const e of sorted) {
    if (e.copyright.length === 0) throw new Error(`the licence file of ${e.name} has no copyright line`);
    if (e.text === '') throw new Error(`the licence file of ${e.name} has no licence text`);
    lines.push(`${e.name} ${e.version}, licence ${e.license}`, ...e.copyright, '');
    const group = texts.get(squash(e.text)) ?? { text: e.text, names: [] };
    if (!group.names.includes(e.name)) group.names.push(e.name);
    texts.set(squash(e.text), group);
  }
  for (const { text, names } of texts.values()) lines.push(`${TEXT_HEAD}${names.join(', ')}:`, '', ...text.split('\n'), '');
  lines.pop();
  const comment = [NOTICE_HEAD, ...lines.map((l) => (l === '' ? ' *' : ` * ${l}`)), ' */'].join('\n');
  if (comment.indexOf('*/') !== comment.length - 2) throw new Error('a licence file contains "*/", which would end the comment early');
  return comment;
}

/**
 * @typedef {{ name: string, version: string, license: string, copyright: string[] }} NoticePackage
 */

/**
 * The package lines, copyright lines and licence texts of one notice: the text
 * after NOTICE_HEAD, up to the end of the comment.
 * @param {string} comment
 */
function readNotice(comment) {
  /** @type {Map<string, NoticePackage>} key: name and version */
  const packages = new Map();
  /** @type {Map<string, string[]>} package name -> the texts (whitespace squashed) that name it */
  const texts = new Map();
  /** @type {NoticePackage | null} */
  let current = null;
  /** @type {string[] | null} */
  let names = null;
  /** @type {string[]} */
  let body = [];
  const flush = () => {
    for (const name of names ?? []) texts.set(name, [...(texts.get(name) ?? []), squash(body.join('\n'))]);
  };
  for (const raw of comment.split('\n').slice(1)) {
    const line = raw.replace(/^\s*\*(?: |$)/, '').trimEnd();
    if (line.startsWith(TEXT_HEAD) && line.endsWith(':')) {
      flush();
      names = line.slice(TEXT_HEAD.length, -1).split(', ');
      body = [];
      current = null;
    } else if (names !== null) {
      body.push(line);
    } else if (line === '') {
      current = null;
    } else if (current !== null && COPYRIGHT_LINE.test(line)) {
      current.copyright.push(line);
    } else {
      const m = PACKAGE_LINE.exec(line);
      if (!m) continue;
      current = { name: m[1] ?? '', version: m[2] ?? '', license: m[3] ?? '', copyright: [] };
      packages.set(`${current.name} ${current.version}`, current);
    }
  }
  flush();
  return { packages, texts };
}

/**
 * Problems with the licence notices in the shipped scripts, measured against
 * the runtime packages of the lockfile.
 * @param {string[]} scripts the text of every shipped JS file
 * @param {RuntimePackage[]} runtime
 * @returns {string[]}
 */
export function noticeProblems(scripts, runtime) {
  /** @type {Map<string, NoticePackage>} */
  const packages = new Map();
  /** @type {Map<string, string[]>} */
  const texts = new Map();
  let found = 0;
  for (const script of scripts) {
    for (const at of indexesOf(script, NOTICE_HEAD)) {
      found++;
      const end = script.indexOf('*/', at + 2);
      const notice = readNotice(script.slice(at + NOTICE_HEAD.length, end === -1 ? script.length : end));
      for (const [key, p] of notice.packages) packages.set(key, p);
      for (const [name, t] of notice.texts) texts.set(name, [...(texts.get(name) ?? []), ...t]);
    }
  }
  const label = (/** @type {{ name: string, version: string }} */ p) => `${p.name} ${p.version}`;
  if (found === 0) {
    return runtime.length === 0 ? [] : [`no licence notice in any script; needed for ${runtime.map(label).join(', ')}`];
  }
  /** @type {string[]} */
  const problems = [];
  const sentence = squash(MIT_NOTICE_SENTENCE);
  for (const p of runtime) {
    const entry = packages.get(label(p));
    if (!entry) {
      problems.push(`no licence notice for the runtime package ${label(p)}`);
      continue;
    }
    if (entry.license !== p.license) problems.push(`the notice gives ${label(p)} the licence ${entry.license}, the lockfile ${p.license}`);
    if (entry.copyright.length === 0) problems.push(`the notice for ${label(p)} has no copyright line`);
    const own = (texts.get(p.name) ?? []).filter((t) => t !== '');
    if (own.length === 0) problems.push(`the notice has no licence text for ${label(p)}`);
    else if (p.license === 'MIT' && !own.some((t) => t.includes(sentence))) {
      problems.push(`the licence text for ${label(p)} lacks the sentence of the MIT licence: ${MIT_NOTICE_SENTENCE}`);
    }
  }
  const wanted = new Set(runtime.map(label));
  for (const [key] of packages) {
    if (!wanted.has(key)) problems.push(`the notice names ${key}, which is not a runtime package of the lockfile at that version`);
  }
  return problems;
}

/**
 * @typedef {{ file: string, rule: string, message: string }} Violation
 * @typedef {{ path: string, bytes: number }} SizeRow
 * @typedef {{ violations: Violation[], sizes: SizeRow[], totals: { js: number, css: number, total: number }, notices: string[] }} Report
 */

/**
 * Lists every entry under `root` (files, symlinks, others), `/`-separated, sorted.
 * @param {string} root
 * @returns {{ path: string, kind: 'file' | 'dir' | 'symlink' | 'other', bytes: number }[]}
 */
function walk(root) {
  /** @type {{ path: string, kind: 'file' | 'dir' | 'symlink' | 'other', bytes: number }[]} */
  const out = [];
  /** @param {string} rel */
  const visit = (rel) => {
    const abs = rel ? join(root, rel) : root;
    for (const name of readdirSync(abs).sort()) {
      const childRel = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(abs, name));
      if (st.isSymbolicLink()) out.push({ path: childRel, kind: 'symlink', bytes: 0 });
      else if (st.isDirectory()) visit(childRel);
      else if (st.isFile()) out.push({ path: childRel, kind: 'file', bytes: st.size });
      else out.push({ path: childRel, kind: 'other', bytes: 0 });
    }
  };
  visit('');
  return out;
}

/**
 * Line and column (1-based) of `index` in `text`, plus a short excerpt.
 * @param {string} text
 * @param {number} index
 * @param {number} length
 */
export function where(text, index, length) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const col = index - before.lastIndexOf('\n');
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  const excerpt = text.slice(start, end).replace(/\s+/g, ' ');
  return `${line}:${col} ...${excerpt}...`;
}

/** @param {string} s */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Tags of an HTML document with their attributes (names lower-cased, values decoded).
 * Good enough for the small, generated pages; not a general HTML parser.
 * @param {string} html
 */
function parseTags(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  /** @type {{ name: string, attrs: Map<string, string>, index: number }[]} */
  const tags = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (const m of withoutComments.matchAll(tagRe)) {
    const attrs = new Map();
    const attrRe = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
    for (const a of (m[2] ?? '').matchAll(attrRe)) {
      const name = (a[1] ?? '').toLowerCase();
      attrs.set(name, decodeEntities(a[2] ?? a[3] ?? a[4] ?? ''));
    }
    tags.push({ name: (m[1] ?? '').toLowerCase(), attrs, index: m.index });
  }
  return tags;
}

/**
 * Parses a CSP string into directive name -> source list.
 * @param {string} policy
 */
export function parseCsp(policy) {
  /** @type {Map<string, string[]>} */
  const directives = new Map();
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    const name = tokens.shift()?.toLowerCase();
    if (name && !directives.has(name)) directives.set(name, tokens);
  }
  return directives;
}

/**
 * Checks one Content-Security-Policy.
 * @param {string} content
 * @returns {string[]} problems
 */
export function checkCsp(content) {
  /** @type {string[]} */
  const problems = [];
  const policy = parseCsp(content);
  for (const name of CSP_REQUIRED) {
    if (!policy.has(name)) {
      const why = name === 'default-src' ? 'every fetch directive not listed would allow any host' : 'default-src does not cover it';
      problems.push(`${name} is missing: ${why}`);
    }
  }
  const fallback = policy.get('default-src');
  if (fallback && !(fallback.length === 1 && fallback[0]?.toLowerCase() === "'none'")) {
    problems.push(`default-src must be exactly 'none', found: ${fallback.join(' ') || '(empty)'}`);
  }
  for (const [name, sources] of policy) {
    if (name === 'default-src') continue;
    const allowed = CSP_ALLOWED.get(name) ?? ["'none'"];
    const lower = sources.map((src) => src.toLowerCase());
    if (lower.includes("'none'") && lower.length > 1) problems.push(`${name} lists 'none' together with other sources`);
    for (const src of sources) {
      if (allowed.includes(src.toLowerCase())) continue;
      problems.push(`${name} allows ${src}; allowed there: ${allowed.join(' ')}`);
    }
  }
  return problems;
}

/**
 * Checks a page: CSP meta, external references, inline scripts and handlers.
 * @param {string} file the page's path, for the report
 * @param {string} html
 * @param {Set<string>} shipped
 * @returns {Violation[]}
 */
function checkPage(file, html, shipped) {
  /** @type {Violation[]} */
  const v = [];
  /** @param {string} rule @param {string} message */
  const add = (rule, message) => v.push({ file, rule, message });
  const tags = parseTags(html);

  // Content-Security-Policy meta.
  const cspTags = tags.filter(
    (t) => t.name === 'meta' && (t.attrs.get('http-equiv') ?? '').toLowerCase() === 'content-security-policy',
  );
  if (cspTags.length === 0) {
    add('csp', 'no <meta http-equiv="Content-Security-Policy"> found');
  } else if (cspTags.length > 1) {
    add('csp', `${cspTags.length} CSP meta tags found; keep exactly one so the policy can be reviewed`);
  } else {
    const csp = /** @type {(typeof tags)[number]} */ (cspTags[0]);
    const firstLoad = tags.find((t) => t.name === 'script' || t.name === 'link' || t.name === 'style');
    if (firstLoad && firstLoad.index < csp.index) {
      add('csp', `the CSP meta comes after <${firstLoad.name}>; it only protects what follows it`);
    }
    for (const problem of checkCsp(csp.attrs.get('content') ?? '')) add('csp', problem);
  }

  for (const t of tags) {
    for (const [name, value] of t.attrs) {
      if (/^on[a-z]+$/.test(name)) add('html', `inline event handler ${name}= on <${t.name}>`);
      if (!URL_ATTRS.has(name)) continue;
      const urls = name === 'srcset' ? value.split(',').map((s) => s.trim().split(/\s+/)[0] ?? '') : [value.trim()];
      for (const url of urls) {
        if (url === '') continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
          const allowedData = url.toLowerCase().startsWith('data:') && (t.name === 'link' || t.name === 'img');
          if (!allowedData) add('html', `<${t.name} ${name}="${url.slice(0, 80)}"> points outside the site`);
          continue;
        }
        if (url.includes('?')) add('html', `<${t.name} ${name}="${url.slice(0, 80)}"> carries a query string`);
        const local = url.replace(/[?#].*$/, '').replace(/^\.\//, '').replace(/^\//, '');
        if (local !== '' && !shipped.has(local)) add('html', `<${t.name} ${name}="${url}"> refers to a missing file`);
      }
    }
    if (t.name === 'script' && !t.attrs.has('src')) add('html', 'inline <script> (scripts must be files in assets/)');
  }
  return v;
}

/**
 * Runs every check on the tree at `dir`.
 * @param {string} dir
 * @param {RuntimePackage[]} [runtime] the runtime packages of the lockfile, each of
 *   which needs a licence notice; none by default
 * @returns {Report}
 */
export function auditDist(dir, runtime = []) {
  const root = resolve(dir);
  const st = lstatSync(root, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error(`${dir} is not a directory; run the build first`);

  /** @type {Violation[]} */
  const violations = [];
  const entries = walk(root);
  const files = entries.filter((e) => e.kind === 'file');

  // 1. paths
  for (const e of entries) {
    if (e.kind !== 'file') violations.push({ file: e.path, rule: 'path', message: `${e.kind} is not allowed, ship regular files only` });
    else if (!SHIPPED_PATHS.some((re) => re.test(e.path))) {
      violations.push({ file: e.path, rule: 'path', message: 'not on the list of shipped paths (index.html, deuren.html, assets/*.js, assets/*.css)' });
    }
  }
  for (const page of PAGES) {
    if (!files.some((f) => f.path === page)) violations.push({ file: page, rule: 'path', message: 'missing' });
  }

  /** @type {Map<string, string>} */
  const texts = new Map(files.map((f) => [f.path, readFileSync(join(root, f.path), 'utf8')]));
  const shipped = new Set(files.map((f) => f.path));

  // 2. refs: every file except index.html is named by another shipped file. index.html
  // is the entry, and the link back to it is `./`; deuren.html must be linked by name.
  for (const f of files) {
    if (f.path === 'index.html') continue;
    const named = [...texts].some(([other, text]) => other !== f.path && text.includes(f.path));
    if (!named) violations.push({ file: f.path, rule: 'unreferenced', message: 'no other shipped file refers to it' });
  }

  // 3. size
  const sum = (/** @type {RegExp} */ re) => files.filter((f) => re.test(f.path)).reduce((n, f) => n + f.bytes, 0);
  const totals = { js: sum(/\.js$/), css: sum(/\.css$/), total: sum(/./) };
  for (const key of /** @type {const} */ (['js', 'css', 'total'])) {
    if (totals[key] > BUDGET[key]) {
      violations.push({ file: '(dist)', rule: 'size', message: `${key} is ${kb(totals[key])}, budget ${kb(BUDGET[key])}` });
    }
  }

  // 4. content, 5. runtime
  let viewLinks = 0;
  for (const [path, text] of texts) {
    /** @param {string} rule @param {string} message */
    const add = (rule, message) => violations.push({ file: path, rule, message });
    for (const { rule, what, re } of FORBIDDEN_CONTENT) {
      for (const m of text.matchAll(re)) add(rule, `${what} at ${where(text, m.index, m[0].length)}`);
    }
    for (const m of findEmails(text)) add('email', `e-mail address ${m.value} at ${where(text, m.index, m.value.length)}`);
    for (const m of findUrls(text)) {
      if (!isAllowedUrl(m.value)) add('url', `URL ${m.value.slice(0, 100)} is not on the allow-list`);
    }
    for (const m of findProtocolRelative(text)) {
      add('url', `protocol-relative URL ${m.value.slice(0, 100)} at ${where(text, m.index, m.value.length)}`);
    }
    if (!path.endsWith('.js')) {
      for (const m of findPrivateHostNames(text)) {
        add('private-host', `private host name ${m.value} at ${where(text, m.index, m.value.length)}`);
      }
    } else {
      for (const [name, re] of RUNTIME_APIS) {
        const m = text.match(re);
        if (m && m.index !== undefined) add('runtime', `${name} at ${where(text, m.index, m[0].length)}`);
      }
      for (const [name, re] of REQUEST_SINKS) {
        const m = text.match(re);
        if (m && m.index !== undefined) add('request', `${name} at ${where(text, m.index, m[0].length)}`);
      }
      const hrefs = hrefProps(text);
      for (const at of hrefs.others) {
        add('request', `link in element props (href) that is not the link to the other view at ${where(text, at, 5)}`);
      }
      for (const at of hrefs.viewLinks) {
        if (++viewLinks > VIEW_LINK_HREFS_MAX) {
          add('request', `link to the other view beyond the ${VIEW_LINK_HREFS_MAX} the pages render at ${where(text, at, 5)}`);
        }
      }
    }
  }

  // 6. html
  for (const page of PAGES) {
    const html = texts.get(page);
    if (html !== undefined) violations.push(...checkPage(page, html, shipped));
  }

  // 7. notice
  const scripts = [...texts].filter(([path]) => path.endsWith('.js')).map(([, text]) => text);
  for (const message of noticeProblems(scripts, runtime)) violations.push({ file: '(dist)', rule: 'notice', message });

  const sizes = files.map((f) => ({ path: f.path, bytes: f.bytes }));
  return { violations, sizes, totals, notices: runtime.map((p) => `${p.name} ${p.version}`) };
}

/** @param {string} url */
function isAllowedUrl(url) {
  if (ALLOWED_URLS.includes(url)) return true;
  if (url === REPO_URL) return true;
  return url.startsWith(`${REPO_URL}/`) || url.startsWith(`${REPO_URL}#`) || url.startsWith(`${REPO_URL}?`);
}

/** @param {number} bytes */
function kb(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

/**
 * Human-readable report.
 * @param {Report} report
 */
export function formatReport(report) {
  const lines = ['Sizes (1 kB = 1000 bytes):'];
  const width = Math.max(10, ...report.sizes.map((s) => s.path.length));
  for (const s of report.sizes) lines.push(`  ${s.path.padEnd(width)}  ${kb(s.bytes).padStart(9)}`);
  const labels = { js: 'all JS', css: 'all CSS', total: 'whole dist' };
  for (const key of /** @type {const} */ (['js', 'css', 'total'])) {
    const ok = report.totals[key] <= BUDGET[key] ? 'ok' : 'OVER BUDGET';
    lines.push(`  ${labels[key].padEnd(width)}  ${kb(report.totals[key]).padStart(9)}  budget ${kb(BUDGET[key])}  ${ok}`);
  }
  lines.push(`Licence notices required (runtime packages of the lockfile): ${report.notices.join(', ') || 'none'}`);
  if (report.violations.length === 0) {
    lines.push('check:dist: clean, no violations');
  } else {
    lines.push(`check:dist: ${report.violations.length} violation(s):`);
    for (const v of report.violations) lines.push(`  ${v.file}: [${v.rule}] ${v.message}`);
  }
  return lines.join('\n');
}

/** @param {string[]} argv */
function main(argv) {
  const dir = argv[0] ?? 'dist';
  const lockfile = argv[1] ?? 'package-lock.json';
  let report;
  try {
    let runtime;
    try {
      runtime = runtimePackages(JSON.parse(readFileSync(lockfile, 'utf8')));
    } catch (err) {
      throw new Error(`cannot read the lockfile ${lockfile}: ${err instanceof Error ? err.message : String(err)}`);
    }
    report = auditDist(dir, runtime);
  } catch (err) {
    console.error(`check:dist: the audit could not run: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const text = formatReport(report);
  if (report.violations.length > 0) console.error(text);
  else console.log(text);
  return report.violations.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
