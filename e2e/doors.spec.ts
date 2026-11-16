import type { Page } from '@playwright/test';
import { TOTAL_TILES, applyPreset, expect, hash, seriousA11yIssues, sliders, test } from './fixtures';

// The doors view (deuren.html): the same sliders, data and engine as the floors view,
// shown as a street of doors grouped by field.

/** Maths 7, physics 6, chemistry 5, biology 7, Dutch 7, English 6, history 7, geography 6, technology 7, art 4. */
const MID = '7657767674';

async function openDoors(page: Page, hashPart = ''): Promise<void> {
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  await page.goto(`/deuren.html${hashPart}`);
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
}

const counter = (page: Page) => page.locator('.doors-summary .summary-counts');
const stepLine = (page: Page) => page.locator('.doors-summary .door-step');
const doors = (page: Page, state: 'open' | 'ajar' | 'closed') => page.locator(`.door.is-${state}`);

test('lowest sliders: the no-diploma doors are open and there is a next step', async ({ page }) => {
  await openDoors(page, '#s=1111111111&l=nl');
  await expect(doors(page, 'open')).toHaveCount(5);
  await expect(counter(page)).toHaveText('5 deuren open, 0 bijna open');
  await expect(stepLine(page)).toHaveText(/^Volgende deur: .+, nog \d+ punten erbij\.$/);
  // Five groups by field, never floors.
  await expect(page.locator('.block')).toHaveCount(5);
  await expect(page.locator('.floor')).toHaveCount(0);
});

test('mixed grades: open, almost open with the one subject that opens it, and the cheapest step', async ({ page }) => {
  await openDoors(page, `#s=${MID}&l=nl`);
  await expect(counter(page)).toHaveText('15 deuren open, 2 bijna open');
  await expect(stepLine(page)).toHaveText('+1 voor Kunst opent nog 2 deuren.');
  await expect(doors(page, 'ajar')).toHaveCount(2);
  for (const id of ['kok', 'meubelmaker']) {
    const door = page.locator(`.door[data-id="${id}"]`);
    await expect(door).toHaveClass(/is-ajar/);
    // Under the door on wide screens, as a badge on the door on phones.
    await expect(door.locator('.door-key')).toHaveText('+1 Kunst');
    await expect(door.locator('.door-badge')).toHaveText('+1🎨');
    await expect(door).toHaveAttribute('aria-label', /^[^:]+: bijna open: \+1 Kunst(\. .+)?$/);
  }
  await expect(page.locator('.door[data-id="arts"]')).toHaveAttribute('aria-label', 'Arts: nog niet open');

  // Taking the step opens exactly the doors it promised.
  await sliders(page).nth(9).focus();
  await page.keyboard.press('ArrowRight');
  await expect(counter(page)).toHaveText(/^17 deuren open, /);
});

test('all sliders 10: every door is open, said as a fact', async ({ page }) => {
  await openDoors(page, '#s=aaaaaaaaaa&l=nl');
  await expect(doors(page, 'open')).toHaveCount(TOTAL_TILES);
  await expect(counter(page)).toHaveText('Alle 36 deuren zijn open');
  await expect(stepLine(page)).toHaveText('Tik op een deur en kijk wat dat werk is.');
});

test('the presets move the doors as they move the building', async ({ page }) => {
  await openDoors(page);
  await applyPreset(page, 3);
  await expect(doors(page, 'open')).toHaveCount(5);
  await applyPreset(page, 9);
  await expect(doors(page, 'open')).toHaveCount(TOTAL_TILES);
});

test('a door opens the profession card with level and pay; Escape gives focus back to the door', async ({ page }) => {
  await openDoors(page, `#s=${MID}&l=nl`);
  const door = page.locator('.door[data-id="kok"]');
  await door.focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Kok');
  await expect(card.locator('.state-pill')).toHaveText('bijna open: +1 Kunst');
  await expect(card.locator('.card-floor')).toContainText('mbo 2-3');
  await expect(card.locator('.card-pay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(door).toBeFocused();
});

test('"from the goal" works here too: the sliders mark what the goal needs', async ({ page }) => {
  await openDoors(page, `#s=${MID}&l=nl`);
  await page.locator('.door[data-id="arts"]').click();
  await page.getByRole('dialog').locator('.goal-btn').click();
  await page.keyboard.press('Escape');
  await expect.poll(() => hash(page)).toBe(`#s=${MID}&g=arts&l=nl`);
  await expect(page.locator('.door.is-goal')).toHaveCount(1);
  await expect(page.locator('.goal-need')).toHaveCount(4);
  await expect(page.locator('.goal-banner, .summary-goal').filter({ visible: true })).toHaveText(/Doel: Arts/);
});

test('the language switch changes the words and the order inside a group', async ({ page }) => {
  await openDoors(page, `#s=${MID}&l=nl`);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(counter(page)).toHaveText('15 doors open, 2 almost open');
  await expect(stepLine(page)).toHaveText('+1 in Art opens 2 more doors.');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  await expect(page.locator('#field-care')).toHaveText('Care and health');

  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(counter(page)).toHaveText('Відчинені двері: 15, майже відчинені: 2');
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  // Alphabetical in the page language: the first door of "care" differs between nl and ua.
  const first = page.locator('.field-care .door').first();
  await expect(first).toHaveAttribute('data-id', 'verzorgende');
  await page.getByRole('button', { name: 'NL', exact: true }).click();
  await expect(first).toHaveAttribute('data-id', 'apotheker');
});

test('the link to the other view keeps the hash, both ways', async ({ page }) => {
  const state = `#s=${MID}&g=kok&l=nl`;
  await openDoors(page, state);
  const toFloors = page.locator('a.other-view');
  await expect(toFloors).toHaveText('Andere weergave');
  await expect(toFloors).toHaveAttribute('href', `./${state}`);
  await toFloors.click();
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
  expect(new URL(page.url()).pathname).toBe('/');
  expect(await hash(page)).toBe(state);
  await expect(sliders(page).nth(9)).toHaveValue('4');
  await expect(page.locator('.tile.is-goal')).toHaveCount(1);

  // A slider change on the floors view travels back too.
  await sliders(page).nth(9).focus();
  await page.keyboard.press('ArrowRight');
  const moved = `#s=${MID.slice(0, 9)}5&g=kok&l=nl`;
  await expect(page.locator('a.other-view')).toHaveAttribute('href', `deuren.html${moved}`);
  await page.locator('a.other-view').click();
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
  expect(new URL(page.url()).pathname).toBe('/deuren.html');
  expect(await hash(page)).toBe(moved);
  await expect(page.locator('.door[data-id="kok"]')).toHaveClass(/is-open/);
});

test('reduced motion: the doors do not swing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDoors(page, `#s=${MID}&l=nl`);
  await expect(page.locator('.door-leaf').first()).toHaveCSS('transition-duration', '0s');
});

for (const lang of ['nl', 'en', 'ua'] as const) {
  test(`no serious or critical accessibility issues: doors, card, "How it works" (${lang})`, async ({ page }) => {
    await openDoors(page, `#s=${MID}&l=${lang}`);
    expect(await seriousA11yIssues(page), 'doors').toEqual([]);

    await page.locator('.door.is-ajar').first().click();
    await expect(page.locator('.card-dialog')).toBeVisible();
    expect(await seriousA11yIssues(page), 'open card').toEqual([]);
    await page.keyboard.press('Escape');

    await page.locator('.help-btn').click();
    await expect(page.locator('.about-dialog')).toBeVisible();
    await expect(page.locator('.about-dialog')).not.toContainText(/verdieping|floor|поверх/i);
    expect(await seriousA11yIssues(page), '"How it works" dialog').toEqual([]);
  });
}

// Desktop: nothing scrolls. Phones: the whole street stays above the slider panel,
// as the building does in the floors view, and nothing scrolls sideways.
test('the doors view fits the screen', async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === 'desktop';
  const sizes = desktop
    ? [{ width: 1280, height: 800 }, { width: 1366, height: 768 }]
    : [{ width: 390, height: 844 }, { width: 375, height: 812 }, { width: 375, height: 667 }, { width: 360, height: 640 }, { width: 320, height: 568 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const lang of ['nl', 'en', 'ua']) {
      for (const state of [`#s=${MID}&l=${lang}`, `#s=8876677665&g=arts&l=${lang}`]) {
        await openDoors(page, state);
        const m = await page.evaluate(() => {
          const el = document.documentElement;
          const column = document.querySelector('.col-sliders');
          return {
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            columnOverflow: column ? column.scrollHeight - column.clientHeight : 0,
            streetBottom: [...document.querySelectorAll('.block')].at(-1)?.getBoundingClientRect().bottom ?? Infinity,
            panelTop: column?.getBoundingClientRect().top ?? -Infinity,
          };
        });
        const where = `${size.width}x${size.height}, ${state}`;
        expect(m.scrollWidth, `horizontal scroll (${where})`).toBeLessThanOrEqual(m.clientWidth);
        if (desktop) {
          expect(m.scrollHeight, `page scroll (${where})`).toBeLessThanOrEqual(m.clientHeight);
          expect(m.columnOverflow, `slider column scroll (${where})`).toBeLessThanOrEqual(0);
        } else {
          expect(m.streetBottom, `street bottom vs panel top (${where})`).toBeLessThanOrEqual(m.panelTop);
        }
      }
    }
  }
});
