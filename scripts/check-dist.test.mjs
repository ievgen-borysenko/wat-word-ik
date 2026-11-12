import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_URL, auditDist, checkCsp, formatReport } from './check-dist.mjs';

/*
 * Strings that the repository's own tree check refuses (e-mail addresses, home
 * folders, key headers) are put together at run time, so this file holds none.
 */
const AT = '@';
const email = (/** @type {string} */ local, /** @type {string} */ domain) => `${local}${AT}${domain}`;
const path = (/** @type {string[]} */ ...parts) => `/${parts.join('/')}`;
const KEY_HEADER = (/** @type {string} */ kind) => `-----BEGIN ${kind}PRI${'VATE'} KEY-----`;

const SCRIPT = resolve(import.meta.dirname, 'check-dist.mjs');
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'";

/** @type {string[]} */
const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** @param {{ csp?: string, head?: string, body?: string }} [o] */
function html(o = {}) {
  const csp = o.csp ?? CSP;
  return [
    '<!doctype html><html lang="en"><head>',
    csp === '' ? '' : `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/'/g, '&#39;')}">`,
    `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E">`,
    o.head ?? '',
    '<script type="module" crossorigin src="./assets/index-abc123.js"></script>',
    '<link rel="stylesheet" crossorigin href="./assets/index-def456.css">',
    `</head><body>${o.body ?? '<div id="app"></div>'}</body></html>`,
  ].join('\n');
}

const CLEAN_JS =
  'const n=`http://www.w3.org/2000/svg`;let h="#s=6";location.hash.startsWith(h)&&history.replaceState(null,"",h);';
const CLEAN_CSS = '.a{color:red}@media (max-width:600px){.a{color:blue}}.lang-btn{x:1}';

/** A minimal tree shaped like the real build. */
function cleanTree() {
  return {
    'index.html': html(),
    'assets/index-abc123.js': CLEAN_JS,
    'assets/index-def456.css': CLEAN_CSS,
  };
}

/**
 * Writes the clean tree plus `overrides` into a fresh temp directory;
 * `null` removes a file of the clean tree.
 * @param {Record<string, string | null>} [overrides]
 */
function tree(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-dist-'));
  made.push(dir);
  /** @type {Record<string, string | null>} */
  const files = { ...cleanTree(), ...overrides };
  for (const [file, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

/** @param {string} dir */
const rules = (dir) => auditDist(dir).violations.map((v) => `${v.file} ${v.rule}`);

/** @param {string} js */
const withJs = (js) => tree({ 'assets/index-abc123.js': `${CLEAN_JS}${js}` });

/** @param {string} css */
const withCss = (css) => tree({ 'assets/index-def456.css': `${CLEAN_CSS}${css}` });

describe('check-dist', () => {
  it('passes a clean tree and prints the sizes', () => {
    const report = auditDist(tree());
    expect(report.violations).toEqual([]);
    expect(report.totals.js).toBeGreaterThan(0);
    expect(formatReport(report)).toContain('check:dist: clean');
  });

  describe('paths', () => {
    it.each([
      ['assets/index-abc123.js.map', '{"version":3}'],
      ['.env', 'A=1'],
      ['assets/.hidden.js', 'x'],
      ['stats.json', '{}'],
      ['assets/logo.png', 'png'],
      ['assets/index.test.js', 'x'],
      ['docs/methodology.md', '# How'],
      ['src/main.tsx', 'x'],
    ])('rejects %s', (file, content) => {
      expect(rules(tree({ [file]: content }))).toContain(`${file} path`);
    });

    it('rejects a symlink', () => {
      const dir = tree();
      symlinkSync(join(dir, 'index.html'), join(dir, 'assets', 'link.js'));
      expect(rules(dir)).toContain('assets/link.js path');
    });

    it('requires index.html', () => {
      expect(rules(tree({ 'index.html': null }))).toContain('index.html path');
    });
  });

  describe('references', () => {
    it('rejects a shipped file nobody refers to', () => {
      expect(rules(tree({ 'assets/index-extra.js': 'let a=1;' }))).toEqual(['assets/index-extra.js unreferenced']);
    });

    it('rejects a reference to a missing file', () => {
      const dir = tree({ 'index.html': html({ head: '<script type="module" src="./assets/missing.js"></script>' }) });
      expect(rules(dir)).toEqual(['index.html html']);
    });
  });

  describe('size budget', () => {
    it('rejects JS over 150 kB', () => {
      expect(rules(withJs(`/*${'x'.repeat(150_000)}*/`))).toContain('(dist) size');
    });

    it('rejects CSS over 40 kB', () => {
      expect(rules(withCss(`/*${'x'.repeat(40_000)}*/`))).toEqual(['(dist) size']);
    });

    it('rejects a whole tree over 400 kB', () => {
      const big = html({ body: `<div id="app"></div><!--${'x'.repeat(400_000)}-->` });
      expect(rules(tree({ 'index.html': big }))).toEqual(['(dist) size']);
    });
  });

  describe('forbidden content', () => {
    it.each([
      ['local-path', `"${path('Users', 'someone', 'project', 'src', 'main.tsx')}"`],
      ['local-path', `"${path('home', 'runner', 'work', 'x')}"`],
      ['local-path', `"${path('private', 'var', 'folders', 'ab', 'T', 'x')}"`],
      ['local-path', `"${path('var', 'folders', 'ab', 'T', 'x')}"`],
      ['local-path', `"${path('Volumes', 'Backup', 'x')}"`],
      ['local-path', `"C:${'\\\\'}Users${'\\\\'}someone"`],
      ['local-host', '"127.0.0.1"'],
      ['local-host', '"LOCALHOST"'],
      ['private-host', '"10.0.0.5"'],
      ['private-host', '"172.20.1.1"'],
      ['private-host', '"192.168.1.10"'],
      ['private-key', `"${KEY_HEADER('RSA ')}"`],
      ['private-key', `"${KEY_HEADER('OPENSSH ')}"`],
      ['private-key', `"${KEY_HEADER('')}"`],
      ['source-map', '\n//# sourceMappingURL=index-abc123.js.map'],
      ['email', `"${email('someone', 'example.com')}"`],
      ['url', '"https://cdn.example.com/x.js"'],
      ['url', '"wss://example.com/socket"'],
      ['url', '"//cdn.example.com/x.js"'],
      ['url', 'import(`//cdn.example.com:8080/x.js`)'],
    ])('rejects %s: %s', (rule, js) => {
      expect(rules(withJs(js))).toContain(`assets/index-abc123.js ${rule}`);
    });

    it.each([
      '"172.32.0.1"',
      '"10.0.0"',
      '"1.10.0.0"',
      'e.local=1;e.lan=2;e.internal=3',
      'a="x//y.z"',
      '"// comment.like text"',
      '/\\/\\/x.y/.test(s)',
    ])('does not flag %s', (js) => {
      expect(rules(withJs(js))).toEqual([]);
    });

    it('rejects every e-mail address, a noreply address included', () => {
      const js = `"${email('12345+someone', 'users.noreply.github.com')}"`;
      expect(rules(withJs(js))).toEqual(['assets/index-abc123.js email']);
    });

    it('checks CSS and HTML too, including private host names and protocol-relative URLs', () => {
      const dir = tree({
        'index.html': html({ body: '<div id="app" data-x="nas.local"></div>' }),
        'assets/index-def456.css': `${CLEAN_CSS}@import url("https://fonts.example.com/a.css");.b{background:url(//cdn.example.com/a.png)}.c{content:"printer.lan api.internal"}`,
      });
      expect(rules(dir).sort()).toEqual(
        [
          'assets/index-def456.css url',
          'assets/index-def456.css url',
          'assets/index-def456.css private-host',
          'assets/index-def456.css private-host',
          'index.html private-host',
        ].sort(),
      );
    });

    it('allows the XML namespaces and the repository URL', () => {
      expect(rules(withJs(`"http://www.w3.org/1999/xhtml";"${REPO_URL}#readme"`))).toEqual([]);
    });

    it('does not let a look-alike of the repository URL through', () => {
      expect(rules(withJs(`"${REPO_URL}-evil.example.com/x"`))).toEqual(['assets/index-abc123.js url']);
    });
  });

  describe('runtime capabilities in JS', () => {
    it.each([
      'fetch("/x")',
      'window.fetch("/x")',
      'const f=fetch;',
      'window["fetch"]("/x")',
      'new XMLHttpRequest',
      'new WebSocket(u)',
      'new EventSource(u)',
      'navigator.sendBeacon(u,d)',
      'new WebTransport(u)',
      'new RTCPeerConnection',
      'localStorage.setItem("a","b")',
      'self[`sessionStorage`]',
      'indexedDB.open("x")',
      'document.cookie="a=b"',
      'cookieStore.set("a","b")',
      'caches.open("v1")',
      'navigator.storage.persist()',
      'n.storage.getDirectory()',
      'navigator.serviceWorker.register("sw.js")',
      'new Worker(u)',
      'new SharedWorker(u)',
      'importScripts("x.js")',
      'eval(s)',
      'new Function("return 1")',
      'Function("return 1")()',
    ])('rejects %s', (js) => {
      expect(rules(withJs(js))).toEqual(['assets/index-abc123.js runtime']);
    });

    it.each([
      'link.rel="prefetch"',
      'a.fetchpriority="high"',
      'x.isFunction(y)',
      'obj.Function(y)',
      'cookies',
      'x.storage',
      'workers',
      'Workerless',
    ])('does not flag %s', (js) => {
      expect(rules(withJs(`"${js}";`))).toEqual([]);
    });
  });

  describe('Content-Security-Policy', () => {
    it('accepts the policy of the real build', () => {
      const real =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";
      expect(checkCsp(real)).toEqual([]);
    });

    it('accepts default-src none without connect-src', () => {
      expect(checkCsp("default-src 'none'; script-src 'self'; style-src 'self'")).toEqual([]);
    });

    it.each([
      // connect-src 'none' alone: images, media, frames and scripts from any host.
      "connect-src 'none'",
      "script-src 'self'; connect-src 'none'",
      "default-src *; connect-src 'none'",
      "default-src 'self' 'none'; connect-src 'none'",
      "default-src; connect-src 'none'",
    ])('rejects a policy without a strict default-src: %s', (csp) => {
      expect(checkCsp(csp).some((p) => p.startsWith('default-src'))).toBe(true);
    });

    it.each([
      "default-src 'self'; script-src 'self'",
      "default-src 'none'; connect-src 'self'",
      "default-src 'self'; connect-src 'none' 'self'",
    ])('rejects a policy that allows connections: %s', (csp) => {
      expect(checkCsp(csp).length).toBeGreaterThan(0);
    });

    it.each([
      "default-src 'self'; connect-src 'none'; script-src 'self' cdn.example.com",
      "default-src 'self'; connect-src 'none'; img-src *",
      "default-src 'self'; connect-src 'none'; script-src 'self' 'unsafe-eval'",
      "default-src 'self'; connect-src 'none'; style-src 'self' data:",
      "default-src 'self'; connect-src 'none'; report-uri /csp-report",
    ])('rejects a remote or unsafe source: %s', (csp) => {
      expect(checkCsp(csp)).toHaveLength(1);
    });
  });

  describe('index.html', () => {
    it('requires the CSP meta', () => {
      expect(rules(tree({ 'index.html': html({ csp: '' }) }))).toEqual(['index.html csp']);
    });

    it("rejects a meta with connect-src 'none' alone", () => {
      expect(rules(tree({ 'index.html': html({ csp: "connect-src 'none'" }) }))).toEqual(['index.html csp']);
    });

    it('rejects a CSP meta that comes after a script', () => {
      const late = html({ csp: '' }).replace(
        '</head>',
        `<meta http-equiv="Content-Security-Policy" content="${CSP.replace(/'/g, '&#39;')}"></head>`,
      );
      expect(rules(tree({ 'index.html': late }))).toEqual(['index.html csp']);
    });

    it.each([
      ['<script src="https://cdn.example.com/x.js"></script>', ['index.html html', 'index.html url']],
      ['<link rel="stylesheet" href="//cdn.example.com/x.css">', ['index.html html', 'index.html url']],
      ['<script>console.log(1)</script>', ['index.html html']],
      ['<a href="javascript:void(0)">x</a>', ['index.html html']],
      ['<img src="x.png" onerror="go()">', ['index.html html', 'index.html html']],
    ])('rejects %s', (head, expected) => {
      expect(rules(tree({ 'index.html': html({ head }) })).sort()).toEqual(expected.sort());
    });

    it('rejects an inline event handler on body', () => {
      expect(rules(tree({ 'index.html': html({ body: '<div id="app" onclick="x()"></div>' }) }))).toEqual([
        'index.html html',
      ]);
    });
  });

  it('lists every violation, not only the first', () => {
    const dir = tree({ '.DS_Store': 'x', 'assets/index-abc123.js': 'fetch("https://api.example.com/");' });
    const report = auditDist(dir);
    expect(report.violations.map((v) => v.rule).sort()).toEqual(['path', 'runtime', 'unreferenced', 'url']);
    const text = formatReport(report);
    for (const v of report.violations) expect(text).toContain(v.message);
  });

  describe('command line', () => {
    /** @param {string} dir */
    const run = (dir) => spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });

    it('exits 0 on a clean tree', () => {
      const r = run(tree());
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('check:dist: clean');
    });

    it('exits 1 and lists the violations', () => {
      const r = run(withJs('localStorage.x=1'));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('[runtime] localStorage');
    });

    it('exits 2 when the directory is missing', () => {
      const r = run(join(tmpdir(), 'check-dist-does-not-exist-'));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('could not run');
    });
  });
});
