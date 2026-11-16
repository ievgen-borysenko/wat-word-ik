import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MIT_NOTICE_SENTENCE,
  NOTICE_HEAD,
  REPO_URL,
  VIEW_LINK_HREFS_MAX,
  auditDist,
  checkCsp,
  formatNotice,
  formatReport,
  hrefProps,
  noticeProblems,
  splitLicence,
} from './check-dist.mjs';
import { runtimePackages } from './check-lockfile.mjs';

/*
 * Strings that the repository's own tree check refuses (e-mail addresses, home
 * folders, private network addresses, key headers) are put together at run
 * time, so this file holds none.
 */
const AT = '@';
const email = (/** @type {string} */ local, /** @type {string} */ domain) => `${local}${AT}${domain}`;
const path = (/** @type {string[]} */ ...parts) => `/${parts.join('/')}`;
const KEY_HEADER = (/** @type {string} */ kind) => `-----BEGIN ${kind}PRI${'VATE'} KEY-----`;
const ip = (/** @type {number[]} */ ...octets) => octets.join('.');
/** A Windows path from a drive root, with the given separator. */
const win = (/** @type {string} */ drive, /** @type {string} */ sep, /** @type {string[]} */ ...parts) =>
  `${drive}:${sep}${parts.join(sep)}`;
/** A UNC path, with the given separator (one backslash, or two as in JS source). */
const unc = (/** @type {string} */ sep, /** @type {string[]} */ ...parts) => `${sep}${sep}${parts.join(sep)}`;

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = resolve(import.meta.dirname, 'check-dist.mjs');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; base-uri 'none'; form-action 'none'";

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

/** A script without the links to the other view, so nothing links to deuren.html. */
const BASE_JS =
  'const n=`http://www.w3.org/2000/svg`;let h="#s=6";location.hash.startsWith(h)&&history.replaceState(null,"",h);';
/**
 * The link to the other view on each page, in the shape the real build writes
 * (src/ui/OtherViewLink.tsx): the two `href` props that check:dist allows.
 */
const VIEW_LINKS_JS =
  'function W({to:e}){let t=S.value.slice(1),n=F(Q.value,e);return e===`doors`?$(`a`,{class:`other-view`,href:`deuren.html#${t}`,children:n}):$(`a`,{class:`other-view`,href:`./#${t}`,children:n})}';
const CLEAN_JS = BASE_JS + VIEW_LINKS_JS;
const CLEAN_CSS = '.a{color:red}@media (max-width:600px){.a{color:blue}}.lang-btn{x:1}';

/** A minimal tree shaped like the real build: both pages, the script links to deuren.html. */
function cleanTree() {
  return {
    'index.html': html(),
    'deuren.html': html(),
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

    it('requires deuren.html: a build that leaves out the doors view is refused', () => {
      const report = auditDist(tree({ 'deuren.html': null }));
      expect(report.violations).toEqual([{ file: 'deuren.html', rule: 'path', message: 'missing' }]);
    });

    it('reports each missing page', () => {
      const found = auditDist(tree({ 'index.html': null, 'deuren.html': null })).violations;
      expect(found.filter((v) => v.message === 'missing').map((v) => v.file)).toEqual(['index.html', 'deuren.html']);
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
      ['local-path', `"${path('root', 'project', 'x')}"`],
      ['local-path', `"${path('mnt', 'c', 'work', 'x')}"`],
      ['local-path', `"C:${'\\\\'}Users${'\\\\'}someone"`],
      ['local-path', `"${win('D', '/', 'dev', 'Alice', 'wat-word-ik')}"`],
      ['local-path', `"${win('D', '\\\\', 'dev', 'Alice')}"`],
      ['local-path', `"file:///${win('C', '/', 'x')}"`],
      ['local-path', `"${unc('\\\\', 'nas', 'share', 'site')}"`],
      ['local-path', `'${win('D', '/', 'dev', 'x')}'`],
      ['local-path', `\`${win('C', '\\\\', 'Users', 'x')}\``],
      ['local-path', `"Built in ${win('D', '/', 'dev', 'Alice')}"`],
      ['local-path', `f(${'`'}${win('E', '/', 'build')}${'`'})`],
      // File URLs: the pathname (one slash before the drive), two slashes, and
      // `file:///` after a character that does not start a token.
      ['local-path', `"/${win('D', '/', 'dev', 'x')}"`],
      ['local-path', `"file://${win('D', '/', 'x')}"`],
      ['local-path', `"<file:///${win('D', '/', 'x')}>"`],
      // The backslash form is found whatever precedes it short of a letter or digit
      // (one backslash, so that the UNC alternative cannot be what finds it).
      ['local-path', `"--root=${win('D', '\\', 'dev', 'x')}"`],
      ['local-path', `"[${win('C', '\\', 'Users', 'x')}]"`],
      ['local-path', `"bin;${win('D', '\\', 'tools', 'bin')}"`],
      ['local-path', `"**${win('C', '\\', 'Users', 'x')}**"`],
      ['local-host', '"127.0.0.1"'],
      ['local-host', '"LOCALHOST"'],
      ['private-host', `"${ip(10, 0, 0, 5)}"`],
      ['private-host', `"${ip(172, 20, 1, 1)}"`],
      ['private-host', `"${ip(192, 168, 1, 10)}"`],
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
      '"http://www.w3.org/1999/xhtml"',
      '".a:hover{color:red}"',
      '"12:30"',
      '"|:---|:---:|"',
      '"data:image/svg+xml,x"',
      'c?e:/[a-z]/.test(s)',
      // Minified JavaScript: a one-letter key, ternary branch or label before a regular expression.
      'const r={a:/beta/}',
      'const o={a:/beta/,b:/x/g,c:/y/gi}',
      'f(c?a:/re/.test(s):0)',
      'f(c?x.a:/re/:0)',
      'f(c?x=a:/re/:0)',
      'for(;;){e:/x/.test(s);break}',
      'if(x){}a:/y/g.exec(s)',
      'c?/a/g:/b/g',
      'x=a/b:/c/',
      '"a\\nb"',
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

    it('passes a bundle whose only odd shape is a one-letter key before a regex literal', () => {
      expect(rules(withJs('const r={a:/beta/};'))).toEqual([]);
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

    it('finds a private host name before a full stop, not a label of a longer name', () => {
      expect(rules(withCss('.c{content:"Open nas.local."}'))).toEqual(['assets/index-def456.css private-host']);
      expect(rules(withCss('.c{content:"See a.local.example.com or x.lan-party"}'))).toEqual([]);
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

  describe('requests to the own host in JS', () => {
    it('rejects an image request that sends the grades three times over: Image, a .src write, a query string', () => {
      const js = 'new Image().src="/index.html?grades="+encodeURIComponent(location.hash);';
      const found = auditDist(withJs(js)).violations.map((v) => v.message.split(' at ')[0]);
      expect(found).toEqual(['Image or Audio constructor', 'URL property write', 'query string literal']);
    });

    it.each([
      'new Image()',
      'const I=Image;new I',
      'new Audio(u)',
      'location="/?x="+d',
      'location.href=u',
      'window.location.search=q',
      'location.assign(u)',
      'location.replace(u)',
      'window.open(u)',
      'open(u)',
      'e.src=u',
      'e.srcset=u',
      'a.href=u',
      'f.action=u',
      'b.formAction=u',
      'v.poster=u',
      'a.ping=u',
      'u.search=q',
      'e["src"]=u',
      'e[`href`]=u',
      'h(`img`,{src:u})',
      'h(`img`,{"srcset":u})',
      'h(`a`,{ping:u})',
      'x=`?g=${location.hash}`',
      'go("?grades="+d)',
      'go(`./index.html?d=`+d)',
      'return"/x?y="+d',
    ])('rejects %s', (js) => {
      expect(new Set(rules(withJs(js)))).toEqual(new Set(['assets/index-abc123.js request']));
    });

    it.each([
      // Real shapes from the minified bundle: ternaries after template literals, reads of location.
      'for(o in n)o==`key`?i=n[o]:o==`ref`?a=n[o]:s[o]=n[o]',
      'let t=location.hash;t!==h&&history.replaceState(history.state,``,t)',
      'location.hash==t',
      'n.data=x',
      'e.srcElement',
      'x.hrefLang',
      'u.searchParams',
      'new URLSearchParams(e.slice(1))',
      '"Images open up as you go"',
      'isOpen(x)',
      'reopen(x)',
      'c?"#s=":d',
    ])('does not flag %s', (js) => {
      expect(rules(withJs(`${js};`))).toEqual([]);
    });
  });

  describe('links in element props (href)', () => {
    /** The messages of the href rule for a script made of BASE_JS and `js`. @param {string} js */
    const hrefFindings = (js) =>
      auditDist(tree({ 'assets/index-abc123.js': `${BASE_JS}${js};` }))
        .violations.filter((v) => v.rule === 'request')
        .map((v) => v.message.split(' at ')[0]);
    const REFUSED = 'link in element props (href) that is not the link to the other view';

    it('refuses the reproducer: a link that sends the hash to the host as a query string', () => {
      const js = 'h("a",{href:"./?"+new URLSearchParams({g:location.hash})})';
      expect(rules(withJs(js))).toEqual(['assets/index-abc123.js request']);
      expect(hrefFindings(js)).toEqual([REFUSED]);
    });

    it.each([
      ['an address on another host', 'h("a",{href:"https://example.com/x"})'],
      ['a query string after the page', 'h(`a`,{href:`deuren.html?${x}`})'],
      ['no literal page', 'h(`a`,{href:`${a}${b}`})'],
      ['a quoted key', 'h("a",{"href":x})'],
      ['a quoted key with the allowed value', 'h(`a`,{"href":`deuren.html#${t}`})'],
      ['a plain name', 'h(`a`,{href:u})'],
      ['the shorthand', 'let href="./?"+new URLSearchParams({g:location.hash});h("a",{href})'],
      ['the shorthand among other props', 'h(`a`,{class:`x`, href ,children:n})'],
      ['a computed literal key', 'h(`a`,{["href"]:u})'],
      ['a getter', 'h(`a`,{get href(){return u}})'],
      ['setAttribute', 'a.setAttribute("href",u)'],
      [
        'setAttribute as an optional call',
        'const a=document.querySelector(".other-view"),u=new URL(location.href);u.searchParams.set("g",location.hash);a.setAttribute?.("href",u);a.click()',
      ],
      ['setAttributeNS', 'a.setAttributeNS(null,"href",u)'],
      ['the page without a literal #', 'h(`a`,{href:`deuren.html${t}`})'],
      ['the page and # as a string', 'h(`a`,{href:"./#"+t})'],
      ['the hash first, then the page', 'h(`a`,{href:`${t}deuren.html#`})'],
      ['another page', 'h(`a`,{href:`../#${t}`})'],
      ['a page with a prefix', 'h(`a`,{href:`/deuren.html#${t}`})'],
      ['a space after the key', 'h(`a`,{href: `./#${t}`})'],
      ['a call in the expression', 'h(`a`,{href:`./#${t()}`})'],
      ['two expressions', 'h(`a`,{href:`deuren.html#${t}${u}`})'],
      ['text after the expression', 'h(`a`,{href:`deuren.html#${t}x`})'],
      ['a concatenation after the template', 'h(`a`,{href:`deuren.html#${t}`+q})'],
      ['a method call on the template', 'h(`a`,{href:`./#${t}`.concat(q)})'],
      ['a ternary after the template', 'h(`a`,{href:`./#${t}`?a:b})'],
    ])('refuses %s: %s', (_what, js) => {
      expect(hrefFindings(js)).toEqual([REFUSED]);
    });

    it.each([
      ['an identifier', 'h(`a`,{href:`deuren.html#${t}`,children:n})'],
      ['a member expression', 'h(`a`,{class:`x`,href:`./#${Sn.value}`})'],
    ])('allows the link to the other view with %s: %s', (_what, js) => {
      expect(hrefFindings(js)).toEqual([]);
    });

    it('passes the clean tree, whose script holds both links to the other view', () => {
      expect(hrefProps(CLEAN_JS)).toEqual({ viewLinks: [CLEAN_JS.indexOf('href:`deuren'), CLEAN_JS.indexOf('href:`./')], others: [] });
      expect(rules(tree())).toEqual([]);
    });

    it(`allows at most ${VIEW_LINK_HREFS_MAX} links to the other view in all the scripts together`, () => {
      const third = 'h(`a`,{href:`./#${t}`})';
      expect(rules(withJs(third))).toEqual(['assets/index-abc123.js request']);
      expect(auditDist(withJs(third)).violations[0]?.message).toContain(`link to the other view beyond the ${VIEW_LINK_HREFS_MAX} the pages render`);
      const other = tree({ 'assets/index-other.js': `${third};`, 'index.html': html({ head: '<script type="module" src="./assets/index-other.js"></script>' }) });
      expect(rules(other)).toEqual(['assets/index-other.js request']);
    });

    it('does not take a read of an href property or a string `href` for a prop', () => {
      expect(rules(withJs('t!=`href`&&t in e;let u=a.href;x.hrefLang;y["href"]'))).toEqual([]);
    });
  });

  describe('Content-Security-Policy', () => {
    it('accepts the policy of the real build', () => {
      expect(checkCsp(CSP)).toEqual([]);
    });

    it.each([
      // connect-src 'none' alone: images, media, frames and scripts from any host.
      "connect-src 'none'; base-uri 'none'; form-action 'none'",
      "default-src *; base-uri 'none'; form-action 'none'",
      "default-src 'self'; base-uri 'none'; form-action 'none'",
      "default-src 'self' 'none'; base-uri 'none'; form-action 'none'",
      "default-src; base-uri 'none'; form-action 'none'",
    ])("rejects a policy whose default-src is not exactly 'none': %s", (csp) => {
      expect(checkCsp(csp).filter((p) => p.startsWith('default-src'))).toHaveLength(1);
    });

    it.each(['base-uri', 'form-action'])('requires %s, which default-src does not cover', (name) => {
      const csp = CSP.split('; ')
        .filter((d) => !d.startsWith(name))
        .join('; ');
      expect(checkCsp(csp)).toEqual([`${name} is missing: default-src does not cover it`]);
    });

    it.each([
      'connect-src',
      'img-src',
      'media-src',
      'font-src',
      'frame-src',
      'child-src',
      'object-src',
      'worker-src',
      'manifest-src',
      'base-uri',
      'form-action',
    ])("rejects 'self' in %s: the page loads only its own script and stylesheet", (name) => {
      const csp = [...CSP.split('; ').filter((d) => !d.startsWith(`${name} `)), `${name} 'self'`].join('; ');
      expect(checkCsp(csp)).toHaveLength(1);
      expect(checkCsp(csp)[0]).toContain(`${name} allows 'self'`);
    });

    it.each([
      "script-src 'self' cdn.example.com",
      'img-src *',
      'img-src data: https:',
      "script-src 'self' 'unsafe-eval'",
      'style-src data:',
      'report-uri /csp-report',
      "img-src 'none' data:",
    ])('rejects a remote, unsafe or contradictory source: %s', (directive) => {
      const name = directive.split(' ')[0] ?? '';
      const csp = [...CSP.split('; ').filter((d) => !d.startsWith(`${name} `)), directive].join('; ');
      expect(checkCsp(csp).length).toBeGreaterThan(0);
    });
  });

  describe('index.html', () => {
    it('requires the CSP meta', () => {
      expect(rules(tree({ 'index.html': html({ csp: '' }) }))).toEqual(['index.html csp']);
    });

    it("rejects a meta with connect-src 'none' alone", () => {
      const found = rules(tree({ 'index.html': html({ csp: "connect-src 'none'" }) }));
      expect(new Set(found)).toEqual(new Set(['index.html csp']));
    });

    it('rejects a local URL with a query string', () => {
      const head = '<link rel="prefetch" href="./index.html?grades=666">';
      expect(rules(tree({ 'index.html': html({ head }) }))).toEqual(['index.html html']);
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

  describe('deuren.html (the second page)', () => {
    /** The clean tree with `page` as deuren.html, which its script links to. @param {string} page */
    const withDoors = (page) => tree({ 'deuren.html': page });

    it('is shipped when the script links to it, with the same checks as index.html', () => {
      expect(rules(withDoors(html()))).toEqual([]);
    });

    it('requires its own CSP meta', () => {
      expect(rules(withDoors(html({ csp: '' })))).toEqual(['deuren.html csp']);
    });

    it('rejects an inline script and a remote stylesheet', () => {
      const head = '<script>go()</script><link rel="stylesheet" href="https://cdn.example.com/x.css">';
      expect(rules(withDoors(html({ head }))).sort()).toEqual(['deuren.html html', 'deuren.html html', 'deuren.html url'].sort());
    });

    it('is refused when nothing links to it', () => {
      expect(rules(tree({ 'assets/index-abc123.js': BASE_JS }))).toEqual(['deuren.html unreferenced']);
    });

    it('refuses any other page', () => {
      expect(rules(tree({ 'other.html': html() }))).toContain('other.html path');
    });
  });

  it('lists every violation, not only the first', () => {
    const dir = tree({ '.DS_Store': 'x', 'assets/index-abc123.js': `${CLEAN_JS}fetch("https://api.example.com/");` });
    const report = auditDist(dir);
    expect(report.violations.map((v) => v.rule).sort()).toEqual(['path', 'runtime', 'unreferenced', 'url']);
    const text = formatReport(report);
    for (const v of report.violations) expect(text).toContain(v.message);
  });

  describe('licence notice', () => {
    /** The project's own licence: the MIT text with one copyright line. */
    const MIT = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
    /** @param {string} holder */
    const mit = (holder) => MIT.replace(/^Copyright .*$/m, `Copyright (c) 2020-present ${holder}`);
    /** @param {string} name @param {string} version @param {string} file */
    const entry = (name, version, file) => ({ name, version, license: 'MIT', ...splitLicence(file) });
    const RUNTIME = [
      { name: 'alpha', version: '1.0.0', license: 'MIT' },
      { name: '@scope/beta', version: '2.0.0', license: 'MIT' },
    ];
    const NOTICE = formatNotice([entry('alpha', '1.0.0', mit('Ann')), entry('@scope/beta', '2.0.0', mit('Bob'))]);
    /** @param {string} notice @param {typeof RUNTIME} [runtime] */
    const problems = (notice, runtime = RUNTIME) => noticeProblems([`${notice}\n${CLEAN_JS}`], runtime);

    it('lists each package with its copyright lines, then each distinct licence text once', () => {
      expect(NOTICE.startsWith(`${NOTICE_HEAD}\n`)).toBe(true);
      expect(NOTICE).toContain('\n * @scope/beta 2.0.0, licence MIT\n * Copyright (c) 2020-present Bob\n');
      expect(NOTICE).toContain('\n * alpha 1.0.0, licence MIT\n * Copyright (c) 2020-present Ann\n');
      expect(NOTICE).toContain('\n * Licence text of @scope/beta, alpha:\n *\n * MIT License\n *\n * Permission is hereby granted');
      expect(NOTICE.split('Permission is hereby granted')).toHaveLength(2);
      expect(NOTICE.endsWith('\n * SOFTWARE.\n */')).toBe(true);
      expect(problems(NOTICE)).toEqual([]);
    });

    it('writes different licence texts separately', () => {
      const isc = 'ISC License\n\nCopyright (c) 2019 Cy\n\nPermission to use, copy, modify, and/or distribute this software is granted.\n';
      const notice = formatNotice([entry('alpha', '1.0.0', mit('Ann')), { ...entry('gamma', '3.0.0', isc), license: 'ISC' }]);
      expect(notice).toContain(' * Licence text of alpha:\n');
      expect(notice).toContain(' * Licence text of gamma:\n *\n * ISC License\n *\n * Permission to use');
      const runtime = [
        { name: 'alpha', version: '1.0.0', license: 'MIT' },
        { name: 'gamma', version: '3.0.0', license: 'ISC' },
      ];
      expect(problems(notice, runtime)).toEqual([]);
    });

    it('takes copyright lines only, not wrapped lines of the text that start with the word', () => {
      const file = [
        'MIT License',
        '',
        'Copyright (c) 2015 A',
        '(c) 2016 B',
        '© 2017 C',
        'Copyright 2018 D',
        '',
        'IN NO EVENT SHALL THE AUTHORS OR',
        'COPYRIGHT HOLDERS BE LIABLE',
        'copyright holder nor the names',
        '   Copyright [yyyy] [name of copyright owner]',
        '',
      ].join('\r\n');
      expect(splitLicence(file)).toEqual({
        copyright: ['Copyright (c) 2015 A', '(c) 2016 B', '© 2017 C', 'Copyright 2018 D'],
        text: [
          'MIT License',
          '',
          'IN NO EVENT SHALL THE AUTHORS OR',
          'COPYRIGHT HOLDERS BE LIABLE',
          'copyright holder nor the names',
          '   Copyright [yyyy] [name of copyright owner]',
        ].join('\n'),
      });
    });

    it('refuses to write a notice without a copyright line or text, or one that a licence file would end early', () => {
      expect(() => formatNotice([entry('alpha', '1.0.0', 'MIT License\n\nPermission is granted.')])).toThrow(/alpha has no copyright line/);
      expect(() => formatNotice([entry('alpha', '1.0.0', 'Copyright (c) 2020 Ann\n')])).toThrow(/alpha has no licence text/);
      expect(() => formatNotice([entry('alpha', '1.0.0', `${mit('Ann')}\n*/ alert(1) /*`)])).toThrow(/end the comment early/);
      expect(formatNotice([])).toBe('');
    });

    it('passes every content rule of the audit, and counts towards the budget', () => {
      const dir = tree({ 'assets/index-abc123.js': `${NOTICE}\n${CLEAN_JS}` });
      const report = auditDist(dir, RUNTIME);
      expect(report.violations).toEqual([]);
      expect(report.totals.js).toBe(NOTICE.length + 1 + CLEAN_JS.length);
      expect(formatReport(report)).toContain('Licence notices required (runtime packages of the lockfile): alpha 1.0.0, @scope/beta 2.0.0');
    });

    it.each([
      [
        'a runtime package that the notice does not name',
        NOTICE,
        [...RUNTIME, { name: 'fake', version: '0.0.1', license: 'MIT' }],
        ['no licence notice for the runtime package fake 0.0.1'],
      ],
      [
        'a notice with one package left out',
        formatNotice([entry('alpha', '1.0.0', mit('Ann'))]),
        RUNTIME,
        ['no licence notice for the runtime package @scope/beta 2.0.0'],
      ],
      [
        'a notice for another version',
        NOTICE.replace(' alpha 1.0.0,', ' alpha 0.9.0,'),
        RUNTIME,
        [
          'no licence notice for the runtime package alpha 1.0.0',
          'the notice names alpha 0.9.0, which is not a runtime package of the lockfile at that version',
        ],
      ],
      [
        'a notice with another licence',
        NOTICE.replace(' alpha 1.0.0, licence MIT', ' alpha 1.0.0, licence ISC'),
        RUNTIME,
        ['the notice gives alpha 1.0.0 the licence ISC, the lockfile MIT'],
      ],
      [
        'a package without its copyright line',
        NOTICE.replace(' * Copyright (c) 2020-present Ann\n', ''),
        RUNTIME,
        ['the notice for alpha 1.0.0 has no copyright line'],
      ],
      [
        'a licence text that does not name the package',
        NOTICE.replace('Licence text of @scope/beta, alpha:', 'Licence text of alpha:'),
        RUNTIME,
        ['the notice has no licence text for @scope/beta 2.0.0'],
      ],
      [
        'an MIT text without the sentence that asks for the notice',
        NOTICE.replace('this permission notice shall be included', 'this permission notice may be included'),
        RUNTIME,
        [
          `the licence text for alpha 1.0.0 lacks the sentence of the MIT licence: ${MIT_NOTICE_SENTENCE}`,
          `the licence text for @scope/beta 2.0.0 lacks the sentence of the MIT licence: ${MIT_NOTICE_SENTENCE}`,
        ],
      ],
      [
        'a notice for a package that is not a runtime package',
        formatNotice([entry('alpha', '1.0.0', mit('Ann')), entry('@scope/beta', '2.0.0', mit('Bob')), entry('dev-tool', '5.0.0', mit('Dee'))]),
        RUNTIME,
        ['the notice names dev-tool 5.0.0, which is not a runtime package of the lockfile at that version'],
      ],
    ])('rejects %s', (_what, notice, runtime, expected) => {
      expect(problems(notice, runtime)).toEqual(expected);
    });

    it('requires a notice in the built site when the lockfile has runtime packages, and only then', () => {
      expect(noticeProblems([CLEAN_JS], RUNTIME)).toEqual(['no licence notice in any script; needed for alpha 1.0.0, @scope/beta 2.0.0']);
      expect(noticeProblems([CLEAN_JS], [])).toEqual([]);
      expect(rules(tree())).toEqual([]);
      const report = auditDist(tree(), RUNTIME);
      expect(report.violations.map((v) => `${v.file} ${v.rule}`)).toEqual(['(dist) notice']);
    });
  });

  describe('the real build', async () => {
    const { build } = await import('vite');
    // Vitest sets NODE_ENV to `test`, and Vite then compiles the JSX for development, with
    // source paths in it. `npm run build` runs with NODE_ENV unset, which Vite takes as
    // production: build that, so these tests see what is shipped.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let result;
    try {
      result = await build({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'silent', build: { write: false } });
    } finally {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
    }
    /** @type {{ type: string, fileName: string, code?: string, source?: string | Uint8Array, isEntry?: boolean, moduleIds?: string[] }[]} */
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((o) => ('output' in o ? o.output : []));
    const chunks = outputs.filter((o) => o.type === 'chunk');
    const runtime = runtimePackages(JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')));
    /** @param {{ moduleIds?: string[] }} c */
    const hasPackageCode = (c) => (c.moduleIds ?? []).some((id) => id.replaceAll('\\', '/').includes('/node_modules/'));

    it('opens the script that bundles package code with the notice of every runtime package of the lockfile', () => {
      expect(runtime.map((p) => p.name)).toContain('preact');
      // Two pages share one chunk with the package code; it carries the notice, the page scripts do not.
      expect(chunks.filter((c) => c.isEntry).length).toBe(2);
      expect(chunks.filter(hasPackageCode).map((c) => c.code?.startsWith(`${NOTICE_HEAD}\n`))).toEqual([true]);
      expect(chunks.filter((c) => !hasPackageCode(c)).map((c) => c.code?.includes(NOTICE_HEAD))).toEqual([false, false]);
      expect(noticeProblems(chunks.map((c) => c.code ?? ''), runtime)).toEqual([]);
    });

    it(`holds ${VIEW_LINK_HREFS_MAX} href props, the links to the other view in the allowed shape, and no other`, () => {
      const found = chunks.map((c) => ({ code: c.code ?? '', ...hrefProps(c.code ?? '') }));
      expect(found.flatMap((f) => f.others)).toEqual([]);
      const pages = found.flatMap((f) => f.viewLinks.map((at) => /^href:`([^#`]*)#/.exec(f.code.slice(at))?.[1]));
      expect(pages.sort()).toEqual(['./', 'deuren.html']);
      expect(pages).toHaveLength(VIEW_LINK_HREFS_MAX);
    });

    it('passes the whole audit, with both pages', () => {
      const dir = mkdtempSync(join(tmpdir(), 'check-dist-real-'));
      made.push(dir);
      for (const o of outputs) {
        mkdirSync(dirname(join(dir, o.fileName)), { recursive: true });
        writeFileSync(join(dir, o.fileName), o.type === 'chunk' ? (o.code ?? '') : (o.source ?? ''));
      }
      const report = auditDist(dir, runtime);
      expect(report.violations).toEqual([]);
      expect(report.sizes.map((s) => s.path).filter((p) => p.endsWith('.html'))).toEqual(['deuren.html', 'index.html']);
    });
  });

  describe('command line', () => {
    const NO_RUNTIME = { lockfileVersion: 3, packages: { '': { name: 'x', version: '0.0.0' } } };
    /** @param {string} content */
    const lockfile = (content) => {
      const dir = mkdtempSync(join(tmpdir(), 'check-dist-lock-'));
      made.push(dir);
      writeFileSync(join(dir, 'package-lock.json'), content);
      return join(dir, 'package-lock.json');
    };
    /** @param {string} dir @param {string} [lock] */
    const run = (dir, lock = lockfile(JSON.stringify(NO_RUNTIME))) =>
      spawnSync(process.execPath, [SCRIPT, dir, lock], { encoding: 'utf8' });

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

    it('exits 1 when a runtime package of the lockfile has no licence notice', () => {
      const lock = { ...NO_RUNTIME, packages: { ...NO_RUNTIME.packages, 'node_modules/a': { version: '1.0.0', license: 'MIT' } } };
      const r = run(tree(), lockfile(JSON.stringify(lock)));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('(dist): [notice] no licence notice in any script; needed for a 1.0.0');
    });

    it('exits 1 when a page is missing', () => {
      const r = run(tree({ 'deuren.html': null }));
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('deuren.html: [path] missing');
    });

    it('exits 2 when the directory is missing', () => {
      const r = run(join(tmpdir(), 'check-dist-does-not-exist-'));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('could not run');
    });

    it.each([
      ['missing', join(tmpdir(), 'check-dist-no-lockfile-', 'package-lock.json')],
      ['not JSON', '{'],
      ['an old format', JSON.stringify({ lockfileVersion: 1 })],
    ])('exits 2 when the lockfile is %s', (what, content) => {
      const r = run(tree(), what === 'missing' ? content : lockfile(content));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('check:dist: the audit could not run: cannot read the lockfile');
    });
  });
});
