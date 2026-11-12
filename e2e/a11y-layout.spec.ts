import type { Page } from '@playwright/test';
import { expect, fromLinkNotice, openApp, seriousA11yIssues, test } from './fixtures';

const LANGS = ['nl', 'en', 'ua'] as const;

/** Page states that change the height of the layout. */
const STATES = (lang: string) =>
  [
    ['default', `#s=6666666666&l=${lang}`],
    ['with a goal', `#s=3333333333&g=kapper&l=${lang}`],
    ['from a link with a goal', `#s=8876677665&g=arts&l=${lang}`],
  ] as const;

async function measure(page: Page) {
  return page.evaluate(() => {
    const el = document.documentElement;
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const column = document.querySelector('.col-sliders');
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      columnOverflow: column ? column.scrollHeight - column.clientHeight : null,
      floor0Bottom: box('.floor-0')?.bottom ?? null,
      panelTop: box('.col-sliders')?.top ?? null,
    };
  });
}

for (const lang of LANGS) {
  test(`no serious or critical accessibility issues: main view, card, "How it works" (${lang})`, async ({ page }) => {
    await openApp(page, `#s=6666666666&l=${lang}`);
    expect(await seriousA11yIssues(page), 'main view').toEqual([]);

    await page.locator('.tile').first().click();
    await expect(page.locator('.card-dialog')).toBeVisible();
    expect(await seriousA11yIssues(page), 'open card').toEqual([]);
    await page.keyboard.press('Escape');

    await page.locator('.help-btn').click();
    await expect(page.locator('.about-dialog')).toBeVisible();
    expect(await seriousA11yIssues(page), '"How it works" dialog').toEqual([]);
  });

  test(`no serious or critical accessibility issues with the link notice (${lang})`, async ({ page }) => {
    await openApp(page, `#s=8876677665&g=arts&l=${lang}`);
    await expect(fromLinkNotice(page)).toHaveCount(1);
    expect(await seriousA11yIssues(page)).toEqual([]);
  });

  // Desktop (1280x800 and 1366x768): neither the page nor the slider column scrolls.
  // Phones: the page scrolls down, never sideways (checked at more sizes below).
  test(`the page fits the viewport (${lang})`, async ({ page }, testInfo) => {
    const desktop = testInfo.project.name === 'desktop';
    const sizes = desktop ? [{ width: 1280, height: 800 }, { width: 1366, height: 768 }] : [page.viewportSize()];
    for (const size of sizes) {
      if (size) await page.setViewportSize(size);
      for (const [state, link] of STATES(lang)) {
        await openApp(page, link);
        const m = await measure(page);
        const where = `${size?.width}x${size?.height}, ${state}`;
        expect(m.scrollWidth, `horizontal scroll (${where})`).toBeLessThanOrEqual(m.clientWidth);
        if (desktop) {
          expect(m.scrollHeight, `page scroll (${where})`).toBeLessThanOrEqual(m.clientHeight);
          expect(m.columnOverflow, `slider column scroll (${where})`).toBeLessThanOrEqual(0);
        }
      }
    }
  });
}

// Phones: the slider panel is fixed at the bottom; the whole building, down to the
// ground floor, must stay above it, or a child dragging a slider cannot see the
// floors change. This regressed once. Nothing may scroll sideways either.
const PHONES = [
  { width: 375, height: 812 },
  { width: 375, height: 667 },
  { width: 360, height: 640 },
  { width: 320, height: 568 },
];

async function checkPhones(page: Page, font: string) {
  for (const size of PHONES) {
    await page.setViewportSize(size);
    for (const lang of LANGS) {
      for (const [state, link] of STATES(lang)) {
        await openApp(page, link);
        const m = await measure(page);
        const where = `${size.width}x${size.height}, ${lang}, ${state}, ${font}`;
        expect(m.floor0Bottom, `ground floor (${where})`).not.toBeNull();
        expect(m.panelTop, `slider panel (${where})`).not.toBeNull();
        expect(m.floor0Bottom ?? Infinity, `ground floor bottom vs panel top (${where})`).toBeLessThanOrEqual(
          m.panelTop ?? -Infinity,
        );
        expect(m.scrollWidth, `horizontal scroll (${where})`).toBeLessThanOrEqual(m.clientWidth);
      }
    }
  }
}

test('phones: the ground floor stays above the slider panel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phone sizes only');
  await checkPhones(page, 'system font');
});

/** Wide sans-serif fonts: Verdana on macOS and Windows, DejaVu Sans on Linux. */
const WIDE_FONTS = 'Verdana, "DejaVu Sans", sans-serif';
/** Arial-width fonts, for comparison. */
const NARROW_FONTS = 'Arial, "Liberation Sans", Helvetica, sans-serif';

// The layout must not depend on the machine's default font: CI once failed at 320px
// with a wider system font than the one the layout was tuned on.
test('phones with a wide system font: the same rules hold', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phone sizes only');
  // Through the CSSOM before the page's scripts run: the page's CSP refuses a <style> tag.
  await page.addInitScript((fonts) => {
    const apply = () => document.documentElement?.style.setProperty('font-family', fonts, 'important');
    apply();
    document.addEventListener('DOMContentLoaded', apply);
  }, WIDE_FONTS);

  // The variant only proves something when a wide font is really installed.
  await openApp(page);
  const ratio = await page.evaluate(
    ([wide, narrow]) => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return 0;
      const width = (fonts: string) => {
        ctx.font = `16px ${fonts}`;
        return ctx.measureText('Wat word ik? NL EN UA Demodata').width;
      };
      return width(wide ?? '') / width(narrow ?? '');
    },
    [WIDE_FONTS, NARROW_FONTS],
  );
  expect(ratio, 'a wide font (Verdana or DejaVu Sans) must be installed for this test').toBeGreaterThan(1.08);
  await expect(page.locator('html')).toHaveCSS('font-family', /Verdana|DejaVu Sans/);

  await checkPhones(page, 'wide font');
});
