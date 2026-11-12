import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Locator, type Page } from '@playwright/test';

/**
 * Every test runs under a guard that records, for the whole test:
 *   - every request of the browser context: all must go to the page's own origin
 *     (data: URLs are allowed, they never leave the browser);
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
      const foreign: string[] = [];
      const errors: string[] = [];
      const csp: string[] = [];

      page.context().on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:')) return;
        if (new URL(url).origin !== origin) foreign.push(`${req.method()} ${url}`);
      });
      page.on('websocket', (ws) => foreign.push(`WebSocket ${ws.url()}`));
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

      expect(foreign, 'requests that leave the page origin').toEqual([]);
      expect(errors, 'console and page errors').toEqual([]);
      expect(csp, 'Content-Security-Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const TOTAL_TILES = 36;

/** Opens the page (optionally with a hash such as `#s=6666666666&l=nl`) and waits for the building. */
export async function openApp(page: Page, hash = ''): Promise<void> {
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

/** Waits until running CSS animations and transitions (card fade-in, tile pop) have finished. */
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
