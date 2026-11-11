import {
  DEFAULT_GRADE,
  GRADE_MAX,
  GRADE_MIN,
  MIN_AVG,
  SUBJECT_IDS,
  type Profession,
  type Sliders,
  type State,
  type SubjectId,
} from './types';

/** "One step away": at most this many subject points missing in total... */
export const NEAR_SUBJECT_POINTS = 2;
/** ...and the average at most this far below the level gate. */
export const NEAR_AVG_GAP = 0.5;

const N = SUBJECT_IDS.length;

export interface Deficit {
  readonly subject: SubjectId;
  readonly have: number;
  readonly need: number;
}

export interface Evaluation {
  readonly state: State;
  /** Subjects below the required minimum, largest gap first. */
  readonly deficits: readonly Deficit[];
  /** Sum of (need - have) over `deficits`. */
  readonly subjectGap: number;
  readonly average: number;
  readonly minAvg: number;
  /** max(0, minAvg - average). */
  readonly avgDeficit: number;
  /** Points (slider steps of +1) the average still lacks, ignoring the subject gaps. */
  readonly avgGapPoints: number;
  /** Smallest number of +1 slider steps that would open the profession. */
  readonly stepsToOpen: number;
}

export function clampGrade(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_GRADE;
  return Math.min(GRADE_MAX, Math.max(GRADE_MIN, Math.round(v)));
}

export function uniformSliders(v: number): Sliders {
  const g = clampGrade(v);
  return Object.fromEntries(SUBJECT_IDS.map((s) => [s, g])) as Record<SubjectId, number>;
}

export function withSlider(sliders: Sliders, subject: SubjectId, value: number): Sliders {
  return { ...sliders, [subject]: clampGrade(value) };
}

export function sum(sliders: Sliders): number {
  let total = 0;
  for (const s of SUBJECT_IDS) total += sliders[s];
  return total;
}

export function average(sliders: Sliders): number {
  return sum(sliders) / N;
}

/**
 * Everything is computed on integer slider sums, so there are no
 * floating-point surprises at the gate boundaries (6.5 is 65 points).
 */
export function evaluate(p: Profession, sliders: Sliders): Evaluation {
  const deficits: Deficit[] = [];
  let subjectGap = 0;
  for (const n of p.needs) {
    const have = sliders[n.subject];
    if (have < n.min) {
      deficits.push({ subject: n.subject, have, need: n.min });
      subjectGap += n.min - have;
    }
  }
  deficits.sort((a, b) => b.need - b.have - (a.need - a.have));

  const minAvg = MIN_AVG[p.level];
  const total = sum(sliders);
  const avgGapPoints = Math.max(0, Math.ceil(Math.round(minAvg * N * 1000) / 1000 - total));
  const avgDeficit = avgGapPoints / N;

  let state: State;
  if (subjectGap === 0 && avgGapPoints === 0) state = 'open';
  else if (subjectGap <= NEAR_SUBJECT_POINTS && avgGapPoints <= Math.round(NEAR_AVG_GAP * N)) state = 'near';
  else state = 'far';

  return {
    state,
    deficits,
    subjectGap,
    average: total / N,
    minAvg,
    avgDeficit,
    avgGapPoints,
    // Raising a subject to its minimum also lifts the sum by the same amount.
    stepsToOpen: Math.max(subjectGap, avgGapPoints),
  };
}

export function stateOf(p: Profession, sliders: Sliders): State {
  return evaluate(p, sliders).state;
}

export function openSet(professions: readonly Profession[], sliders: Sliders): Set<string> {
  const out = new Set<string>();
  for (const p of professions) if (stateOf(p, sliders) === 'open') out.add(p.id);
  return out;
}

/** Professions that become open if `subject` goes up by one (empty at the maximum). */
export function plusOne(
  professions: readonly Profession[],
  sliders: Sliders,
  subject: SubjectId,
): Profession[] {
  if (sliders[subject] >= GRADE_MAX) return [];
  const raised = withSlider(sliders, subject, sliders[subject] + 1);
  return professions.filter((p) => stateOf(p, sliders) !== 'open' && stateOf(p, raised) === 'open');
}
