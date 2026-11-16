import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUBJECT_IDS } from '../engine/types';

/*
 * The store reads location, history, document and window. Tests run in Node, so each test
 * loads a fresh copy of the module against small stand-ins for those globals.
 */

interface LoadOptions {
  readonly languages?: readonly string[];
  readonly reducedMotion?: boolean;
  readonly replaceThrows?: boolean;
  /** Navigation Timing type of this page load; null = no entry. */
  readonly navigation?: string | null;
  /** Which page runs the store; the floors view by default. */
  readonly view?: 'floors' | 'doors';
}

async function load(hash = '', options: LoadOptions = {}) {
  vi.resetModules();
  const loc = { hash };
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    if (options.replaceThrows) throw new Error('SecurityError: too many calls to replaceState');
    loc.hash = url;
  });
  const win = new EventTarget();
  vi.stubGlobal('location', loc);
  vi.stubGlobal('history', { state: null, replaceState });
  const doc = { documentElement: { lang: '' }, title: '' };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { languages: options.languages ?? ['de-DE'] });
  vi.stubGlobal('matchMedia', () => ({ matches: options.reducedMotion ?? false }));
  const navigation = options.navigation === undefined ? 'navigate' : options.navigation;
  const real = globalThis.performance;
  vi.stubGlobal('performance', {
    now: () => real.now(),
    getEntriesByType: (kind: string) => (kind === 'navigation' && navigation !== null ? [{ type: navigation }] : []),
  });
  const store = await import('./store');
  store.startSync(options.view ?? 'floors');
  const navigate = (next: string) => {
    loc.hash = next;
    win.dispatchEvent(new Event('hashchange'));
  };
  return { store, loc, doc, replaceState, navigate };
}

const uniform = (v: number) => Object.fromEntries(SUBJECT_IDS.map((s) => [s, v]));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('hash write', () => {
  it('is debounced: one replaceState after the sliders rest', async () => {
    const { store, replaceState, loc } = await load('');
    expect(replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(loc.hash).toBe('#s=6666666666');

    store.setSlider('wiskunde', 7);
    vi.advanceTimersByTime(100);
    store.setSlider('wiskunde', 8);
    vi.advanceTimersByTime(100);
    store.setSlider('kunst', 1);
    vi.advanceTimersByTime(store.HASH_DELAY_MS - 1);
    expect(replaceState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(replaceState).toHaveBeenCalledTimes(2);
    expect(loc.hash).toBe('#s=8666666661');
  });

  it('keeps working when replaceState throws (Safari rate limit)', async () => {
    const { store, replaceState } = await load('', { replaceThrows: true });
    expect(() => vi.advanceTimersByTime(store.HASH_DELAY_MS)).not.toThrow();
    expect(replaceState).toHaveBeenCalledTimes(1);
    store.setSlider('wiskunde', 9);
    expect(() => vi.advanceTimersByTime(store.HASH_DELAY_MS)).not.toThrow();
    expect(store.sliders.value.wiskunde).toBe(9);
    expect(store.counts.value.open).toBeGreaterThan(0);
  });
});

describe('language in the hash', () => {
  it('a guessed browser language is used but not written to the hash', async () => {
    const { store, loc } = await load('#s=6666666666', { languages: ['uk-UA'] });
    expect(store.lang.value).toBe('ua');
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#s=6666666666');
  });

  it('is written once the user picks a language', async () => {
    const { store, loc } = await load('');
    store.setLang('nl');
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#s=6666666666&l=nl');
  });

  it('a language that came with the link stays in the hash', async () => {
    const { store, loc } = await load('#s=6666666666&l=ua', { languages: ['en'] });
    expect(store.lang.value).toBe('ua');
    store.setSlider('engels', 7);
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#s=6666676666&l=ua');
  });
});

describe('presets', () => {
  it('animate one step per tick to the target, then stop', async () => {
    const { store } = await load('');
    store.applyPreset(9);
    expect(store.sliders.value).toEqual(uniform(6));
    vi.advanceTimersByTime(70);
    expect(store.sliders.value).toEqual(uniform(7));
    vi.advanceTimersByTime(140);
    expect(store.sliders.value).toEqual(uniform(9));
    vi.advanceTimersByTime(1000);
    expect(store.sliders.value).toEqual(uniform(9));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a manual slider change cancels the animation', async () => {
    const { store } = await load('');
    store.applyPreset(1);
    vi.advanceTimersByTime(70);
    expect(store.sliders.value.wiskunde).toBe(5);
    store.setSlider('kunst', 10);
    vi.advanceTimersByTime(1000);
    expect(store.sliders.value).toEqual({ ...uniform(5), kunst: 10 });
  });

  it('jump straight to the target with reduced motion', async () => {
    const { store } = await load('', { reducedMotion: true });
    store.applyPreset(3);
    expect(store.sliders.value).toEqual(uniform(3));
  });
});

describe('hashchange', () => {
  it('applies the new state and stops a running preset', async () => {
    const { store, navigate } = await load('');
    store.applyPreset(9);
    vi.advanceTimersByTime(70);
    navigate('#s=a666666661&g=arts&l=nl');
    vi.advanceTimersByTime(1000);
    expect(store.sliders.value).toEqual({ ...uniform(6), wiskunde: 10, kunst: 1 });
    expect(store.goal.value).toBe('arts');
    expect(store.lang.value).toBe('nl');
  });

  it('keeps the current language when the new hash has none', async () => {
    const { store, navigate, loc } = await load('');
    store.setLang('ua');
    navigate('#s=7777777777');
    expect(store.lang.value).toBe('ua');
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#s=7777777777&l=ua');
  });
});

describe('"grades from a link" notice', () => {
  it('shows when the page opens with grades in the hash', async () => {
    expect((await load('#s=8888888888')).store.fromLink.value).toBe(true);
    expect((await load('#s=8888888888&g=arts&l=nl')).store.fromLink.value).toBe(true);
  });

  it('does not show on a reload, a restored tab or a back/forward step', async () => {
    // The page wrote s= into its own address: these are the user's own grades.
    expect((await load('#s=8888888888', { navigation: 'reload' })).store.fromLink.value).toBe(false);
    expect((await load('#s=8888888888', { navigation: 'back_forward' })).store.fromLink.value).toBe(false);
  });

  it('does not show when the browser gives no navigation type', async () => {
    expect((await load('#s=8888888888', { navigation: null })).store.fromLink.value).toBe(false);
  });

  it('does not show without valid grades in the hash', async () => {
    expect((await load('')).store.fromLink.value).toBe(false);
    expect((await load('#l=nl&g=arts')).store.fromLink.value).toBe(false);
    expect((await load('#s=88888')).store.fromLink.value).toBe(false);
  });

  it('disappears after the first slider change', async () => {
    const { store } = await load('#s=8888888888');
    store.setSlider('wiskunde', 7);
    expect(store.fromLink.value).toBe(false);
  });

  it('disappears after a preset', async () => {
    const { store } = await load('#s=8888888888');
    store.applyPreset(6);
    expect(store.fromLink.value).toBe(false);
  });

  it('can be dismissed', async () => {
    const { store } = await load('#s=8888888888');
    store.dismissFromLink();
    expect(store.fromLink.value).toBe(false);
  });

  it('shows again when a new link brings other grades', async () => {
    const { store, navigate } = await load('');
    navigate('#s=6666666666&g=arts');
    expect(store.fromLink.value).toBe(false);
    navigate('#s=9999999999');
    expect(store.fromLink.value).toBe(true);
  });
});

describe('switching views (the view-switch marker v=1)', () => {
  it('a page opened with the marker shows the grades as the user\'s own', async () => {
    expect((await load('#s=8888888888&v=1')).store.fromLink.value).toBe(false);
    expect((await load('#s=8888888888&g=arts&l=nl&v=1', { view: 'doors' })).store.fromLink.value).toBe(false);
  });

  it('only the exact marker counts', async () => {
    expect((await load('#s=8888888888&v=0')).store.fromLink.value).toBe(true);
    expect((await load('#s=8888888888&v=11')).store.fromLink.value).toBe(true);
    expect((await load('#s=8888888888&V=1')).store.fromLink.value).toBe(true);
  });

  it('carries no state and leaves the address on the first write', async () => {
    const { store, loc, replaceState } = await load('#s=8888888888&g=arts&l=nl&v=1');
    expect(store.sliders.value).toEqual(uniform(8));
    expect(store.goal.value).toBe('arts');
    expect(store.lang.value).toBe('nl');
    expect(loc.hash).toBe('#s=8888888888&g=arts&l=nl&v=1');
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(loc.hash).toBe('#s=8888888888&g=arts&l=nl');
  });

  it('leaves the address also when the rest of the hash is not valid', async () => {
    const { store, loc } = await load('#s=88888&v=1');
    expect(store.fromLink.value).toBe(false);
    expect(store.sliders.value).toEqual(uniform(6));
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#s=6666666666');
  });

  it('the link to the other view adds it while the grades are the user\'s own', async () => {
    const own = await load('');
    expect(own.store.otherViewHash.value).toBe('#s=6666666666&v=1');
    own.store.setSlider('wiskunde', 7);
    own.store.setLang('ua');
    expect(own.store.otherViewHash.value).toBe('#s=7666666666&l=ua&v=1');

    const opened = await load('#s=8888888888&v=1');
    expect(opened.store.otherViewHash.value).toBe('#s=8888888888&v=1');
  });

  it('the link to the other view leaves it out while the notice shows, so the notice carries over', async () => {
    const { store } = await load('#s=8888888888&g=arts');
    expect(store.fromLink.value).toBe(true);
    expect(store.otherViewHash.value).toBe('#s=8888888888&g=arts');
    store.setSlider('wiskunde', 7);
    expect(store.otherViewHash.value).toBe('#s=7888888888&g=arts&v=1');
  });

  it('the link to the other view adds it after the notice is dismissed', async () => {
    const { store } = await load('#s=8888888888');
    store.dismissFromLink();
    expect(store.otherViewHash.value).toBe('#s=8888888888&v=1');
  });

  it('is read only when the page loads: a later hash change with other grades still shows the notice', async () => {
    const { store, navigate, loc } = await load('');
    navigate('#s=9999999999&v=1');
    expect(store.fromLink.value).toBe(true);
    vi.advanceTimersByTime(store.HASH_DELAY_MS);
    expect(loc.hash).toBe('#s=9999999999');
  });
});

describe('document title', () => {
  it('the floors view keeps its title', async () => {
    for (const [l, title] of [
      ['nl', 'Wat word ik? · Schuif en zie welke deuren kennis opent'],
      ['en', 'Wat word ik? · Drag the sliders - see what knowledge opens up'],
      ['ua', 'Wat word ik? · Тягни повзунки - дивись, що відкривають знання'],
    ] as const) {
      expect((await load(`#s=6666666666&l=${l}`)).doc.title).toBe(title);
    }
  });

  it('the doors view has its own title in each language', async () => {
    for (const [l, title] of [
      ['nl', 'Wat word ik? - Deuren'],
      ['en', 'Wat word ik? - Doors'],
      ['ua', 'Wat word ik? - Двері'],
    ] as const) {
      expect((await load(`#s=6666666666&l=${l}`, { view: 'doors' })).doc.title).toBe(title);
    }
  });

  it('follows the language switch', async () => {
    const { store, doc } = await load('#l=nl', { view: 'doors' });
    store.setLang('en');
    expect(doc.title).toBe('Wat word ik? - Doors');
  });
});
