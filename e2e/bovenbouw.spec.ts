import type { Page } from '@playwright/test';
import { TOTAL_TILES, expect, expectWideFont, hash, seriousA11yIssues, settle, test, useWideFont } from './fixtures';

// The bovenbouw view (bovenbouw.html): the school level, the profile and the exam
// subjects on top of it. The same professions as doors; admission to hbo and wo is
// judged on the subjects the pupil has.

async function openExam(page: Page, hashPart = ''): Promise<void> {
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  await page.goto(`/bovenbouw.html${hashPart}`);
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
}

const summary = (page: Page) => page.locator('.route-summary .summary-counts');
const level = (page: Page, key: string) => page.locator(`.choice-level [role="radio"][data-key="${key}"]`);
const profile = (page: Page, key: string) => page.locator(`.choice-profile [role="radio"][data-key="${key}"]`);
const box = (page: Page, key: string) => page.locator(`.choice-extras input[type="checkbox"][data-key="${key}"]`);
const door = (page: Page, id: string) => page.locator(`.door[data-id="${id}"]`);

async function expectDoor(page: Page, id: string, state: 'open' | 'ajar' | 'closed', line?: string | RegExp) {
  await expect(door(page, id)).toHaveClass(new RegExp(`\\bis-${state}\\b`));
  if (line !== undefined) await expect(door(page, id).locator('.door-key')).toHaveText(line);
}

test('loads on havo without a profile or subjects: the onderbouw doors, and a box for each subject', async ({ page }) => {
  await openExam(page, '#l=nl');
  await expect(page).toHaveTitle('Wat word ik? - Bovenbouw');
  await expect(level(page, 'havo')).toHaveAttribute('aria-checked', 'true');
  await expect(profile(page, 'none')).toHaveAttribute('aria-checked', 'true');
  await expect(summary(page)).toHaveText('Open: 23 · met een extra stap: 10 · niet op deze route: 3');
  for (const [key, n] of [['nt', 28], ['ng', 27], ['em', 27], ['cm', 23]] as const) {
    await expect(profile(page, key).locator('.choice-note')).toHaveText(`opent ${n} van 36`);
  }
  await expect(page.getByRole('group', { name: 'Mijn examenvakken naast mijn profiel' })).toBeVisible();
  await expect(page.locator('.choice-extras input[type="checkbox"]')).toHaveCount(5);
  for (const key of ['wiskunde-a', 'wiskunde-b', 'natuurkunde', 'scheikunde', 'biologie']) await expect(box(page, key)).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'wiskunde B' })).toBeVisible();
  await expect(page.locator('.block')).toHaveCount(5);
  await expectDoor(page, 'arts', 'closed', 'vanaf vwo');
  await expectDoor(page, 'journalist', 'open');
  await expect.poll(() => hash(page)).toBe('#n=havo&l=nl');
});

test('the boxes judge admission on the subjects: Mechatronica with C&M, one group at a time', async ({ page }) => {
  await openExam(page, '#n=havo&p=cm&l=en');
  await expectDoor(page, 'mechatronica-engineer', 'closed', 'still needs (maths A or maths B) and physics');
  await expect(profile(page, 'cm').locator('.choice-note')).toHaveText('opens 23 of 36');

  await box(page, 'wiskunde-a').check();
  await expectDoor(page, 'mechatronica-engineer', 'ajar', 'extra subject: physics');
  await expectDoor(page, 'software-engineer', 'open');
  await expect(profile(page, 'cm').locator('.choice-note')).toHaveText('opens 27 of 36');
  await expect.poll(() => hash(page)).toBe('#n=havo&p=cm&x=wa&l=en');

  await box(page, 'natuurkunde').check();
  await expectDoor(page, 'mechatronica-engineer', 'open');
  await expect(profile(page, 'cm').locator('.choice-note')).toHaveText('opens 28 of 36');
  await expect(page.locator('.route-chosen')).toHaveText('With C&M, 28 of the 36 doors are open.');
  await expect.poll(() => hash(page)).toBe('#n=havo&p=cm&x=wa.na&l=en');

  await box(page, 'wiskunde-a').uncheck();
  await expectDoor(page, 'mechatronica-engineer', 'ajar', 'extra subject: maths A (wiskunde A) or extra subject: maths B (wiskunde B)');
  await expect.poll(() => hash(page)).toBe('#n=havo&p=cm&x=na&l=en');
});

test('a # cell names the profiles that admit; wo from havo is one step when the subjects meet the vwo rule', async ({ page }) => {
  await openExam(page, '#n=vwo&p=em&x=na.sk.bi&l=nl');
  await expectDoor(page, 'arts', 'closed', 'met N&T of N&G');
  await expectDoor(page, 'apotheker', 'open');
  await expectDoor(page, 'electrical-engineer', 'ajar', 'extra vak wiskunde B');

  // From havo the same # cell names the same profiles: vwo would not open it for E&M.
  await level(page, 'havo').click();
  await expectDoor(page, 'arts', 'closed', 'met N&T of N&G');
  await door(page, 'arts').click();
  await expect(page.getByRole('dialog').locator('.route-lines li').first()).toHaveText('Nu niet op deze route. Met N&T of N&G kan het wel.');
  await page.keyboard.press('Escape');

  await profile(page, 'nt').click();
  await expectDoor(page, 'arts', 'ajar', 'via vwo 5 of via hbo-propedeuse');
  await box(page, 'biologie').uncheck();
  // What the vwo rule still misses, not "from vwo": ticking it brings the one step back.
  await expectDoor(page, 'arts', 'closed', 'nog nodig: biologie');
  await expect.poll(() => hash(page)).toBe('#n=havo&p=nt&x=na.sk&l=nl');

  // Without a profile: N&G with natuurkunde reaches it in one step; with no such
  // profile left, the level is what is missing.
  await profile(page, 'none').click();
  await expectDoor(page, 'arts', 'ajar', 'via vwo 5 of via hbo-propedeuse · met N&G');
  await box(page, 'natuurkunde').uncheck();
  await expectDoor(page, 'arts', 'closed', 'vanaf vwo');
});

test('from havo, a wo door names the subjects its vwo cell still asks: Natuurkunde with N&G', async ({ page }) => {
  await openExam(page, '#n=havo&p=ng&l=en');
  await expectDoor(page, 'wetenschapper', 'closed', 'still needs physics and maths B');
  await box(page, 'natuurkunde').check();
  await expectDoor(page, 'wetenschapper', 'closed', 'still needs maths B');
  await box(page, 'wiskunde-b').check();
  await expectDoor(page, 'wetenschapper', 'ajar', 'via vwo 5 or via hbo year 1');
  await expect.poll(() => hash(page)).toBe('#n=havo&p=ng&x=wb.na&l=en');
});

test('a vmbo level has no boxes and the onderbouw doors; the subjects stay in memory and out of the address', async ({ page }) => {
  await openExam(page, '#n=vwo&p=nt&x=bi&l=nl');
  await level(page, 'gltl').click();
  await expect(page.locator('.choice-extras')).toHaveCount(0);
  await expect(page.locator('.route-hint')).toHaveText(/Met elk vmbo-diploma kun je naar het mbo/);
  await expectDoor(page, 'journalist', 'ajar', 'via mbo 4 of via havo 4');
  await expectDoor(page, 'arts', 'closed', 'vanaf vwo');
  await expect.poll(() => hash(page)).toBe('#n=gltl&l=nl');

  await level(page, 'vwo').click();
  await expect(box(page, 'biologie')).toBeChecked();
  await expect(profile(page, 'nt')).toHaveAttribute('aria-checked', 'true');
  await expectDoor(page, 'arts', 'open');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=nt&x=bi&l=nl');
});

test('keyboard: the rows are radio groups, each box is a tab stop that Space toggles', async ({ page }) => {
  await openExam(page, '#n=havo&p=ng&l=en');
  await level(page, 'havo').focus();
  await page.keyboard.press('ArrowRight');
  await expect(level(page, 'vwo')).toBeFocused();
  await expect(level(page, 'vwo')).toHaveAttribute('aria-checked', 'true');
  await expect(profile(page, 'ng')).toHaveAttribute('aria-checked', 'true');
  // Tab: the checked profile, then the first box.
  await page.keyboard.press('Tab');
  await expect(profile(page, 'ng')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(box(page, 'wiskunde-a')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(box(page, 'wiskunde-b')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(box(page, 'wiskunde-b')).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(box(page, 'natuurkunde')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(box(page, 'natuurkunde')).toBeChecked();
  await expectDoor(page, 'electrical-engineer', 'open');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=ng&x=wb.na&l=en');
  await page.keyboard.press('Space');
  await expect(box(page, 'natuurkunde')).not.toBeChecked();
  await expect(page.getByRole('radiogroup', { name: 'My school level' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'My profile' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'My subjects on top of the profile' })).toBeVisible();
});

test('the hash round-trips: a link, a reload, a hash change, garbage and keys of other pages', async ({ page }) => {
  await openExam(page, '#n=vwo&p=ng&x=na.wb&l=en');
  await expect(box(page, 'natuurkunde')).toBeChecked();
  await expect(box(page, 'wiskunde-b')).toBeChecked();
  await expect(box(page, 'wiskunde-a')).not.toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=ng&x=wb.na&l=en');
  await page.reload();
  await expect(box(page, 'wiskunde-b')).toBeChecked();
  expect(await hash(page)).toBe('#n=vwo&p=ng&x=wb.na&l=en');

  await page.evaluate(() => (location.hash = '#n=havo&p=cm&x=wa&l=ua'));
  await expect(profile(page, 'cm')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'wiskunde-a')).toBeChecked();
  await expect(box(page, 'natuurkunde')).not.toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');

  await openExam(page, '#n=mavo&p=zorg&x=zz.na.na.NA&l=nl');
  await expect(level(page, 'havo')).toHaveAttribute('aria-checked', 'true');
  await expect(profile(page, 'none')).toHaveAttribute('aria-checked', 'true');
  await expect(box(page, 'natuurkunde')).toBeChecked();
  await expect.poll(() => hash(page)).toBe('#n=havo&x=na&l=nl');

  await openExam(page, '#s=8876677665&g=arts&n=vwo&p=em&x=na.wb&v=1');
  await expect(profile(page, 'em')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=em&x=wb.na');
});

test('a door opens the card: the programme, your line, the rule in words, the check, when to apply', async ({ page }) => {
  await openExam(page, '#n=havo&p=cm&x=wa&l=nl');
  const mecha = door(page, 'mechatronica-engineer');
  await mecha.focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Mechatronica- / robotica-engineer');
  await expect(card.locator('.card-close')).toBeFocused();
  await expect(card.locator('.state-pill')).toHaveText('met een extra stap: extra vak natuurkunde');
  await expect(card.locator('.card-programme')).toHaveText('Opleiding: Mechatronica');
  await expect(card.getByRole('heading', { level: 3, name: 'Toelating vanaf havo' })).toBeVisible();
  await expect(card.locator('.admission-lines li')).toHaveText([
    'Met C&M en wiskunde A heb je nog nodig: natuurkunde.',
    'Direct met N&T.',
    'Met N&G of E&M: ook natuurkunde, nlt, o&o of PgP-T.',
    'Met C&M: ook (wiskunde A of wiskunde B) en (natuurkunde, nlt, o&o of PgP-T).',
    'Deze pagina heeft geen vakje voor nlt (natuur, leven & technologie), o&o (onderzoek & ontwerpen) en PgP-T (Praktijkgerichte Programma Technologie): heb je zo’n vak, dan telt het waar de regel het noemt.',
    'Gecontroleerd met de toelatingsregeling (Ratho) van 1 september 2026, opleiding Mechatronica.',
  ]);
  await expect(card.getByRole('heading', { level: 3, name: 'Aanmelden' })).toBeVisible();
  await expect(card.locator('.apply-lines li')).toHaveText([
    'Voor een bacheloropleiding die in september begint, meld je je uiterlijk 1 mei aan via Studielink.',
    'Sommige opleidingen hebben een beperkt aantal plaatsen en selecteren: daarvoor meld je je uiterlijk 15 januari aan.',
    'Of een opleiding selecteert of een andere datum heeft, staat op de pagina van de opleiding zelf.',
    'Landelijke aanmelddata, gecontroleerd op rijksoverheid.nl in november 2026.',
  ]);
  await expect(card.locator('.card-pay')).toBeVisible();
  // No links on the card: the dates are plain text.
  await expect(card.locator('a')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(mecha).toBeFocused();

  // An mbo card: the mbo date, no admission section; a job without a diploma: no dates.
  const kok = door(page, 'kok');
  await kok.click();
  await expect(card.locator('.admission-lines')).toHaveCount(0);
  await expect(card.locator('.apply-lines li')).toHaveText([
    'Voor het mbo meld je je uiterlijk 1 april aan bij de mbo-school zelf.',
    'Sommige opleidingen stellen extra eisen of hebben een beperkt aantal plaatsen: kijk op de site van de school.',
    'Landelijke aanmelddata, gecontroleerd op rijksoverheid.nl in november 2026.',
  ]);
  await card.locator('.card-close').click();
  await expect(kok).toBeFocused();
  await door(page, 'schoonmaker').click();
  await expect(card.locator('.card-apply')).toHaveCount(0);
});

test('the card says what you have and what is missing, by the rule of your level', async ({ page }) => {
  await openExam(page, '#n=vwo&p=ng&x=na&l=en');
  await door(page, 'electrical-engineer').click();
  const card = page.getByRole('dialog');
  await expect(card.getByRole('heading', { level: 3, name: 'Admission from vwo' })).toBeVisible();
  await expect(card.locator('.admission-lines li')).toHaveText([
    'With N&G and physics you still need: maths B.',
    'Directly with N&T.',
    'With N&G, E&M or C&M: physics and maths B as well.',
    'With N&G some universities let you catch up physics and maths B (wiskunde B) in the first year.',
    'Checked against the Dutch admission regulation (Ratho) of 1 September 2026, programme Electrical Engineering.',
  ]);
  await page.keyboard.press('Escape');

  await box(page, 'wiskunde-b').check();
  await door(page, 'electrical-engineer').click();
  await expect(card.locator('.admission-lines li').first()).toHaveText('With N&G and maths B and physics you meet the rule.');
  await page.keyboard.press('Escape');

  await profile(page, 'em').click();
  await door(page, 'arts').click();
  await expect(card.locator('.admission-lines li')).toHaveText([
    'With E&M the rule gives no right to admission. If a test shows that you know enough, the programme may still let you in.',
    'With N&T: biology as well.',
    'With N&G: physics as well.',
    'With E&M or C&M: no right to admission.',
    'Checked against the Dutch admission regulation (Ratho) of 1 September 2026, programme Geneeskunde.',
  ]);
  await page.keyboard.press('Escape');

  // At havo, a wo card says that vwo 5 or an hbo first year comes first.
  await level(page, 'havo').click();
  await door(page, 'apotheker').click();
  await expect(card.locator('.admission-lines li').nth(0)).toHaveText('From havo, vwo 5 or a first year of hbo comes first; then this rule applies.');
  await expect(card.locator('.admission-lines li').nth(1)).toHaveText('With E&M and physics you still need: chemistry.');
  await page.keyboard.press('Escape');

  // An hbo programme without a row for vwo pupils admits every profile.
  await level(page, 'vwo').click();
  await profile(page, 'cm').click();
  await door(page, 'software-engineer').click();
  await expect(card.locator('.admission-lines li')).toHaveText([
    'Your profile C&M gets you in.',
    'Every profile gets you in directly.',
    'Checked against the Dutch admission regulation (Ratho) of 1 September 2026: it has no extra profile rules for Technische Informatica.',
  ]);
});

test('the links between the four pages carry the language and nothing else', async ({ page }) => {
  // Without a chosen language nothing is carried: not the level, the profile or the subjects.
  await openExam(page, '#n=vwo&p=ng&x=na');
  const links = page.locator('a.other-page');
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute('href', './#');
  await expect(links.nth(1)).toHaveAttribute('href', 'deuren.html#');
  await expect(links.nth(2)).toHaveAttribute('href', 'onderbouw.html#');

  await openExam(page, '#n=vwo&p=ng&x=na&l=nl');
  await expect(links.nth(0)).toHaveText('Voor groep 6-8: gebouw');
  await expect(links.nth(0)).toHaveAttribute('href', './#l=nl');
  await expect(links.nth(1)).toHaveText('Voor groep 6-8: deuren');
  await expect(links.nth(1)).toHaveAttribute('href', 'deuren.html#l=nl');
  await expect(links.nth(2)).toHaveText('Voor de onderbouw (klas 1-3)');
  await expect(links.nth(2)).toHaveAttribute('href', 'onderbouw.html#l=nl');

  // To the onderbouw view and back: the language only.
  await links.nth(2).click();
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
  expect(new URL(page.url()).pathname).toBe('/onderbouw.html');
  await expect.poll(() => hash(page)).toBe('#n=havo&l=nl');
  const toExam = page.locator('a.other-page').nth(2);
  await expect(toExam).toHaveText('Voor de bovenbouw (na de profielkeuze)');
  await expect(toExam).toHaveAttribute('href', 'bovenbouw.html#l=nl');
  await toExam.click();
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
  expect(new URL(page.url()).pathname).toBe('/bovenbouw.html');
  await expect.poll(() => hash(page)).toBe('#n=havo&l=nl');

  // From the building and from the doors view.
  await page.locator('a.other-page').nth(0).click();
  await expect(page.locator('.tile')).toHaveCount(TOTAL_TILES);
  const fromBuilding = page.locator('a.other-page').nth(1);
  await expect(fromBuilding).toHaveAttribute('href', 'bovenbouw.html#l=nl');
  await page.locator('a.other-view').click();
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
  expect(new URL(page.url()).pathname).toBe('/deuren.html');
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  const fromDoors = page.locator('a.other-page').nth(1);
  await expect(fromDoors).toHaveText('For the upper years, after the profile choice');
  await expect(fromDoors).toHaveAttribute('href', 'bovenbouw.html#l=en');
  await fromDoors.click();
  await expect(page.locator('.door')).toHaveCount(TOTAL_TILES);
  expect(new URL(page.url()).pathname).toBe('/bovenbouw.html');
  await expect(page).toHaveTitle('Wat word ik? - Secondary, upper years');
});

test('the language switch changes the texts, and the address keeps the subjects', async ({ page }) => {
  await openExam(page, '#n=vwo&p=ng&x=na');
  await expect(page.locator('.choice-extras legend')).toHaveText('My subjects on top of the profile');
  await expect(box(page, 'natuurkunde').locator('xpath=..')).toHaveText('physics');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=ng&x=na');
  await page.getByRole('button', { name: 'NL', exact: true }).click();
  await expect(page.locator('.choice-extras legend')).toHaveText('Mijn examenvakken naast mijn profiel');
  await expect(box(page, 'natuurkunde').locator('xpath=..')).toHaveText('natuurkunde');
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=ng&x=na&l=nl');
  await page.getByRole('button', { name: 'UA', exact: true }).click();
  await expect(page.locator('.choice-extras legend')).toHaveText('Мої предмети понад профіль');
  await expect(box(page, 'natuurkunde').locator('xpath=..')).toHaveText('фізика');
  await expect(page).toHaveTitle('Wat word ik? - Старші класи середньої школи');
  await expect.poll(() => hash(page)).toBe('#n=vwo&p=ng&x=na&l=ua');
});

for (const lang of ['nl', 'en', 'ua'] as const) {
  test(`no serious or critical accessibility issues: doors, buttons, boxes, card, "How it works" (${lang})`, async ({ page }) => {
    await openExam(page, `#n=havo&l=${lang}`);
    expect(await seriousA11yIssues(page), 'page without a profile').toEqual([]);
    await profile(page, 'cm').click();
    await box(page, 'wiskunde-a').check();
    expect(await seriousA11yIssues(page), 'page with a profile and a subject').toEqual([]);

    await page.locator('.door.is-closed').first().click();
    await expect(page.locator('.card-dialog')).toBeVisible();
    expect(await seriousA11yIssues(page), 'open card').toEqual([]);
    await page.keyboard.press('Escape');

    await page.locator('.help-btn').click();
    await expect(page.locator('.about-dialog')).toBeVisible();
    expect(await seriousA11yIssues(page), '"How it works" dialog').toEqual([]);
  });
}

test('"How it works" explains the boxes, the rule and the dates, and gives focus back', async ({ page }) => {
  await openExam(page, '#l=en');
  const help = page.locator('.help-btn');
  await help.click();
  const about = page.locator('.about-dialog');
  await expect(about).toBeVisible();
  await expect(about).toContainText('This page has no box for them; the card names them in words.');
  await expect(about).toContainText('for a bachelor’s programme by 1 May through Studielink');
  await expect(about).toContainText('per institution and per year');
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();
  await expect(help).toBeFocused();
});

// Every screen: nothing scrolls sideways. The page may scroll down.
async function checkExamFit(page: Page, desktop: boolean, font: string): Promise<void> {
  const sizes = desktop
    ? [{ width: 1280, height: 800 }, { width: 1366, height: 768 }, { width: 900, height: 700 }]
    : [{ width: 390, height: 844 }, { width: 375, height: 812 }, { width: 360, height: 640 }, { width: 320, height: 568 }, { width: 768, height: 1024 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const lang of ['nl', 'en', 'ua']) {
      for (const state of [`#n=havo&l=${lang}`, `#n=bbkb&p=groen&l=${lang}`, `#n=vwo&p=cm&x=wa.wb.na.sk.bi&l=${lang}`, `#n=havo&p=ng&x=wa&l=${lang}`]) {
        await openExam(page, state);
        await settle(page);
        const m = await page.evaluate(() => {
          const el = document.documentElement;
          const right = Math.max(
            ...[...document.querySelectorAll('.door, .choice-btn, .extra-btn, .block')].map((e) => e.getBoundingClientRect().right),
          );
          return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right };
        });
        const where = `${size.width}x${size.height}, ${state}, ${font}`;
        expect(m.scrollWidth, `horizontal scroll (${where})`).toBeLessThanOrEqual(m.clientWidth);
        expect(m.right, `content beyond the right edge (${where})`).toBeLessThanOrEqual(m.clientWidth);
      }
    }
  }
}

test('the bovenbouw view fits the screen without sideways scrolling', async ({ page }, testInfo) => {
  await checkExamFit(page, testInfo.project.name === 'desktop', 'system font');
});

// As on the onderbouw view: a wider system font (Linux in CI) must not push it past the
// edge, on desktop sizes too.
test('with a wide system font the bovenbouw view fits too, on desktop and on phones', async ({ page }, testInfo) => {
  await useWideFont(page);
  await openExam(page);
  await expectWideFont(page);
  await checkExamFit(page, testInfo.project.name === 'desktop', 'wide font');
});

test('the card fits a phone screen without sideways scrolling, in every language', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const lang of ['nl', 'en', 'ua']) {
    await openExam(page, `#n=havo&p=cm&x=wa&l=${lang}`);
    await door(page, 'mechatronica-engineer').click();
    await expect(page.locator('.card-dialog')).toBeVisible();
    await settle(page);
    const m = await page.evaluate(() => {
      const card = document.querySelector('.card-dialog');
      return card ? { scrollWidth: card.scrollWidth, clientWidth: card.clientWidth } : null;
    });
    expect(m, lang).not.toBeNull();
    expect(m!.scrollWidth, `card scrolls sideways (${lang})`).toBeLessThanOrEqual(m!.clientWidth);
  }
});
