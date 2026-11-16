import type { Page } from '@playwright/test';
import { TOTAL_TILES, expect, expectWideFont, hash, seriousA11yIssues, settle, test, useWideFont } from './fixtures';

// The onderbouw view (onderbouw.html): school level and profile instead of grades, the
// same professions as doors that are open, one step more, or not on this route.

async function openRoute(page: Page, hashPart = ''): Promise<void> {
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  await page.goto(`/onderbouw.html${hashPart}`);
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
}

const summary = (page: Page) => page.locator('.route-summary .summary-counts');
const level = (page: Page, key: string) => page.locator(`.choice-level [role="radio"][data-key="${key}"]`);
const profile = (page: Page, key: string) => page.locator(`.choice-profile [role="radio"][data-key="${key}"]`);
const door = (page: Page, id: string) => page.locator(`.door[data-id="${id}"]`);

async function expectDoor(page: Page, id: string, state: 'open' | 'ajar' | 'closed', line?: string | RegExp) {
  await expect(door(page, id)).toHaveClass(new RegExp(`\\bis-${state}\\b`));
  if (line !== undefined) await expect(door(page, id).locator('.door-key')).toHaveText(line);
}

test('loads on havo without a profile: what the level alone decides, with a count per profile', async ({ page }) => {
  await openRoute(page, '#l=nl');
  await expect(page).toHaveTitle('Wat word ik? - Onderbouw');
  await expect(level(page, 'havo')).toHaveAttribute('aria-checked', 'true');
  await expect(profile(page, 'none')).toHaveAttribute('aria-checked', 'true');
  await expect(summary(page)).toHaveText('Open: 23 · met een extra stap: 10 · niet op deze route: 3');
  for (const [key, n] of [['nt', 28], ['ng', 27], ['em', 27], ['cm', 23]] as const) {
    await expect(profile(page, key).locator('.choice-note')).toHaveText(`opent ${n} van 36`);
  }
  // Five groups by field, as on the doors view; never floors.
  await expect(page.locator('.block')).toHaveCount(5);
  await expect(page.locator('.floor')).toHaveCount(0);
  // Geneeskunde has no direct profile (Ratho 2026): from havo it is two steps.
  await expectDoor(page, 'arts', 'closed', 'vanaf vwo');
  await expectDoor(page, 'apotheker', 'ajar', /^via vwo 5 of via hbo-propedeuse · met N&T$/);
  await expectDoor(page, 'journalist', 'open');
});

test('the level and profile buttons change the doors, and the hash follows', async ({ page }) => {
  await openRoute(page, '#l=nl');
  await level(page, 'vwo').click();
  await profile(page, 'cm').click();
  await expectDoor(page, 'arts', 'closed', 'met N&T of N&G');
  await expectDoor(page, 'advocaat', 'open');
  // hbo at vwo follows the table for vwo pupils: Technische Informatica has no row there.
  await expectDoor(page, 'software-engineer', 'open');
  await expectDoor(page, 'elektrotechnisch-ingenieur', 'ajar', 'extra vak wiskunde A');
  await expect(page.locator('.route-chosen')).toHaveText('Met C&M zijn 26 van de 36 deuren open.');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=cm&l=nl');

  await profile(page, 'ng').click();
  await expectDoor(page, 'arts', 'ajar', 'extra vak natuurkunde');
  await expectDoor(page, 'advocaat', 'open');
  await expect(door(page, 'advocaat')).toHaveAttribute('aria-label', 'Advocaat: open');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=ng&l=nl');

  // vmbo-bb/kb: the profile goes, mbo 4 is one step away, hbo and wo are not on this route.
  await level(page, 'bbkb').click();
  await expect(profile(page, 'none')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.choice-profile .choice-title')).toHaveText('Mijn richting');
  await expectDoor(page, 'verpleegkundige', 'ajar', 'eerst mbo 2 (met kb direct)');
  await expectDoor(page, 'journalist', 'closed', 'vanaf vmbo-gl/tl');
  await expectDoor(page, 'arts', 'closed', 'vanaf vwo');
  await expectDoor(page, 'advocaat', 'closed', 'vanaf havo');
  await expect.poll(() => hash(page)).toBe('#n=bbkb&l=nl');
});

test('a vmbo direction never closes an mbo door: it only says what fits', async ({ page }) => {
  await openRoute(page, '#n=gltl&l=nl');
  await expect(profile(page, 'zorg').locator('.choice-note')).toHaveText('past bij 4 van 15 mbo');
  const closedBefore = await page.locator('.door.is-closed').count();
  await profile(page, 'zorg').click();
  await expect(page.locator('.door.is-closed')).toHaveCount(closedBefore);
  await expectDoor(page, 'verpleegkundige', 'open', 'past bij jouw richting');
  await expect(door(page, 'verpleegkundige')).toHaveClass(/is-fit/);
  await expectDoor(page, 'kok', 'open', 'past het best bij Economie');
  await expectDoor(page, 'journalist', 'ajar', 'via mbo 4 of via havo 4');
  // Only hbo and wo doors are ever closed from vmbo, and from gl/tl only wo.
  for (const id of await page.locator('.door.is-closed').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))) {
    expect(['arts', 'chirurg', 'electrical-engineer', 'wetenschapper', 'advocaat', 'architect', 'apotheker', 'dierenarts']).toContain(id);
  }
  await expect(page.locator('.route-hint')).toHaveText(/Met elk vmbo-diploma kun je naar het mbo/);
});

test('the buttons are radio groups: one tab stop each, arrows, Home and End move the choice', async ({ page }) => {
  await openRoute(page, '#l=en');
  await level(page, 'havo').focus();
  await page.keyboard.press('ArrowRight');
  await expect(level(page, 'vwo')).toBeFocused();
  await expect(level(page, 'vwo')).toHaveAttribute('aria-checked', 'true');
  await expect(level(page, 'havo')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Home');
  await expect(level(page, 'bbkb')).toBeFocused();
  await expect(level(page, 'bbkb')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(level(page, 'vwo')).toBeFocused();
  await page.keyboard.press('End');
  await expect(level(page, 'vwo')).toHaveAttribute('aria-checked', 'true');
  // Tab leaves the level group and lands on the checked profile button.
  await page.keyboard.press('Tab');
  await expect(profile(page, 'none')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(profile(page, 'nt')).toBeFocused();
  await expect(profile(page, 'nt')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=nt&l=en');
  await expect(page.getByRole('radiogroup', { name: 'My school level' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'My profile' })).toBeVisible();
});

test('the hash round-trips: a link, a reload, a hash change, garbage and keys of other pages', async ({ page }) => {
  await openRoute(page, '#n=gltl&p=techniek&l=en');
  await expect(level(page, 'gltl')).toHaveAttribute('aria-checked', 'true');
  await expect(profile(page, 'techniek')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  await page.reload();
  await expect(profile(page, 'techniek')).toHaveAttribute('aria-checked', 'true');
  expect(await hash(page)).toBe('#n=gltl&p=techniek&l=en');

  await page.evaluate(() => (location.hash = '#n=vwo&p=ng&l=ua'));
  await expect(level(page, 'vwo')).toHaveAttribute('aria-checked', 'true');
  await expect(profile(page, 'ng')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');

  await openRoute(page, '#n=mavo&p=zorg&l=nl');
  await expect(level(page, 'havo')).toHaveAttribute('aria-checked', 'true');
  await expect(profile(page, 'none')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => hash(page)).toBe('#n=havo&l=nl');

  await openRoute(page, '#s=8876677665&g=arts&n=vwo&p=em&v=1');
  await expect(profile(page, 'em')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=em');
});

test('a door opens the card; Escape and the close button give focus back to the door', async ({ page }) => {
  await openRoute(page, '#n=vwo&p=nt&l=nl');
  const arts = door(page, 'arts');
  await arts.focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Arts');
  await expect(card.locator('.card-close')).toBeFocused();
  await expect(card.locator('.state-pill')).toHaveText('met een extra stap: extra vak biologie');
  await expect(card.locator('.card-floor')).toContainText('wo');
  await expect(card.locator('.admission-lines li')).toHaveText([
    'Zonder extra vak geeft geen enkel profiel toegang.',
    'Met N&T: extra vak biologie.',
    'Met N&G: extra vak natuurkunde.',
    'Met E&M of C&M: een ander profiel nodig.',
    'Gecontroleerd met de toelatingsregeling (Ratho) van 1 september 2026, opleiding Geneeskunde.',
  ]);
  await expect(card.locator('.card-pay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(arts).toBeFocused();

  const kok = door(page, 'kok');
  await kok.click();
  await expect(card).toBeVisible();
  await expect(card.locator('.route-lines li').first()).toHaveText('Met dit niveau kun je hier direct naartoe.');
  await card.locator('.card-close').click();
  await expect(card).toBeHidden();
  await expect(kok).toBeFocused();
});

test('the links between the pages carry the language and nothing else', async ({ page }) => {
  // Without a chosen language nothing is carried.
  await openRoute(page, '#n=vwo&p=ng');
  const links = page.locator('a.other-page');
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute('href', './#');
  await expect(links.nth(1)).toHaveAttribute('href', 'deuren.html#');
  await expect(links.nth(2)).toHaveAttribute('href', 'bovenbouw.html#');

  await openRoute(page, '#n=vwo&p=ng&l=nl');
  await expect(links.nth(0)).toHaveText('Voor groep 6-8: gebouw');
  await expect(links.nth(0)).toHaveAttribute('href', './#l=nl');
  await expect(links.nth(1)).toHaveText('Voor groep 6-8: deuren');
  await expect(links.nth(1)).toHaveAttribute('href', 'deuren.html#l=nl');
  await links.nth(0).click();
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
  expect(new URL(page.url()).pathname).toBe('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
  await expect(page.locator('.from-link')).toHaveCount(0);
  await expect.poll(() => hash(page)).toBe('#s=6666666666&l=nl');

  // From the building to the onderbouw view: the language only, not the grades or goal.
  const toRoute = page.locator('a.other-page').first();
  await expect(toRoute).toHaveText('Voor de onderbouw (klas 1-3)');
  await expect(toRoute).toHaveAttribute('href', 'onderbouw.html#l=nl');
  await toRoute.click();
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
  expect(new URL(page.url()).pathname).toBe('/onderbouw.html');
  await expect.poll(() => hash(page)).toBe('#n=havo&l=nl');

  // The doors view links here too; there, the other view link stays as it was.
  await page.locator('a.other-page').nth(1).click();
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
  expect(new URL(page.url()).pathname).toBe('/deuren.html');
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(page.locator('a.other-page').first()).toHaveAttribute('href', 'onderbouw.html#l=ua');
  await expect(page.locator('a.other-view')).toHaveAttribute('href', /^\.\/#s=6666666666&l=ua&v=1$/);
  await page.locator('a.other-page').first().click();
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await expect(page).toHaveTitle('Wat word ik? - 1-3 клас середньої школи');
});

for (const lang of ['nl', 'en', 'ua'] as const) {
  test(`no serious or critical accessibility issues: doors, buttons, card, "How it works" (${lang})`, async ({ page }) => {
    await openRoute(page, `#n=havo&l=${lang}`);
    expect(await seriousA11yIssues(page), 'page without a profile').toEqual([]);
    await profile(page, 'em').click();
    expect(await seriousA11yIssues(page), 'page with a profile').toEqual([]);

    await page.locator('.door.is-closed').first().click();
    await expect(page.locator('.card-dialog')).toBeVisible();
    expect(await seriousA11yIssues(page), 'open card').toEqual([]);
    await page.keyboard.press('Escape');

    await page.locator('.help-btn').click();
    await expect(page.locator('.about-dialog')).toBeVisible();
    expect(await seriousA11yIssues(page), '"How it works" dialog').toEqual([]);
  });
}

// Every screen: nothing scrolls sideways. The page may scroll down.
async function checkRouteFit(page: Page, desktop: boolean, font: string): Promise<void> {
  const sizes = desktop
    ? [{ width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 900, height: 700 }]
    : [{ width: 390, height: 844 }, { width: 375, height: 812 }, { width: 360, height: 640 }, { width: 320, height: 568 }, { width: 768, height: 1024 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const lang of ['nl', 'en', 'ua']) {
      for (const state of [`#n=havo&l=${lang}`, `#n=bbkb&p=groen&l=${lang}`, `#n=vwo&p=cm&l=${lang}`]) {
        await openRoute(page, state);
        await settle(page);
        const m = await page.evaluate(() => {
          const el = document.documentElement;
          const right = Math.max(...[...document.querySelectorAll('.door, .choice-btn, .block')].map((e) => e.getBoundingClientRect().right));
          return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right };
        });
        const where = `${size.width}x${size.height}, ${state}, ${font}`;
        expect(m.scrollWidth, `horizontal scroll (${where})`).toBeLessThanOrEqual(m.clientWidth);
        expect(m.right, `content beyond the right edge (${where})`).toBeLessThanOrEqual(m.clientWidth);
      }
    }
  }
}

test('the onderbouw view fits the screen without sideways scrolling', async ({ page }, testInfo) => {
  await checkRouteFit(page, testInfo.project.name === 'desktop', 'system font');
});

// As for the other views: the layout must not depend on the machine's default font.
// CI on Linux has a wider system font than macOS, and once overflowed at 900px here.
// Unlike the other views, this one runs at the desktop sizes too.
test('with a wide system font the onderbouw view fits too, on desktop and on phones', async ({ page }, testInfo) => {
  await useWideFont(page);
  await openRoute(page);
  await expectWideFont(page);
  await checkRouteFit(page, testInfo.project.name === 'desktop', 'wide font');
});

test('arrowing through the levels keeps the havo/vwo profile while it passes vmbo', async ({ page }) => {
  await openRoute(page, '#n=vwo&p=nt&l=en');
  await level(page, 'vwo').focus();
  await page.keyboard.press('ArrowRight');
  await expect(level(page, 'bbkb')).toHaveAttribute('aria-checked', 'true');
  await expect(profile(page, 'none')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(level(page, 'gltl')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(level(page, 'havo')).toHaveAttribute('aria-checked', 'true');
  await expect(profile(page, 'nt')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => hash(page)).toBe('#n=havo&p=nt&l=en');

  // The vmbo direction comes back the same way.
  await level(page, 'gltl').click();
  await profile(page, 'groen').click();
  await level(page, 'vwo').click();
  await expect(profile(page, 'nt')).toHaveAttribute('aria-checked', 'true');
  await level(page, 'bbkb').click();
  await expect(profile(page, 'groen')).toHaveAttribute('aria-checked', 'true');
});

test('a havo or vwo profile without admission closes an hbo door; only vmbo cards name the mbo 4 route', async ({ page }) => {
  await openRoute(page, '#n=havo&p=cm&l=en');
  await expectDoor(page, 'mechatronica-engineer', 'closed', 'with N&T');
  await door(page, 'mechatronica-engineer').click();
  const card = page.getByRole('dialog');
  await expect(card.locator('.admission-lines li')).toHaveText([
    'Directly with N&T.',
    'With N&G: extra subject physics.',
    'With E&M: extra subject physics.',
    'With C&M: another profile is needed.',
    'Checked against the Dutch admission regulation (Ratho) of 1 September 2026, programme Mechatronica.',
  ]);
  await expect(card).not.toContainText('Via mbo 4');
  await page.keyboard.press('Escape');

  await level(page, 'gltl').click();
  await expectDoor(page, 'mechatronica-engineer', 'ajar', 'via mbo 4 or via havo 4');
  await door(page, 'mechatronica-engineer').click();
  await expect(card.locator('.admission-lines li').last()).toHaveText('Via mbo 4 the profile rules do not apply.');
});

test('a wo card says the vwo rule, and at havo that vwo 5 or an hbo first year comes first', async ({ page }) => {
  await openRoute(page, '#n=havo&p=nt&l=en');
  await expectDoor(page, 'apotheker', 'ajar', 'via vwo 5 or via hbo year 1');
  await door(page, 'apotheker').click();
  const card = page.getByRole('dialog');
  await expect(card.getByRole('heading', { level: 3, name: 'Admission from vwo' })).toBeVisible();
  await expect(card.locator('.admission-lines li').first()).toHaveText(
    'From havo, vwo 5 or a first year of hbo comes first; then this rule applies.',
  );
  await page.keyboard.press('Escape');

  await level(page, 'vwo').click();
  await door(page, 'apotheker').click();
  await expect(card.locator('.admission-lines li').first()).toHaveText('Directly with N&T.');
  await page.keyboard.press('Escape');
  await door(page, 'journalist').click();
  await expect(card.getByRole('heading', { level: 3, name: 'Admission from vwo' })).toBeVisible();
  await expect(card.locator('.admission-lines li').last()).toHaveText(
    'Checked against the Dutch admission regulation (Ratho) of 1 September 2026: it has no extra profile rules for Journalistiek.',
  );
});

test('with no direct profile, a wo card at havo does not promise one step: Geneeskunde', async ({ page }) => {
  await openRoute(page, '#n=havo&p=ng&l=en');
  await expectDoor(page, 'arts', 'closed', 'from vwo up');
  await door(page, 'arts').click();
  const card = page.getByRole('dialog');
  await expect(card.locator('.admission-lines li').first()).toHaveText('No profile gets you in without an extra subject.');
  await expect(card.locator('.admission-lines')).not.toContainText('From havo');
});

test('an hbo card shows the havo rule at havo and the vwo rule at vwo, each with its own row', async ({ page }) => {
  await openRoute(page, '#n=havo&p=cm&l=en');
  await expectDoor(page, 'software-engineer', 'ajar', 'extra subject: maths A (wiskunde A)');
  await door(page, 'software-engineer').click();
  const card = page.getByRole('dialog');
  await expect(card.getByRole('heading', { level: 3, name: 'Admission from havo' })).toBeVisible();
  await expect(card.locator('.admission-lines li')).toHaveText([
    'Directly with N&T, N&G or E&M.',
    'With C&M: extra subject maths A (wiskunde A).',
    'Checked against the Dutch admission regulation (Ratho) of 1 September 2026, programme Technische Informatica.',
  ]);
  await page.keyboard.press('Escape');

  await level(page, 'vwo').click();
  await expectDoor(page, 'software-engineer', 'open');
  await door(page, 'software-engineer').click();
  await expect(card.getByRole('heading', { level: 3, name: 'Admission from vwo' })).toBeVisible();
  await expect(card.locator('.admission-lines li')).toHaveText([
    'Every profile gets you in directly.',
    'Checked against the Dutch admission regulation (Ratho) of 1 September 2026: it has no extra profile rules for Technische Informatica.',
  ]);
});

test('a footnote that lets N&G catch up in the first year is on the card; the door stays closed', async ({ page }) => {
  await openRoute(page, '#n=vwo&p=ng&l=en');
  await expectDoor(page, 'electrical-engineer', 'closed', 'with N&T');
  await door(page, 'electrical-engineer').click();
  const card = page.getByRole('dialog');
  await expect(card.locator('.admission-lines li')).toHaveText([
    'Directly with N&T.',
    'With N&G, E&M or C&M: another profile is needed.',
    'With N&G some universities let you catch up physics and maths B (wiskunde B) in the first year.',
    'Checked against the Dutch admission regulation (Ratho) of 1 September 2026, programme Electrical Engineering.',
  ]);
});
