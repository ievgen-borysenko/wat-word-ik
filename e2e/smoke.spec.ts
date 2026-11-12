import {
  TOTAL_TILES,
  applyPreset,
  expect,
  fromLinkNotice,
  hash,
  openApp,
  openTiles,
  preset,
  sliders,
  test,
} from './fixtures';

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

  await expect.poll(() => hash(page)).toMatch(/^#s=a616666666&g=[a-z-]+&l=ua$/);
  const before = await hash(page);
  const banner = await page.locator('.goal-banner').textContent();

  await page.reload();
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
  expect(await hash(page)).toBe(before);
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

test('a link opened without a language choice never gets l= written', async ({ page }) => {
  await openApp(page, '#s=5555555555');
  await sliders(page).first().focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => hash(page)).toBe('#s=6555555555');

  await applyPreset(page, 9);
  await page.locator('.tile').nth(20).click();
  await page.getByRole('dialog').locator('.goal-btn').click();
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toMatch(/^#s=9{10}&g=[a-z-]+$/);

  // Positive control: an explicit choice is written.
  await page.getByRole('button', { name: 'NL', exact: true }).click();
  await expect.poll(() => hash(page)).toMatch(/^#s=9{10}&g=[a-z-]+&l=nl$/);
});

test.describe('the "grades came from a link" notice', () => {
  test('appears for a fresh link with sliders and goes away after a slider move', async ({ page }) => {
    await openApp(page, '#s=8876677665&g=arts');
    await expect(fromLinkNotice(page)).toHaveCount(1);
    await sliders(page).nth(3).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.from-link')).toHaveCount(0);
  });

  test('does not appear after a reload', async ({ page }) => {
    await openApp(page, '#s=8876677665');
    await expect(fromLinkNotice(page)).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
    await expect(page.locator('.from-link')).toHaveCount(0);
  });

  test('does not appear without sliders in the link', async ({ page }) => {
    await openApp(page, '#g=kapper&l=en');
    await expect(page.locator('.tile.is-goal')).toHaveCount(1);
    await expect(page.locator('.from-link')).toHaveCount(0);
  });

  test('dismissing it moves focus to the first preset button', async ({ page }) => {
    await openApp(page, '#s=8876677665');
    await fromLinkNotice(page).locator('.from-link-close').click();
    await expect(page.locator('.from-link')).toHaveCount(0);
    await expect(preset(page, 3)).toBeFocused();
  });
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

for (const [where, selector] of [
  ['the header', '.help-btn'],
  ['the footer', '.link-btn'],
] as const) {
  test(`"How it works" opens from ${where}, has a heading and closes with Escape`, async ({ page }) => {
    await openApp(page);
    const opener = page.locator(selector);
    await opener.click();
    const dialog = page.locator('.about-dialog');
    await expect(dialog).toBeVisible();
    const heading = dialog.getByRole('heading', { level: 2 });
    await expect(heading).toHaveText(/\S/);
    await expect(dialog).toHaveAccessibleName((await heading.textContent()) ?? '');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}

// Safari does not focus a button that is clicked or tapped: when the dialog opens, the
// focused element is still <body>. Chromium does the same when mousedown is cancelled, so
// a real click here runs the whole pointer and mouse sequence and only leaves focus where it was.
for (const [what, hash, selector] of [
  ['a tile', '', '.tile >> nth=0'],
  ['the goal', '#g=kapper&l=en', '.goal-banner-text:visible, .summary-goal:visible'],
  ['"How it works" in the header', '', '.help-btn'],
  ['"How it works" in the footer', '', '.link-btn'],
] as const) {
  test(`focus goes back to ${what} also when the click did not focus it`, async ({ page }) => {
    await openApp(page, hash);
    await page.evaluate(() => {
      const w = window as unknown as { bodyFocusedAtClick?: boolean };
      document.addEventListener('mousedown', (ev) => ev.preventDefault(), true);
      document.addEventListener('click', () => (w.bodyFocusedAtClick ??= document.activeElement === document.body), true);
    });
    const opener = page.locator(selector);
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The stand-in holds: nothing had focus when the dialog opened.
    expect(await page.evaluate(() => (window as unknown as { bodyFocusedAtClick?: boolean }).bodyFocusedAtClick)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
}
