import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The bovenbouw view's store, against small stand-ins for location, history, document
 * and window, as in routeStore.test.ts. It loads routeStore.ts (level and profile) and
 * store.ts (the language) too, but starts only its own sync.
 */

async function load(hash = '', languages: readonly string[] = ['de-DE']) {
  vi.resetModules();
  const loc = { hash };
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    loc.hash = url;
  });
  const win = new EventTarget();
  vi.stubGlobal('location', loc);
  vi.stubGlobal('history', { state: null, replaceState });
  const doc = { documentElement: { lang: '' }, title: '' };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { languages });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const exam = await import('./examStore');
  const route = await import('./routeStore');
  const store = await import('./store');
  exam.startExamSync();
  const navigate = (next: string) => {
    loc.hash = next;
    win.dispatchEvent(new Event('hashchange'));
  };
  const settle = () => vi.advanceTimersByTime(store.HASH_DELAY_MS);
  return { exam, route, store, loc, doc, replaceState, navigate, settle };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bovenbouw store', () => {
  it('opens on havo without a profile or subjects, and writes that once', async () => {
    const { exam, route, loc, replaceState, settle } = await load('');
    expect(route.level.value).toBe('havo');
    expect(route.profile.value).toBeNull();
    expect(exam.extras.value).toEqual([]);
    settle();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(loc.hash).toBe('#n=havo');
  });

  it('reads level, profile, subjects and language from the link and drops what it does not own', async () => {
    const { exam, route, store, loc, settle } = await load('#s=a666666661&g=arts&n=vwo&p=ng&x=na.zz.wb&l=ua&v=1');
    expect(route.level.value).toBe('vwo');
    expect(route.profile.value).toBe('ng');
    expect(exam.extras.value).toEqual(['wiskunde-b', 'natuurkunde']);
    expect(store.lang.value).toBe('ua');
    settle();
    expect(loc.hash).toBe('#n=vwo&p=ng&x=wb.na&l=ua');
  });

  it('a box adds or removes a subject; the hash keeps them in a fixed order', async () => {
    const { exam, loc, settle } = await load('#n=havo&p=cm');
    exam.setExtra('natuurkunde', true);
    exam.setExtra('wiskunde-a', true);
    exam.setExtra('natuurkunde', true);
    expect(exam.extras.value).toEqual(['wiskunde-a', 'natuurkunde']);
    settle();
    expect(loc.hash).toBe('#n=havo&p=cm&x=wa.na');
    exam.setExtra('wiskunde-a', false);
    settle();
    expect(loc.hash).toBe('#n=havo&p=cm&x=na');
  });

  it('the doors and counts follow the subjects', async () => {
    const { exam, route } = await load('#n=havo&p=cm');
    expect(exam.examTotals.value.total).toBe(36);
    expect(exam.examViews.value.get('mechatronica-engineer')?.state).toBe('closed');
    const open = exam.examTotals.value.open;
    exam.setExtra('wiskunde-a', true);
    expect(exam.examViews.value.get('mechatronica-engineer')?.state).toBe('detour');
    exam.setExtra('natuurkunde', true);
    expect(exam.examViews.value.get('mechatronica-engineer')?.state).toBe('open');
    expect(exam.examTotals.value.open).toBeGreaterThan(open);
    expect(exam.examCounts.value.find((c) => c.profile === 'cm')?.count).toBe(28);
    route.setLevel('gltl');
    expect(exam.examCounts.value.map((c) => c.kind)).toEqual(['fits', 'fits', 'fits', 'fits']);
  });

  it('a vmbo level keeps the subjects in memory but out of the hash, and brings them back after', async () => {
    const { exam, route, loc, settle } = await load('#n=vwo&p=nt&x=bi');
    route.setLevel('gltl');
    settle();
    expect(loc.hash).toBe('#n=gltl');
    expect(exam.extras.value).toEqual(['biologie']);
    route.setLevel('vwo');
    settle();
    expect(loc.hash).toBe('#n=vwo&p=nt&x=bi');
  });

  it('follows a hash change, the subjects included', async () => {
    const { exam, route, store, navigate } = await load('#n=havo&p=em&x=na');
    navigate('#n=vwo&p=cm&x=wb.sk&l=en');
    expect(route.level.value).toBe('vwo');
    expect(route.profile.value).toBe('cm');
    expect(exam.extras.value).toEqual(['wiskunde-b', 'scheikunde']);
    expect(store.lang.value).toBe('en');
    navigate('#n=bbkb&p=groen&x=na');
    expect(route.profile.value).toBe('groen');
    expect(exam.extras.value).toEqual([]);
  });

  it('writes the language only once it was chosen', async () => {
    const { store, loc, settle } = await load('#n=vwo&x=na', ['uk-UA']);
    expect(store.lang.value).toBe('ua');
    settle();
    expect(loc.hash).toBe('#n=vwo&x=na');
    store.setLang('nl');
    settle();
    expect(loc.hash).toBe('#n=vwo&x=na&l=nl');
  });

  it('has its own title in each language, following the switch', async () => {
    for (const [l, title] of [
      ['nl', 'Wat word ik? - Bovenbouw'],
      ['en', 'Wat word ik? - Secondary, upper years'],
      ['ua', 'Wat word ik? - Старші класи середньої школи'],
    ] as const) {
      expect((await load(`#n=havo&l=${l}`)).doc.title).toBe(title);
    }
    const { store, doc } = await load('#l=nl');
    store.setLang('en');
    expect(doc.title).toBe('Wat word ik? - Secondary, upper years');
    expect(doc.documentElement.lang).toBe('en-GB');
  });
});
