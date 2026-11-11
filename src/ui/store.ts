import { batch, computed, effect, signal } from '@preact/signals';
import { PROFESSIONS, PROFESSION_IDS } from '../data/professions';
import { decodeHash, encodeHash } from '../engine/hash';
import { evaluate, plusOne, withSlider, type Evaluation } from '../engine/scoring';
import { SUBJECT_IDS, type Lang, type Profession, type Sliders, type SubjectId } from '../engine/types';
import { HTML_LANG, detectLang, t } from '../i18n';

/*
 * App state lives in signals and in the URL hash only.
 * Nothing is written to cookies, localStorage or any server.
 */

const initial = decodeHash(typeof location === 'undefined' ? '' : location.hash, PROFESSION_IDS);

export const sliders = signal<Sliders>(initial.sliders);
export const goal = signal<string | null>(initial.goal);
export const lang = signal<Lang>(
  initial.lang ?? detectLang(typeof navigator === 'undefined' ? undefined : navigator.languages),
);
/** Profession whose card is open. Not part of the hash. */
export const selected = signal<string | null>(null);

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

let animation: number | undefined;

function stopAnimation(): void {
  if (animation !== undefined) {
    clearInterval(animation);
    animation = undefined;
  }
}

export function setSlider(subject: SubjectId, value: number): void {
  stopAnimation();
  sliders.value = withSlider(sliders.value, subject, value);
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Move every slider to `target`, one step at a time so the building visibly reacts. */
export function applyPreset(target: number): void {
  stopAnimation();
  const jump = () => {
    sliders.value = Object.fromEntries(SUBJECT_IDS.map((s) => [s, target])) as Sliders;
  };
  if (reducedMotion()) {
    jump();
    return;
  }
  animation = window.setInterval(() => {
    const cur = sliders.value;
    let done = true;
    const next = {} as Record<SubjectId, number>;
    for (const s of SUBJECT_IDS) {
      const v = cur[s];
      next[s] = v === target ? v : v + Math.sign(target - v);
      if (next[s] !== target) done = false;
    }
    sliders.value = next;
    if (done) stopAnimation();
  }, 70);
}

export function toggleGoal(id: string): void {
  goal.value = goal.value === id ? null : id;
}

export function setLang(l: Lang): void {
  lang.value = l;
}

// ── side effects: document language and the URL hash ──────────────────────

let started = false;

export function startSync(): void {
  if (started) return;
  started = true;

  effect(() => {
    document.documentElement.lang = HTML_LANG[lang.value];
    document.title = `${t(lang.value, 'app.title')} · ${t(lang.value, 'app.subtitle')}`;
  });

  // Debounced: Safari limits how often replaceState may be called while dragging.
  let timer: number | undefined;
  effect(() => {
    const hash = encodeHash({ sliders: sliders.value, goal: goal.value, lang: lang.value });
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (location.hash !== hash) history.replaceState(history.state, '', hash);
    }, 150);
  });

  window.addEventListener('hashchange', () => {
    const d = decodeHash(location.hash, PROFESSION_IDS);
    stopAnimation();
    batch(() => {
      sliders.value = d.sliders;
      goal.value = d.goal;
      if (d.lang) lang.value = d.lang;
    });
  });
}
