import { batch, computed, effect, signal } from '@preact/signals';
import { PROFESSIONS } from '../data/professions';
import { decodeRouteHash, encodeRouteHash, langFragment, type RouteHashState } from '../engine/hash';
import { isVmbo, profileCounts, routeCounts, routeOf, validProfile, type ProfileCount, type RouteCounts, type RouteView } from '../engine/route';
import type { SchoolLevel, SchoolProfile } from '../engine/types';
import { HTML_LANG } from '../i18n';
import { HASH_DELAY_MS, lang, langChosen, pageTitle } from './store';

/*
 * State of the onderbouw view (onderbouw.html): the school level and the profile, in
 * signals and in the URL hash only (`#n=havo&p=nt&l=nl`, see engine/hash.ts). The
 * language, its switch and the "How it works" flag are the ones in store.ts, which
 * reads `l` from the same hash. Nothing is written to cookies, storage or any server.
 *
 * The bovenbouw view (bovenbouw.html) reads the same `n` and `p` and uses the level,
 * the profile, the open card and the memory of each family from here; its own subjects,
 * doors and hash are in examStore.ts. Each page starts only its own sync.
 */

const initial = decodeRouteHash(typeof location === 'undefined' ? '' : location.hash);

export const level = signal<SchoolLevel>(initial.level);
export const profile = signal<SchoolProfile | null>(initial.profile);
/** Profession whose card is open. Not part of the hash. */
export const selected = signal<string | null>(null);

export const routeViews = computed<ReadonlyMap<string, RouteView>>(
  () => new Map(PROFESSIONS.map((p) => [p.id, routeOf(p, level.value, profile.value)])),
);
export const totals = computed<RouteCounts>(() => routeCounts(routeViews.value.values()));
/** The count on each profile button of the current level. */
export const counts = computed<readonly ProfileCount[]>(() => profileCounts(PROFESSIONS, level.value));

/** The two families of levels that share their profiles: vmbo (bb/kb, gl/tl) and havo/vwo. */
type Family = 'vmbo' | 'havovwo';

const familyOf = (l: SchoolLevel): Family => (isVmbo(l) ? 'vmbo' : 'havovwo');

/**
 * The last profile chosen in each family, in memory only (not in the hash, not in
 * storage), so that moving through the level row with the arrow keys, which changes
 * the level on every step, does not lose a havo/vwo profile while it passes vmbo.
 */
export const lastProfile = signal<Readonly<Record<Family, SchoolProfile | null>>>({
  vmbo: null,
  havovwo: null,
  [familyOf(initial.level)]: initial.profile,
});

function remember(l: SchoolLevel, p: SchoolProfile | null): void {
  lastProfile.value = { ...lastProfile.value, [familyOf(l)]: p };
}

/**
 * A new level of the same family keeps the profile (havo <-> vwo, bb/kb <-> gl/tl);
 * a level of the other family brings back the last profile chosen there, or none.
 */
export function setLevel(next: SchoolLevel): void {
  batch(() => {
    const same = familyOf(next) === familyOf(level.value);
    level.value = next;
    profile.value = validProfile(next, same ? profile.value : lastProfile.value[familyOf(next)]);
  });
}

export function setProfile(next: SchoolProfile | null): void {
  batch(() => {
    profile.value = validProfile(level.value, next);
    remember(level.value, profile.value);
  });
}

/** A hash change: the level, the profile (remembered for its family) and a language that came with it. */
export function applyRouteHash(d: RouteHashState): void {
  batch(() => {
    level.value = d.level;
    profile.value = d.profile;
    remember(d.level, d.profile);
    if (d.lang) {
      lang.value = d.lang;
      langChosen.value = true;
    }
  });
}

/** The hash this page writes for its state. */
export const routeHash = computed(() =>
  encodeRouteHash({ level: level.value, profile: profile.value, lang: langChosen.value ? lang.value : null }),
);

/** What the links to the grade views carry: the language, when it was chosen. */
export const linkFragment = computed(() => langFragment(langChosen.value ? lang.value : null));

let started = false;

export function startRouteSync(): void {
  if (started) return;
  started = true;

  effect(() => {
    document.documentElement.lang = HTML_LANG[lang.value];
    document.title = pageTitle('onderbouw', lang.value);
  });

  // The first write also drops what this page does not own (s, g, v) from the address.
  let timer: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    const hash = routeHash.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (location.hash === hash) return;
      try {
        history.replaceState(history.state, '', hash);
      } catch {
        // Safari throws when replaceState runs too often; the address catches up on the next change.
      }
    }, HASH_DELAY_MS);
  });

  window.addEventListener('hashchange', () => applyRouteHash(decodeRouteHash(location.hash)));
}
