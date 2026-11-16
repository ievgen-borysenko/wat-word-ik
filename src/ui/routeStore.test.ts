import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The onderbouw view's store, against small stand-ins for location, history, document
 * and window, as in store.test.ts. It loads store.ts too, for the language.
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
  const route = await import('./routeStore');
  const store = await import('./store');
  route.startRouteSync();
  const navigate = (next: string) => {
    loc.hash = next;
    win.dispatchEvent(new Event('hashchange'));
  };
  return { route, store, loc, doc, replaceState, navigate };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('onderbouw store', () => {
  it('opens on havo without a profile, and writes that once', async () => {
    const { route, store, loc, replaceState } = await load('');
    expect(route.level.value).toBe('havo');
    expect(route.profile.value).toBeNull();
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(loc.hash).toBe('#n=havo');
  });

  it('reads level, profile and language from the link and drops what it does not own', async () => {
    const { route, store, loc } = await load('#s=a666666661&g=arts&n=vwo&p=ng&l=ua&v=1');
    expect(route.level.value).toBe('vwo');
    expect(route.profile.value).toBe('ng');
    expect(store.lang.value).toBe('ua');
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#n=vwo&p=ng&l=ua');
  });

  it('a new level keeps the profile only when it belongs to that level', async () => {
    const { route, store, loc } = await load('#n=havo&p=nt');
    route.setLevel('vwo');
    expect(route.profile.value).toBe('nt');
    route.setLevel('gltl');
    expect(route.profile.value).toBeNull();
    route.setProfile('zorg');
    route.setLevel('bbkb');
    expect(route.profile.value).toBe('zorg');
    route.setProfile('nt');
    expect(route.profile.value).toBeNull();
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#n=bbkb');
  });

  it('remembers the last profile of each family in memory, so passing the other family loses nothing', async () => {
    const { route, store, loc } = await load('#n=vwo&p=nt');
    // Arrowing through the level row: vwo -> bb/kb -> gl/tl -> havo.
    route.setLevel('bbkb');
    expect(route.profile.value).toBeNull();
    route.setLevel('gltl');
    expect(route.profile.value).toBeNull();
    route.setLevel('havo');
    expect(route.profile.value).toBe('nt');
    // The vmbo direction is remembered as well, and "not chosen yet" is a choice too.
    route.setLevel('gltl');
    route.setProfile('zorg');
    route.setLevel('vwo');
    expect(route.profile.value).toBe('nt');
    route.setProfile(null);
    route.setLevel('bbkb');
    expect(route.profile.value).toBe('zorg');
    route.setLevel('havo');
    expect(route.profile.value).toBeNull();
    // A hash change counts as a choice; nothing of the memory goes into the hash.
    route.setProfile('em');
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#n=havo&p=em');
    expect(route.lastProfile.value).toEqual({ vmbo: 'zorg', havovwo: 'em' });
  });

  it('a profile that came with the link is remembered for its family', async () => {
    const { route, navigate } = await load('#n=gltl&p=groen');
    route.setLevel('vwo');
    expect(route.profile.value).toBeNull();
    route.setLevel('bbkb');
    expect(route.profile.value).toBe('groen');
    navigate('#n=havo&p=cm');
    route.setLevel('gltl');
    route.setLevel('vwo');
    expect(route.profile.value).toBe('cm');
  });

  it('the doors and counts follow the choice', async () => {
    const { route } = await load('#n=vwo');
    expect(route.totals.value.total).toBe(36);
    route.setProfile('nt');
    const nt = route.totals.value.open;
    route.setProfile('cm');
    expect(route.totals.value.open).toBeLessThan(nt);
    expect(route.routeViews.value.get('arts')?.state).toBe('closed');
    expect(route.counts.value.map((c) => c.profile)).toEqual(['nt', 'ng', 'em', 'cm']);
    route.setLevel('gltl');
    expect(route.counts.value.map((c) => c.kind)).toEqual(['fits', 'fits', 'fits', 'fits']);
  });

  it('writes the language only once it was chosen, and the links carry only that', async () => {
    const { route, store, loc } = await load('#n=vwo', ['uk-UA']);
    expect(store.lang.value).toBe('ua');
    expect(route.linkFragment.value).toBe('');
    store.setLang('nl');
    expect(route.linkFragment.value).toBe('l=nl');
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#n=vwo&l=nl');
  });

  it('follows a hash change', async () => {
    const { route, store, navigate } = await load('#n=havo&p=em');
    navigate('#n=bbkb&p=groen&l=en');
    expect(route.level.value).toBe('bbkb');
    expect(route.profile.value).toBe('groen');
    expect(store.lang.value).toBe('en');
    navigate('#n=vwo');
    expect(route.profile.value).toBeNull();
    expect(store.lang.value).toBe('en');
  });

  it('has its own title in each language, following the switch', async () => {
    for (const [l, title] of [
      ['nl', 'Wat word ik? - Onderbouw'],
      ['en', 'Wat word ik? - Secondary years 1-3'],
      ['ua', 'Wat word ik? - 1-3 клас середньої школи'],
    ] as const) {
      expect((await load(`#n=havo&l=${l}`)).doc.title).toBe(title);
    }
    const { store, doc } = await load('#l=nl');
    store.setLang('en');
    expect(doc.title).toBe('Wat word ik? - Secondary years 1-3');
    expect(doc.documentElement.lang).toBe('en-GB');
  });
});
