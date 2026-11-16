import { batch, computed, effect, signal } from '@preact/signals';
import { PROFESSIONS } from '../data/professions';
import { decodeRouteHash, encodeRouteHash, langFragment } from '../engine/hash';
import { profileCounts, routeCounts, routeOf, validProfile, type ProfileCount, type RouteCounts, type RouteView } from '../engine/route';
import type { SchoolLevel, SchoolProfile } from '../engine/types';
import { HTML_LANG } from '../i18n';
import { HASH_DELAY_MS, lang, langChosen, pageTitle } from './store';

/*
 * State of the onderbouw view (onderbouw.html): the school level and the profile, in
 * signals and in the URL hash only (`#n=havo&p=nt&l=nl`, see engine/hash.ts). The
 * language, its switch and the "How it works" flag are the ones in store.ts, which
 * reads `l` from the same hash. Nothing is written to cookies, storage or any server.
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

/** A new level keeps the profile only when it belongs to that level too (havo <-> vwo, bb/kb <-> gl/tl). */
export function setLevel(next: SchoolLevel): void {
  batch(() => {
    level.value = next;
    profile.value = validProfile(next, profile.value);
  });
}

export function setProfile(next: SchoolProfile | null): void {
  profile.value = validProfile(level.value, next);
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

  window.addEventListener('hashchange', () => {
    const d = decodeRouteHash(location.hash);
    batch(() => {
      level.value = d.level;
      profile.value = d.profile;
      if (d.lang) {
        lang.value = d.lang;
        langChosen.value = true;
      }
    });
  });
}
