import { evaluate, type Deficit, type Evaluation } from './scoring';
import type { Profession, Sliders, SubjectId } from './types';

/** Language-free hint items; the UI turns them into sentences. */
export type Gap =
  | { readonly kind: 'subject'; readonly subject: SubjectId; readonly have: number; readonly need: number; readonly points: number }
  | { readonly kind: 'average'; readonly points: number };

/** Why a profession is not open: every subject deficit, plus the general level if it is short. */
export function why(p: Profession, sliders: Sliders): Gap[] {
  return gapsOf(evaluate(p, sliders));
}

export function gapsOf(e: Evaluation): Gap[] {
  const out: Gap[] = e.deficits.map((d: Deficit) => ({
    kind: 'subject' as const,
    subject: d.subject,
    have: d.have,
    need: d.need,
    points: d.need - d.have,
  }));
  // Points still missing on the average after the subject gaps are closed.
  const extra = e.avgGapPoints - e.subjectGap;
  if (e.avgGapPoints > 0 && extra > 0) out.push({ kind: 'average', points: extra });
  return out;
}

/** Up to `limit` gaps, largest first: "what to pay attention to now". */
export function focus(p: Profession, sliders: Sliders, limit = 3): Gap[] {
  return focusOf(evaluate(p, sliders), limit);
}

/** Same as `focus`, from an evaluation the caller already has. */
export function focusOf(e: Evaluation, limit = 3): Gap[] {
  return gapsOf(e)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

/** The family ladder of a profession, ordered by rung. */
export function ladder(professions: readonly Profession[], p: Profession): Profession[] {
  return professions.filter((q) => q.family === p.family).sort((a, b) => a.rung - b.rung);
}

export function nextRung(professions: readonly Profession[], p: Profession): Profession | undefined {
  return professions.find((q) => q.family === p.family && q.rung === p.rung + 1);
}
