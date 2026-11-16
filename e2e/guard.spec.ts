import { test } from '@playwright/test';
import { TOTAL_TILES, attachGuard, expect, requestProblem, sitePolicy } from './fixtures';

// The guard in fixtures.ts is only worth something if it notices a page that
// misbehaves. These tests use Playwright's plain `test`, without the automatic
// guard (which would fail them), make the page misbehave, and check what the
// guard reports.

/** Sends the grades to the page's own host in an image request: the host's logs would keep them. */
const SEND_GRADES = 'new Image().src = "/index.html?grades=" + encodeURIComponent(location.hash)';

function policyFor(baseURL: string | undefined) {
  if (!baseURL) throw new Error('baseURL is not set in playwright.config.ts');
  return sitePolicy(new URL(baseURL).origin);
}

test('the guard refuses every request outside the expected set', ({ baseURL }) => {
  const policy = policyFor(baseURL);
  const script = [...policy.paths].find(([, p]) => p.resource === 'script')?.[0] ?? '';
  const check = (path: string, resourceType = 'document', method = 'GET') =>
    requestProblem({ url: `${policy.origin}${path}`, method, resourceType }, policy);

  expect(check('/')).toBeNull();
  expect(check('/index.html')).toBeNull();
  expect(check('/deuren.html')).toBeNull();
  expect(check('/onderbouw.html')).toBeNull();
  expect(check('/onderbouw.html?n=vwo')).toMatch(/carries a query string$/);
  expect(check('/bovenbouw.html')).toBeNull();
  expect(check('/bovenbouw.html?x=na')).toMatch(/carries a query string$/);
  expect(check(script, 'script')).toBeNull();
  expect(requestProblem({ url: 'data:image/svg+xml,x', method: 'GET', resourceType: 'image' }, policy)).toBeNull();

  expect(check('/index.html?grades=666', 'image')).toMatch(/carries a query string$/);
  expect(check('/?x=1')).toMatch(/carries a query string$/);
  expect(check('/?')).toMatch(/carries a query string$/);
  expect(check(`${script}?v=1`, 'script')).toMatch(/carries a query string$/);
  expect(check('/index.html', 'image')).toMatch(/expected as document$/);
  expect(check(script, 'fetch')).toMatch(/expected as script$/);
  expect(check('/notes.html')).toMatch(/not the page or one of its assets$/);
  expect(check('/', 'document', 'POST')).toMatch(/only GET is expected$/);
  expect(requestProblem({ url: 'https://example.com/a.png', method: 'GET', resourceType: 'image' }, policy)).toMatch(
    /leaves the page origin$/,
  );
});

test('the guard reports an image request with data in its query string', async ({ browser, baseURL }) => {
  // Without the page's CSP, so that the request reaches the network and the request check.
  const policy = policyFor(baseURL);
  const context = await browser.newContext({ baseURL: policy.origin, bypassCSP: true });
  const page = await context.newPage();
  const findings = await attachGuard(page, policy);
  await page.goto('/#s=8876677665&l=en');
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
  const sent = page.waitForRequest((r) => r.url().includes('grades='));
  await page.evaluate(SEND_GRADES);
  await sent;
  expect(findings().requests).toEqual([expect.stringMatching(/^GET image \S+\/index\.html\?grades=\S+: carries a query string$/)]);
  await context.close();
});

test("with the page's CSP the browser blocks that image, and the guard reports it twice", async ({ page, baseURL }) => {
  const findings = await attachGuard(page, policyFor(baseURL));
  await page.goto('/#s=8876677665&l=en');
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
  const failed = page.waitForEvent('requestfailed', (r) => r.url().includes('grades='));
  await page.evaluate(SEND_GRADES);
  // The browser refuses the load before it reaches the network ...
  expect((await failed).failure()?.errorText).toBe('csp');
  // ... and the guard reports both the violation and the attempted request.
  await expect.poll(() => findings().csp).toEqual([expect.stringMatching(/^img-src blocked \S+\/index\.html/)]);
  expect(findings().requests).toEqual([expect.stringMatching(/^GET image \S+\/index\.html\?grades=\S+: carries a query string$/)]);
});

test('the guard reports a navigation with a query string', async ({ page, baseURL }) => {
  const findings = await attachGuard(page, policyFor(baseURL));
  await page.goto('/?x=1');
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
  expect(findings().requests).toEqual([expect.stringMatching(/^GET document \S+\/\?x=1: carries a query string$/)]);
});

test("the guard reports the page's own file requested as an image", async ({ browser, baseURL }) => {
  const policy = policyFor(baseURL);
  const context = await browser.newContext({ baseURL: policy.origin, bypassCSP: true });
  const page = await context.newPage();
  const findings = await attachGuard(page, policy);
  await page.goto('/');
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
  const sent = page.waitForRequest((r) => r.resourceType() === 'image');
  await page.evaluate('new Image().src = "/index.html"');
  await sent;
  expect(findings().requests).toEqual([expect.stringMatching(/^GET image \S+\/index\.html: expected as document$/)]);
  await context.close();
});
