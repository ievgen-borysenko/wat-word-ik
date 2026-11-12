import { applyPreset, expect, goalDisplay, openApp, sliders, test } from './fixtures';

// The page promises: no cookies, no storage, no network requests. The guard in
// fixtures.ts checks the requests, console and CSP; this test checks storage
// after every kind of interaction.
test('nothing is stored after using every control', async ({ page }) => {
  await openApp(page);
  const all = sliders(page);
  await expect(all).toHaveCount(10);

  // Drag the first slider with the pointer from its left end to its right end.
  const first = all.first();
  await first.scrollIntoViewIfNeeded();
  const box = await first.boundingBox();
  if (!box) throw new Error('the first slider has no bounding box');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 12 });
  await page.mouse.up();
  await expect(first).toHaveValue('10');

  // Keyboard on another slider.
  const second = all.nth(1);
  await second.focus();
  await page.keyboard.press('Home');
  await expect(second).toHaveValue('1');
  await page.keyboard.press('ArrowRight');
  await expect(second).toHaveValue('2');

  // Presets (they animate step by step).
  await applyPreset(page, 9);
  await applyPreset(page, 3);
  await applyPreset(page, 6);

  // Open a card, pin a goal, close the card.
  await page.locator('.tile').nth(10).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const goal = dialog.locator('.goal-btn');
  await goal.click();
  await expect(goal).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(goalDisplay(page)).toHaveCount(1);

  // Switch languages and open a floor explanation.
  for (const code of ['NL', 'UA', 'EN']) {
    const button = page.getByRole('button', { name: code, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('.floor-info-btn').first().click();
  await page.keyboard.press('Escape');

  // Open and close "How it works".
  await page.locator('.help-btn').click();
  await expect(page.locator('.about-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.about-dialog')).toBeHidden();

  // The URL hash is the only state; wait for its debounced update.
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#s=6{10}&g=[a-z-]+&l=en$/);

  const state = await page.evaluate(async () => ({
    cookie: document.cookie,
    localStorage: localStorage.length,
    sessionStorage: sessionStorage.length,
    indexedDB: (await indexedDB.databases()).map((d) => d.name),
    serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length,
    caches: await caches.keys(),
  }));
  expect(state).toEqual({
    cookie: '',
    localStorage: 0,
    sessionStorage: 0,
    indexedDB: [],
    serviceWorkers: 0,
    caches: [],
  });

  // The same, seen from the browser side.
  const stored = await page.context().storageState({ indexedDB: true });
  expect(stored.cookies).toEqual([]);
  expect(stored.origins).toEqual([]);
});
