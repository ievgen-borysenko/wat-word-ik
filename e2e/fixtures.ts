import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Locator, type Page } from '@playwright/test';

/** The built site under test; `vite preview` serves this folder. */
const DIST = resolve(import.meta.dirname, '..', 'dist');

/**
 * Same-origin paths the page may load: the page itself and the files in
 * dist/assets/ (read from the folder, not trusted from the server: `vite
 * preview` answers any unknown path with index.html and status 200).
 */
function allowedPaths(): Map<string, RegExp> {
  const paths = new Map<string, RegExp>([
    ['/', /^text\/html\b/],
    ['/index.html', /^text\/html\b/],
  ]);
  for (const name of readdirSync(resolve(DIST, 'assets'))) {
    if (name.endsWith('.js')) paths.set(`/assets/${name}`, /^(?:text|application)\/javascript\b/);
    else if (name.endsWith('.css')) paths.set(`/assets/${name}`, /^text\/css\b/);
  }
  return paths;
}

/**
 * Every test runs under a guard that records, for the whole test:
 *   - every request of the browser context: only GET, only to the page's own
 *     origin, and only for the page or one of its built assets (data: URLs are
 *     allowed, they never leave the browser);
 *   - every response to such a request: status 200 and the content type that
 *     matches the file, so a missing file answered with index.html is caught;
 *   - every WebSocket: none at all;
 *   - console errors and uncaught page errors: none;
 *   - Content-Security-Policy violation events: none.
 * The checks run after the test body, so a test only has to use the page.
 */
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page, baseURL }, use) => {
      if (!baseURL) throw new Error('baseURL is not set in playwright.config.ts');
      const origin = new URL(baseURL).origin;
      const paths = allowedPaths();
      const bad: string[] = [];
      const errors: string[] = [];
      const csp: string[] = [];

      page.context().on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:')) return;
        const u = new URL(url);
        if (req.method() !== 'GET') bad.push(`${req.method()} ${url}: only GET is expected`);
        if (u.origin !== origin) bad.push(`${req.method()} ${url}: leaves the page origin`);
        else if (!paths.has(u.pathname)) bad.push(`${req.method()} ${url}: not the page or one of its assets`);
      });
      page.context().on('response', (res) => {
        const u = new URL(res.url());
        const type = paths.get(u.pathname);
        if (u.origin !== origin || !type) return;
        const contentType = res.headers()['content-type'] ?? '';
        if (res.status() !== 200 && res.status() !== 304) bad.push(`${u.pathname}: status ${res.status()}`);
        else if (res.status() === 200 && !type.test(contentType)) bad.push(`${u.pathname}: content type ${contentType}`);
      });
      page.on('websocket', (ws) => bad.push(`WebSocket ${ws.url()}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`page error: ${err.message}`));

      await page.exposeFunction('__reportCspViolation', (text: string) => {
        csp.push(text);
      });
      await page.addInitScript(() => {
        const report = (window as unknown as { __reportCspViolation: (text: string) => void }).__reportCspViolation;
        document.addEventListener(
          'securitypolicyviolation',
          (e) => report(`${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'} in ${e.sourceFile}:${e.lineNumber}`),
          true,
        );
      });

      await use();

      expect(bad, 'requests that are not GETs of the page and its assets').toEqual([]);
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
