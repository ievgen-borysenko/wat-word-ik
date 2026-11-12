import { batch, computed, effect, signal } from '@preact/signals';
import { PROFESSIONS, PROFESSION_IDS } from '../data/professions';
import { decodeHash, encodeHash, encodeSliders, hashHasSliders } from '../engine/hash';
import { evaluate, plusOne, uniformSliders, withSlider, type Evaluation } from '../engine/scoring';
import { SUBJECT_IDS, type Lang, type Profession, type Sliders, type SubjectId } from '../engine/types';
import { HTML_LANG, detectLang, t } from '../i18n';

/*
 * App state lives in signals and in the URL hash only.
 * Nothing is written to cookies, localStorage or any server.
 */

const initialHash = typeof location === 'undefined' ? '' : location.hash;
const initial = decodeHash(initialHash, PROFESSION_IDS);

export const sliders = signal<Sliders>(initial.sliders);
export const goal = signal<string | null>(initial.goal);
export const lang = signal<Lang>(
  initial.lang ?? detectLang(typeof navigator === 'undefined' ? undefined : navigator.languages),
);
/**
 * True once the language came from the link or from the language switch.
 * Only then is it written to the hash: a guessed browser language stays out of shared links.
 */
export const langChosen = signal<boolean>(initial.lang !== null);
/**
 * How this page load started. The page writes `s=` into its own address, so a reload,
 * a restored tab or a back/forward step also opens with grades in the hash: only a fresh
 * navigation means the grades came with a link. No Navigation Timing entry: assume not.
 */
function freshNavigation(): boolean {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return false;
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return entry?.type === 'navigate';
}

/** The grades on screen came from a link (`s=` in the hash), not from this user. */
export const fromLink = signal<boolean>(hashHasSliders(initialHash) && freshNavigation());
/** Profession whose card is open. Not part of the hash. */
export const selected = signal<string | null>(null);
/** The "How it works" dialog is open. Not part of the hash. */
export const aboutOpen = signal<boolean>(false);

export const evaluations = computed<ReadonlyMap<string, Evaluation>>(
  () => new Map(PROFESSIONS.map((p) => [p.id, evaluate(p, sliders.value)])),
);

export const counts = computed(() => {
  let open = 0;
  let near = 0;
  for (const e of evaluations.value.values()) {
    if (e.state === 'open') open++;
    else if (e.state === 'near') near++;
  }
  return { open, near, total: PROFESSIONS.length };
});

const LEVEL0 = PROFESSIONS.filter((p) => p.level === 0).length;

/** Headline band 0..3, by how much of the building is open. */
export const band = computed<0 | 1 | 2 | 3>(() => {
  const { open, total } = counts.value;
  if (open <= LEVEL0) return 0;
  if (open < total * 0.4) return 1;
  if (open < total * 0.78) return 2;
  return 3;
});

export const plusOneBySubject = computed<Readonly<Record<SubjectId, Profession[]>>>(() => {
  const s = sliders.value;
  return Object.fromEntries(SUBJECT_IDS.map((id) => [id, plusOne(PROFESSIONS, s, id)])) as Record<
    SubjectId,
    Profession[]
  >;
});

// ── actions ────────────────────────────────────────────────────────────────

let animation: ReturnType<typeof setInterval> | undefined;

function stopAnimation(): void {
  if (animation !== undefined) {
    clearInterval(animation);
    animation = undefined;
  }
}

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setSlider(subject: SubjectId, value: number): void {
  stopAnimation();
  fromLink.value = false;
  sliders.value = withSlider(sliders.value, subject, value);
}

/** Move every slider to `target`, one step at a time so the building visibly reacts. */
export function applyPreset(target: number): void {
  stopAnimation();
  fromLink.value = false;
  const end = uniformSliders(target);
  if (reducedMotion()) {
    sliders.value = end;
    return;
  }
  animation = setInterval(() => {
    const cur = sliders.value;
    let done = true;
    const next = {} as Record<SubjectId, number>;
    for (const s of SUBJECT_IDS) {
      const v = cur[s];
      const want = end[s];
      next[s] = v === want ? v : v + Math.sign(want - v);
      if (next[s] !== want) done = false;
    }
    sliders.value = next;
    if (done) stopAnimation();
  }, 70);
}

export function toggleGoal(id: string): void {
  goal.value = goal.value === id ? null : id;
}

export function setLang(l: Lang): void {
  batch(() => {
    lang.value = l;
    langChosen.value = true;
  });
}

export function dismissFromLink(): void {
  fromLink.value = false;
}

// ── side effects: document language and the URL hash ──────────────────────

/** Delay before the hash follows the sliders: Safari limits how often replaceState may run. */
export const HASH_DELAY_MS = 150;

let started = false;

export function startSync(): void {
  if (started) return;
  started = true;

  effect(() => {
    document.documentElement.lang = HTML_LANG[lang.value];
    document.title = `${t(lang.value, 'app.title')} · ${t(lang.value, 'app.subtitle')}`;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    const hash = encodeHash({
      sliders: sliders.value,
      goal: goal.value,
      lang: langChosen.value ? lang.value : null,
    });
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (location.hash === hash) return;
      try {
        history.replaceState(history.state, '', hash);
      } catch {
        // Safari throws when replaceState runs too often. The page keeps working;
        // the address bar catches up on the next change.
      }
    }, HASH_DELAY_MS);
  });

  window.addEventListener('hashchange', () => {
    const d = decodeHash(location.hash, PROFESSION_IDS);
    const changed = encodeSliders(d.sliders) !== encodeSliders(sliders.value);
    stopAnimation();
    batch(() => {
      // Grades from a pasted link or a back/forward step: say where they came from.
      if (changed && hashHasSliders(location.hash)) fromLink.value = true;
      sliders.value = d.sliders;
      goal.value = d.goal;
      if (d.lang) {
        lang.value = d.lang;
        langChosen.value = true;
      }
    });
  });
}
