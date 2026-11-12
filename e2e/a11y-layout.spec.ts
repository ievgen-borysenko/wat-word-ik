import { expect, openApp, seriousA11yIssues, test } from './fixtures';

const LANGS = ['nl', 'en', 'ua'] as const;

for (const lang of LANGS) {
  test(`no serious or critical accessibility issues, main view and open card (${lang})`, async ({ page }) => {
    await openApp(page, `#s=6666666666&l=${lang}`);
    expect(await seriousA11yIssues(page), 'main view').toEqual([]);

    await page.locator('.tile').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await seriousA11yIssues(page), 'open card').toEqual([]);
  });

  // Desktop (1280x800): the whole page fits, no scrolling at all.
  // Mobile (375x812): the page scrolls down, never sideways.
  for (const [state, hash] of [
    ['default', `#s=6666666666&l=${lang}`],
    ['with a goal', `#s=3333333333&g=kapper&l=${lang}`],
  ] as const) {
    test(`the page fits the viewport (${lang}, ${state})`, async ({ page }, testInfo) => {
      await openApp(page, hash);
      const size = await page.evaluate(() => {
        const el = document.documentElement;
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      });
      expect(size.scrollWidth, 'horizontal scroll').toBeLessThanOrEqual(size.clientWidth);
      if (testInfo.project.name === 'desktop') {
        expect(size.scrollHeight, 'vertical scroll on desktop').toBeLessThanOrEqual(size.clientHeight);
      }
    });
  }
}
