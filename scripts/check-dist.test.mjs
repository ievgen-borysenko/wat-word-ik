import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_URL, auditDist, formatReport } from './check-dist.mjs';

const SCRIPT = resolve(import.meta.dirname, 'check-dist.mjs');
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'";

/** @type {string[]} */
const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** @param {{ csp?: string, head?: string, body?: string, js?: string }} [o] */
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

/** A minimal tree shaped like the real build. */
function cleanTree() {
  return {
    'index.html': html(),
    'assets/index-abc123.js':
      'const n=`http://www.w3.org/2000/svg`;let h="docs/methodology.md";location.hash="#s=6";history.replaceState(null,"",h);',
    'assets/index-def456.css': '.a{color:red}@media (max-width:600px){.a{color:blue}}',
    'docs/methodology.md': `# How it works\n\nSource: ${REPO_URL}/blob/main/docs/methodology.md.\n`,
  };
}

/**
 * Writes `files` into a fresh temp directory; `null` removes a file of the clean tree.
 * @param {Record<string, string | null>} [overrides]
 */
function tree(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-dist-'));
  made.push(dir);
  /** @type {Record<string, string | null>} */
  const files = { ...cleanTree(), ...overrides };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** @param {string} dir */
const rules = (dir) => auditDist(dir).violations.map((v) => `${v.file} ${v.rule}`);

/** @param {string} js */
const withJs = (js) => tree({ 'assets/index-abc123.js': `${cleanTree()['assets/index-abc123.js']}${js}` });

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
      ['src/main.tsx', 'x'],
    ])('rejects %s', (path, content) => {
      expect(rules(tree({ [path]: content }))).toContain(`${path} path`);
    });

    it('rejects a symlink', () => {
      const dir = tree();
      symlinkSync(join(dir, 'index.html'), join(dir, 'docs', 'link.md'));
      expect(rules(dir)).toContain('docs/link.md path');
    });

    it('requires index.html', () => {
      expect(rules(tree({ 'index.html': null }))).toContain('index.html path');
    });
  });

  describe('references', () => {
    it('rejects a shipped file nobody refers to', () => {
      expect(rules(tree({ 'docs/extra.md': '# Extra\n' }))).toEqual(['docs/extra.md unreferenced']);
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
      const css = `.a{color:red}/*${'x'.repeat(40_000)}*/`;
      expect(rules(tree({ 'assets/index-def456.css': css }))).toEqual(['(dist) size']);
    });

    it('rejects a whole tree over 400 kB', () => {
      const big = `# Big\n\n${'word '.repeat(80_000)}\n`;
      const dir = tree({ 'docs/big.md': big, 'assets/index-abc123.js': `${cleanTree()['assets/index-abc123.js']}"docs/big.md"` });
      expect(rules(dir)).toEqual(['(dist) size']);
    });
  });

  describe('forbidden content', () => {
    it.each([
      ['local-path', '"/Users/someone/project/src/main.tsx"'],
      ['local-path', '"/home/runner/work/x"'],
      ['local-path', '"C:\\\\Users\\\\someone\\\\x"'],
      ['local-host', '"127.0.0.1"'],
      ['local-host', '"LOCALHOST"'],
      ['private-key', `"${'-----BEGIN RSA PRI'}${'VATE KEY-----'}"`],
      ['private-key', `"${'-----BEGIN OPENSSH PRI'}${'VATE KEY-----'}"`],
      ['source-map', '\n//# sourceMappingURL=index-abc123.js.map'],
      ['email', '"someone@example.com"'],
      ['url', '"https://cdn.example.com/x.js"'],
      ['url', '"wss://example.com/socket"'],
    ])('rejects %s: %s', (rule, js) => {
      expect(rules(withJs(js))).toContain(`assets/index-abc123.js ${rule}`);
    });

    it('checks markdown and CSS too', () => {
      const dir = tree({
        'docs/methodology.md': '# How\n\nWrite to someone@example.com or see http://localhost:5173/.\n',
        'assets/index-def456.css': '@import url("https://fonts.example.com/a.css");.a{color:red}',
      });
      expect(rules(dir)).toEqual([
        'assets/index-def456.css url',
        'docs/methodology.md local-host',
        'docs/methodology.md email',
        'docs/methodology.md url',
      ]);
    });

    it('allows the XML namespaces, the repository URL and the project noreply address', () => {
      const js = `"http://www.w3.org/1999/xhtml";"${REPO_URL}#readme";"310343018+xevbor@users.noreply.github.com"`;
      expect(rules(withJs(js))).toEqual([]);
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
      'navigator.serviceWorker.register("sw.js")',
      'importScripts("x.js")',
      'eval(s)',
      'new Function("return 1")',
      'Function("return 1")()',
    ])('rejects %s', (js) => {
      expect(rules(withJs(js))).toEqual(['assets/index-abc123.js runtime']);
    });

    it.each(['link.rel="prefetch"', 'a.fetchpriority="high"', 'x.isFunction(y)', 'obj.Function(y)', 'cookies'])(
      'does not flag %s',
      (js) => {
        expect(rules(withJs(`"${js}";`))).toEqual([]);
      },
    );
  });

  describe('index.html', () => {
    it('requires the CSP meta', () => {
      expect(rules(tree({ 'index.html': html({ csp: '' }) }))).toEqual(['index.html csp']);
    });

    it('accepts default-src none without connect-src', () => {
      const dir = tree({ 'index.html': html({ csp: "default-src 'none'; script-src 'self'; style-src 'self'" }) });
      expect(rules(dir)).toEqual([]);
    });

    it.each([
      "default-src 'self'; script-src 'self'",
      "default-src 'none'; connect-src 'self'",
      "default-src 'self'; connect-src 'none' 'self'",
    ])('rejects a policy that allows connections: %s', (csp) => {
      expect(rules(tree({ 'index.html': html({ csp }) }))).toContain('index.html csp');
    });

    it.each([
      "default-src 'self'; connect-src 'none'; script-src 'self' cdn.example.com",
      "default-src 'self'; connect-src 'none'; img-src *",
      "default-src 'self'; connect-src 'none'; script-src 'self' 'unsafe-eval'",
      "default-src 'self'; connect-src 'none'; style-src 'self' data:",
      "default-src 'self'; connect-src 'none'; report-uri /csp-report",
    ])('rejects a policy with a remote or unsafe source: %s', (csp) => {
      expect(rules(tree({ 'index.html': html({ csp }) }))).toEqual(['index.html csp']);
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
      ['<link rel="stylesheet" href="//cdn.example.com/x.css">', ['index.html html']],
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
    const dir = tree({ '.DS_Store': 'x', 'assets/index-abc123.js': 'fetch("https://api.example.com/");"docs/methodology.md"' });
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
