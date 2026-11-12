#!/usr/bin/env node
// Audit of the BUILT site (dist/) before it is published.
//
// The page promises: no accounts, no ads, no analytics, no cookies or storage,
// no network requests at run time. This script checks that the files we are
// about to ship keep that promise and carry nothing else:
//
//   1. paths    every shipped file is on an allow-list (index.html and the JS and
//               CSS bundles; no source maps, dotfiles, JSON dumps, docs, tests,
//               images) and is a regular file;
//   2. refs     every file except index.html is referenced by another shipped
//               file, and every local reference in index.html exists;
//   3. size     JS, CSS and the whole tree stay within a budget;
//   4. content  no absolute local paths, local or private hosts, private keys,
//               source map comments, e-mail addresses (none at all), URLs outside
//               an allow-list or protocol-relative URLs;
//   5. runtime  the JS names no browser API that talks to the network, stores
//               data or starts a worker, and no way to send data to the page's
//               own host without one (an image request, a navigation, a URL
//               written into an element, a string that starts a query string);
//   6. html     index.html carries a Content-Security-Policy meta that lets the
//               page load its own script and stylesheet and nothing else
//               (default-src 'none'); it loads nothing from another host, has
//               no inline scripts or event handlers and no local URL with a
//               query string.
//
// Usage: node scripts/check-dist.mjs [dir]   (default: dist)
// Exit codes: 0 clean, 1 violations found (all of them are listed), 2 the audit
// itself could not run (missing directory, unreadable file).

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Future public repository; links to it may appear in shipped files. */
export const REPO_URL = 'https://github.com/ievgen-borysenko/wat-word-ik';

/** Paths (relative to dist, `/`-separated) that may be shipped. Nothing else. */
export const SHIPPED_PATHS = [/^index\.html$/, /^assets\/[A-Za-z0-9_-]+\.js$/, /^assets\/[A-Za-z0-9_-]+\.css$/];

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
 * The rule for drive paths: the drive letter must start a token, that is, stand
 * at the start of the text or a line, after whitespace, a quote, a backtick, `(`
 * or `file:///`, because minified JavaScript puts a one-letter object key,
 * ternary branch or label before `:/regex/` only right after other punctuation
 * (`{a:/b/}`, `,b:/x/g`, `c?a:/re/`, `x.a:`, `x=a:`, `;e:`, `}a:`).
 * Accepted gaps of that rule:
 *   - not found: a drive path right after other punctuation, such as `;D:\x` in
 *     a PATH-like list (its first entry is found), `=D:/x`, `[D:/x]`, `<D:/x>`
 *     or Markdown emphasis around it;
 *   - still reported: a one-letter key, label or case value after whitespace
 *     and directly followed by a regular expression (`case a:` or `{ a:` with
 *     no space before the `/`; write `a: /x/`), and a one-letter word right
 *     after a quote and followed by a colon, a backslash and a letter (an
 *     escaped new line in a string that starts with such a word).
 * Not on the list at all, because they also appear in ordinary text or code and
 * say nothing about a person: `~/`, `/opt/`; a colon that is not followed by a
 * separator and a path character (`a:hover`, `12:30`, Markdown table rules,
 * `https:`); a drive-relative path without a separator; UNC paths written with
 * forward slashes, which in the built site are refused as protocol-relative URLs
 * and in the repository cannot be told from `//` comments.
 */
export const LOCAL_PATH_RE =
  /\/Users\/|\/home\/|\/root\/|\/private\/var\/|\/var\/folders\/|\/Volumes\/|\/mnt\/|(?<=^|[\s"'`(]|file:\/\/\/)[A-Za-z]:(?:\\{1,2}|\/)(?=[A-Za-z0-9_$~.-])|(?<![\\\w])\\{2}(?:\\{2})?[A-Za-z0-9_$.-]+\\{1,2}[A-Za-z0-9_$.-]/g;

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
 *   - a string literal that starts a query string ("?key=", "/path?key=",
 *     "./x?key=", also as a template literal) where an expression begins.
 * It does NOT find a property or attribute name assembled at run time
 * (el[k] = v, setAttribute(k, v)), a URL built from character codes, aliasing
 * of open or location, history.pushState/replaceState with a query (the page
 * writes its own hash with replaceState; a query written there reaches the
 * host on the next reload), or a link the user clicks. The CSP (default-src
 * 'none') makes the browser block image, media, frame and object loads in
 * any case; a navigation is not a load that CSP can block, so for those the
 * end-to-end guard, which refuses every request with a query string, is the
 * remaining layer, for the paths the tests take. A UI string containing
 * "Image", "Audio" or "open(" is reported as well: reword the string.
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

/**
 * @typedef {{ file: string, rule: string, message: string }} Violation
 * @typedef {{ path: string, bytes: number }} SizeRow
 * @typedef {{ violations: Violation[], sizes: SizeRow[], totals: { js: number, css: number, total: number } }} Report
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
 * Good enough for the small, generated index.html; not a general HTML parser.
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
 * Checks index.html: CSP meta, external references, inline scripts and handlers.
 * @param {string} html
 * @param {Set<string>} shipped
 * @returns {Violation[]}
 */
function checkIndexHtml(html, shipped) {
  /** @type {Violation[]} */
  const v = [];
  /** @param {string} rule @param {string} message */
  const add = (rule, message) => v.push({ file: 'index.html', rule, message });
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
 * @returns {Report}
 */
export function auditDist(dir) {
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
      violations.push({ file: e.path, rule: 'path', message: 'not on the list of shipped paths (index.html, assets/*.js, assets/*.css)' });
    }
  }
  if (!files.some((f) => f.path === 'index.html')) {
    violations.push({ file: 'index.html', rule: 'path', message: 'missing' });
  }

  /** @type {Map<string, string>} */
  const texts = new Map(files.map((f) => [f.path, readFileSync(join(root, f.path), 'utf8')]));
  const shipped = new Set(files.map((f) => f.path));

  // 2. refs: every file except index.html is named by another shipped file.
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
    }
  }

  // 6. html
  const html = texts.get('index.html');
  if (html !== undefined) violations.push(...checkIndexHtml(html, shipped));

  const sizes = files.map((f) => ({ path: f.path, bytes: f.bytes }));
  return { violations, sizes, totals };
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
  let report;
  try {
    report = auditDist(dir);
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
