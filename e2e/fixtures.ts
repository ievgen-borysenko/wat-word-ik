import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Locator, type Page } from '@playwright/test';

/** The built site under test; `vite preview` serves this folder. */
const DIST = resolve(import.meta.dirname, '..', 'dist');

/** What the page may request: its origin and, per path, the expected kind and content type. */
export interface SitePolicy {
  origin: string;
  paths: Map<string, { resource: 'document' | 'script' | 'stylesheet'; type: RegExp }>;
}

/**
 * The page may load itself and the files in dist/assets/, nothing else (read from
 * the folder, not trusted from the server: `vite preview` answers any unknown
 * path with index.html and status 200).
 */
export function sitePolicy(origin: string, dist = DIST): SitePolicy {
  const paths: SitePolicy['paths'] = new Map([
    ['/', { resource: 'document', type: /^text\/html\b/ }],
    ['/index.html', { resource: 'document', type: /^text\/html\b/ }],
  ]);
  for (const name of readdirSync(resolve(dist, 'assets'))) {
    if (name.endsWith('.js')) paths.set(`/assets/${name}`, { resource: 'script', type: /^(?:text|application)\/javascript\b/ });
    else if (name.endsWith('.css')) paths.set(`/assets/${name}`, { resource: 'stylesheet', type: /^text\/css\b/ });
  }
  return { origin, paths };
}

/**
 * Why a request is not one the page may make, or null when it is: a GET to the
 * page's origin, without a query string or fragment (data in a URL ends up in
 * the host's logs), for the page or one of its built assets, of the matching
 * kind (the page loaded as a document, a script as a script, a stylesheet as a
 * stylesheet; the page's own file fetched as an image is refused). data: URLs
 * never leave the browser and pass.
 */
export function requestProblem(
  req: { url: string; method: string; resourceType: string },
  policy: SitePolicy,
): string | null {
  if (req.url.startsWith('data:')) return null;
  const what = `${req.method} ${req.resourceType} ${req.url}`;
  const u = new URL(req.url);
  if (req.method !== 'GET') return `${what}: only GET is expected`;
  if (u.origin !== policy.origin) return `${what}: leaves the page origin`;
  if (req.url.includes('?')) return `${what}: carries a query string`;
  if (u.hash !== '') return `${what}: carries a fragment`;
  const expected = policy.paths.get(u.pathname);
  if (!expected) return `${what}: not the page or one of its assets`;
  if (req.resourceType !== expected.resource) return `${what}: expected as ${expected.resource}`;
  return null;
}

export interface GuardFindings {
  requests: string[];
  errors: string[];
  csp: string[];
}

/**
 * Records, from now on, everything on `page` (and its context) that the page
 * must not do:
 *   - every request that requestProblem() refuses;
 *   - every response to an allowed request: status 200 (or 304) and the content
 *     type that matches the file, so a missing file answered with index.html is
 *     caught;
 *   - every WebSocket: none at all;
 *   - console errors and uncaught page errors;
 *   - Content-Security-Policy violation events (a blocked load never becomes a
 *     request, so this is where a load the CSP stopped shows up).
 * Returns the findings so far; the caller decides what to expect of them.
 */
export async function attachGuard(page: Page, policy: SitePolicy): Promise<() => GuardFindings> {
  const found: GuardFindings = { requests: [], errors: [], csp: [] };
  page.context().on('request', (req) => {
    const problem = requestProblem({ url: req.url(), method: req.method(), resourceType: req.resourceType() }, policy);
    if (problem) found.requests.push(problem);
  });
  page.context().on('response', (res) => {
    const u = new URL(res.url());
    const expected = policy.paths.get(u.pathname);
    if (u.origin !== policy.origin || !expected) return;
    const contentType = res.headers()['content-type'] ?? '';
    if (res.status() !== 200 && res.status() !== 304) found.requests.push(`${u.pathname}: status ${res.status()}`);
    else if (res.status() === 200 && !expected.type.test(contentType)) {
      found.requests.push(`${u.pathname}: content type ${contentType}`);
    }
  });
  page.on('websocket', (ws) => found.requests.push(`WebSocket ${ws.url()}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') found.errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => found.errors.push(`page error: ${err.message}`));

  await page.exposeFunction('__reportCspViolation', (text: string) => {
    found.csp.push(text);
  });
  await page.addInitScript(() => {
    const report = (window as unknown as { __reportCspViolation: (text: string) => void }).__reportCspViolation;
    document.addEventListener(
      'securitypolicyviolation',
      (e) => report(`${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'} in ${e.sourceFile}:${e.lineNumber}`),
      true,
    );
  });
  return () => found;
}

/**
 * Every test runs under the guard (see attachGuard); its findings must be empty
 * when the test body is done, so a test only has to use the page. e2e/guard.spec.ts
 * checks that the guard reports a page that misbehaves.
 */
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page, baseURL }, use) => {
      if (!baseURL) throw new Error('baseURL is not set in playwright.config.ts');
      const findings = await attachGuard(page, sitePolicy(new URL(baseURL).origin));
      await use();
      const { requests, errors, csp } = findings();
      expect(requests, 'requests that are not plain GETs of the page and its assets').toEqual([]);
      expect(errors, 'console and page errors').toEqual([]);
      expect(csp, 'Content-Security-Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const TOTAL_TILES = 36;

/**
 * Opens the page (optionally with a hash such as `#s=6666666666&l=nl`) as a fresh
 * page load and waits for the building. Going from the page to the same page with
 * another hash would only fire `hashchange`, so it leaves the page first.
 */
export async function openApp(page: Page, hash = ''): Promise<void> {
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  await page.goto(`/${hash}`);
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
}

export const sliders = (page: Page): Locator => page.getByRole('slider');

/** Quick-start buttons in their fixed order: all 3, all 6, all 9. */
export const preset = (page: Page, grade: 3 | 6 | 9): Locator =>
  page.locator('.presets button').nth({ 3: 0, 6: 1, 9: 2 }[grade]);

export const openTiles = (page: Page): Locator => page.locator('.tile.is-open');

/** Clicks a preset and waits until every slider has arrived (the preset animates). */
export async function applyPreset(page: Page, grade: 3 | 6 | 9): Promise<void> {
  await preset(page, grade).click();
  const all = sliders(page);
  for (let i = 0; i < (await all.count()); i++) await expect(all.nth(i)).toHaveValue(String(grade));
}

/** Waits until running CSS animations and transitions (dialog fade-in, tile pop) have finished. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    // Two frames first, so an animation started by the last click exists before we wait for it.
    for (let i = 0; i < 2; i++) await new Promise((done) => requestAnimationFrame(done));
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

/** The goal display: the banner in the header (desktop) or the line under the counts (narrow screens). */
export const goalDisplay = (page: Page): Locator =>
  page.locator('.goal-banner, .summary-goal').filter({ visible: true });

/** The "grades came from a link" notice that CSS shows: in the summary (wide) or the panel (narrow). */
export const fromLinkNotice = (page: Page): Locator => page.locator('.from-link').filter({ visible: true });

/** The current URL hash, as the page wrote it. */
export const hash = (page: Page): Promise<string> => page.evaluate(() => location.hash);

/**
 * Serious and critical axe findings, one readable line each. Runs after the
 * animations settle: colour contrast measured mid-fade is not the real contrast.
 */
export async function seriousA11yIssues(page: Page): Promise<string[]> {
  await settle(page);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
