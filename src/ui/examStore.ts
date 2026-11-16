import { batch, computed, effect, signal } from '@preact/signals';
import { PROFESSIONS } from '../data/professions';
import { examProfileCounts, examRouteOf } from '../engine/exam';
import { decodeExamHash, encodeExamHash } from '../engine/hash';
import { routeCounts, type ProfileCount, type RouteCounts, type RouteView } from '../engine/route';
import { EXAM_SUBJECTS, type ExamSubject } from '../engine/types';
import { HTML_LANG } from '../i18n';
import { applyRouteHash, level, profile } from './routeStore';
import { HASH_DELAY_MS, lang, langChosen, pageTitle } from './store';

/*
 * State of the bovenbouw view (bovenbouw.html). The level, the profile and the open card
 * are the signals of routeStore.ts; this module adds the exam subjects the pupil takes on
 * top of the profile, the doors judged with them, and the page's own hash
 * (`#n=vwo&p=ng&x=wb.na&l=nl`, see engine/hash.ts). Nothing is written to cookies,
 * storage or any server.
 *
 * The subjects stay in memory while the level row passes a vmbo level, which has no
 * boxes; there they count for nothing and stay out of the hash.
 */

const initial = decodeExamHash(typeof location === 'undefined' ? '' : location.hash);

/** The exam subjects on top of the profile, in the order of EXAM_SUBJECTS, each once. */
export const extras = signal<readonly ExamSubject[]>(initial.extras);

const extraSet = computed<ReadonlySet<ExamSubject>>(() => new Set(extras.value));

export function setExtra(subject: ExamSubject, on: boolean): void {
  const chosen = new Set(extras.value);
  if (on) chosen.add(subject);
  else chosen.delete(subject);
  extras.value = EXAM_SUBJECTS.filter((s) => chosen.has(s));
}

export const examViews = computed<ReadonlyMap<string, RouteView>>(
  () => new Map(PROFESSIONS.map((p) => [p.id, examRouteOf(p, level.value, profile.value, extraSet.value)])),
);
export const examTotals = computed<RouteCounts>(() => routeCounts(examViews.value.values()));
/** The count on each profile button of the current level, with the pupil's subjects. */
export const examCounts = computed<readonly ProfileCount[]>(() => examProfileCounts(PROFESSIONS, level.value, extraSet.value));

/** The hash this page writes for its state. */
export const examHash = computed(() =>
  encodeExamHash({
    level: level.value,
    profile: profile.value,
    extras: extras.value,
    lang: langChosen.value ? lang.value : null,
  }),
);

let started = false;

export function startExamSync(): void {
  if (started) return;
  started = true;

  effect(() => {
    document.documentElement.lang = HTML_LANG[lang.value];
    document.title = pageTitle('bovenbouw', lang.value);
  });

  // The first write also drops what this page does not own (s, g, v) from the address.
  let timer: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    const hash = examHash.value;
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
    const d = decodeExamHash(location.hash);
    batch(() => {
      applyRouteHash(d);
      extras.value = d.extras;
    });
  });
}
