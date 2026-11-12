import { TOTAL_TILES, applyPreset, expect, openApp, openTiles, sliders, test } from './fixtures';

test('"all 3" opens exactly the five no-diploma jobs, "all 9" opens most', async ({ page }) => {
  await openApp(page);

  await applyPreset(page, 3);
  await expect(openTiles(page)).toHaveCount(5);
  await expect(page.locator('.floor-0 .tile.is-open')).toHaveCount(5);

  await applyPreset(page, 6);
  const atSix = await openTiles(page).count();

  await applyPreset(page, 9);
  await expect.poll(() => openTiles(page).count()).toBeGreaterThan(TOTAL_TILES / 2);
  expect(await openTiles(page).count()).toBeGreaterThanOrEqual(atSix);
});

test('the URL hash survives a reload', async ({ page }) => {
  await openApp(page);
  const all = sliders(page);
  await all.nth(0).focus();
  await page.keyboard.press('End');
  await all.nth(2).focus();
  await page.keyboard.press('Home');

  await page.locator('.tile').nth(20).click();
  await page.getByRole('dialog').locator('.goal-btn').click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'UA', exact: true }).click();

  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#s=a616666666&g=[a-z-]+&l=ua$/);
  const hash = await page.evaluate(() => location.hash);
  const banner = await page.locator('.goal-banner').textContent();

  await page.reload();
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await expect(all.nth(0)).toHaveValue('10');
  await expect(all.nth(1)).toHaveValue('6');
  await expect(all.nth(2)).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'UA', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await expect(page.locator('.goal-banner')).toHaveText(banner ?? '');
});

test('a shared link restores sliders, goal and language', async ({ page }) => {
  await openApp(page, '#s=9999999999&g=kapper&l=nl');
  await expect(sliders(page).nth(4)).toHaveValue('9');
  await expect(page.getByRole('button', { name: 'NL', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tile.is-goal')).toHaveCount(1);
});

test('a card opens from a tile and closes with Escape', async ({ page }) => {
  await openApp(page);
  const tile = page.locator('.tile').first();
  await tile.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 2 })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(tile).toBeFocused();
});

test('footer links lead to the published docs', async ({ page, request }) => {
  await openApp(page);
  const links = page.locator('footer a');
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    const href = await link.getAttribute('href');
    if (!href) throw new Error('footer link without href');
    const url = new URL(href, page.url());
    expect(url.origin).toBe(new URL(page.url()).origin);
    const res = await request.get(url.href);
    expect(res.status(), url.href).toBe(200);
  }
});
