import { evaluate, plusOne, type Evaluation } from './scoring';
import { FIELDS, SUBJECT_IDS, type Field, type Profession, type Sliders, type SubjectId } from './types';

/*
 * The doors view: the same engine, read as doors instead of floors.
 *
 *   open    the profession is open (scoring.ts: state 'open');
 *   ajar    one +1 on one slider opens it (stepsToOpen is exactly 1);
 *   closed  everything else ("not open yet").
 *
 * "Ajar" is stricter than the floors view's "nearly there" (up to 2 subject
 * points): it is always one single step, so the door can say which one.
 */

export type DoorState = 'open' | 'ajar' | 'closed';

/** The one +1 that opens an ajar door: a named subject, or any subject when only the average is short. */
export type DoorKey = { readonly kind: 'subject'; readonly subject: SubjectId } | { readonly kind: 'any' };

export interface DoorView {
  readonly state: DoorState;
  /** Set for ajar doors only. */
  readonly key: DoorKey | null;
}

/**
 * stepsToOpen === 1 means either one subject is one point short (raising it also lifts
 * the average by one point, which is all the average can lack then), or no subject is
 * short and the average lacks one point, which any slider below the maximum gives.
 */
export function doorOf(e: Evaluation): DoorView {
  if (e.state === 'open') return { state: 'open', key: null };
  if (e.stepsToOpen !== 1) return { state: 'closed', key: null };
  const first = e.deficits[0];
  return { state: 'ajar', key: first ? { kind: 'subject', subject: first.subject } : { kind: 'any' } };
}

export interface DoorCounts {
  readonly open: number;
  readonly ajar: number;
  readonly closed: number;
  readonly total: number;
}

export function doorCounts(views: Iterable<DoorView>): DoorCounts {
  let open = 0;
  let ajar = 0;
  let closed = 0;
  for (const v of views) {
    if (v.state === 'open') open++;
    else if (v.state === 'ajar') ajar++;
    else closed++;
  }
  return { open, ajar, closed, total: open + ajar + closed };
}

/**
 * The one line that makes effort visible:
 *   plusOne  the single +1 that opens the most doors (ties: the first subject in
 *            SUBJECT_IDS order), with how many it opens;
 *   next     no single +1 opens a door: the door that needs the fewest +1 steps
 *            (ties: the first id in alphabetical order), with that number;
 *   allOpen  every door is open.
 */
export type NextStep =
  | { readonly kind: 'plusOne'; readonly subject: SubjectId; readonly opens: number }
  | { readonly kind: 'next'; readonly profession: Profession; readonly points: number }
  | { readonly kind: 'allOpen' };

export function nextStep(professions: readonly Profession[], sliders: Sliders): NextStep {
  let best: { subject: SubjectId; opens: number } | null = null;
  for (const subject of SUBJECT_IDS) {
    const opens = plusOne(professions, sliders, subject).length;
    if (opens > 0 && (best === null || opens > best.opens)) best = { subject, opens };
  }
  if (best) return { kind: 'plusOne', ...best };

  let closest: { profession: Profession; points: number } | null = null;
  for (const p of professions) {
    const e = evaluate(p, sliders);
    if (e.state === 'open') continue;
    const points = e.stepsToOpen;
    if (closest === null || points < closest.points || (points === closest.points && p.id < closest.profession.id)) {
      closest = { profession: p, points };
    }
  }
  return closest ? { kind: 'next', ...closest } : { kind: 'allOpen' };
}

export interface FieldGroup {
  readonly field: Field;
  readonly professions: readonly Profession[];
}

/**
 * Doors grouped by field, in FIELDS order; inside a group alphabetically by `nameOf`
 * (the shown name in the page language), with the id as a tie-break. Never by level or pay.
 */
export function groupByField(
  professions: readonly Profession[],
  nameOf: (p: Profession) => string,
  locale: string,
): FieldGroup[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return FIELDS.map((field) => ({
    field,
    professions: professions
      .filter((p) => p.field === field)
      .sort((a, b) => collator.compare(nameOf(a), nameOf(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  })).filter((g) => g.professions.length > 0);
}
