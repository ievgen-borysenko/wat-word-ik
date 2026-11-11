import { describe, expect, it } from 'vitest';
import { PROFESSIONS, PROFESSION_BY_ID } from '../data/professions';
import { focus, why } from './hints';
import { evaluate, openSet, plusOne, stateOf, uniformSliders, withSlider } from './scoring';
import { GRADE_MAX, SUBJECT_IDS, type Sliders, type SubjectId } from './types';

function sliders(base: number, over: Partial<Record<SubjectId, number>> = {}): Sliders {
  return { ...uniformSliders(base), ...over };
}

function stateById(id: string, s: Sliders) {
  const p = PROFESSION_BY_ID.get(id);
  if (!p) throw new Error(`unknown profession ${id}`);
  return stateOf(p, s);
}

const ENGINEERS = [
  'elektrotechnisch-ingenieur',
  'mechatronica-engineer',
  'software-engineer',
  'bouwkundig-ingenieur',
  'electrical-engineer',
];

/** Small deterministic PRNG (mulberry32), so the property test is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('scenarios', () => {
  it('1. all sliders 3: exactly the level-0 professions are open', () => {
    const open = openSet(PROFESSIONS, sliders(3));
    const level0 = PROFESSIONS.filter((p) => p.level === 0).map((p) => p.id);
    expect([...open].sort()).toEqual([...level0].sort());
  });

  it('2. all sliders 10: all 36 are open', () => {
    expect(openSet(PROFESSIONS, sliders(10)).size).toBe(36);
  });

  it('3. all sliders 6: no wo profession open, at least 5 of level >= 1 open', () => {
    const s = sliders(6);
    const open = PROFESSIONS.filter((p) => stateOf(p, s) === 'open');
    expect(open.filter((p) => p.level === 4)).toEqual([]);
    expect(open.filter((p) => p.level >= 1).length).toBeGreaterThanOrEqual(5);
  });

  it('4. strong in maths, physics and technology: robotics engineer reachable, lawyer and archaeologist not open', () => {
    const s = sliders(6, { wiskunde: 8, natuurkunde: 8, techniek: 7 });
    expect(['open', 'near']).toContain(stateById('mechatronica-engineer', s));
    expect(stateById('advocaat', s)).not.toBe('open');
    expect(stateById('archeoloog', s)).not.toBe('open');
  });

  it('5. strong in history and languages, weak in maths and physics: two word-and-society jobs reachable, engineers far', () => {
    const s = sliders(6, { geschiedenis: 9, nederlands: 9, engels: 8, wiskunde: 4, natuurkunde: 4 });
    const reachable = ['archeoloog', 'journalist', 'advocaat'].filter((id) =>
      ['open', 'near'].includes(stateById(id, s)),
    );
    expect(reachable.length).toBeGreaterThanOrEqual(2);
    for (const id of ENGINEERS) expect(stateById(id, s), id).toBe('far');
  });

  it('6. monotonic: raising any slider by one never closes a profession (500 seeded vectors)', () => {
    const rand = rng(20261111);
    for (let i = 0; i < 500; i++) {
      const base = Object.fromEntries(SUBJECT_IDS.map((id) => [id, 1 + Math.floor(rand() * 10)])) as Sliders;
      const before = openSet(PROFESSIONS, base);
      for (const subj of SUBJECT_IDS) {
        if (base[subj] >= GRADE_MAX) continue;
        const after = openSet(PROFESSIONS, withSlider(base, subj, base[subj] + 1));
        for (const id of before) expect(after.has(id), `${id} closed when ${subj} went up`).toBe(true);
      }
    }
  });

  it('7. plusOne equals the difference of the open sets', () => {
    const rand = rng(7);
    for (let i = 0; i < 100; i++) {
      const base = Object.fromEntries(SUBJECT_IDS.map((id) => [id, 1 + Math.floor(rand() * 10)])) as Sliders;
      const before = openSet(PROFESSIONS, base);
      for (const subj of SUBJECT_IDS) {
        const got = plusOne(PROFESSIONS, base, subj).map((p) => p.id).sort();
        if (base[subj] >= GRADE_MAX) {
          expect(got).toEqual([]);
          continue;
        }
        const after = openSet(PROFESSIONS, withSlider(base, subj, base[subj] + 1));
        const diff = [...after].filter((id) => !before.has(id)).sort();
        expect(got).toEqual(diff);
      }
    }
  });
});

describe('picture is convincing', () => {
  it('dragging any one slider from 3 to 10 (rest at 6) changes at least 3 tiles', () => {
    for (const subj of SUBJECT_IDS) {
      const low = sliders(6, { [subj]: 3 });
      const high = sliders(6, { [subj]: 10 });
      const changed = PROFESSIONS.filter((p) => stateOf(p, low) !== stateOf(p, high)).length;
      expect(changed, subj).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('evaluate', () => {
  it('state boundaries: open, near, far', () => {
    const p = PROFESSION_BY_ID.get('mechatronica-engineer')!;
    // needs maths 7, physics 7, technology 7; hbo gate 6.5
    expect(evaluate(p, sliders(7)).state).toBe('open');
    expect(evaluate(p, sliders(7, { wiskunde: 5 })).state).toBe('near'); // 2 subject points, avg 6.8
    expect(evaluate(p, sliders(7, { wiskunde: 4 })).state).toBe('far'); // 3 subject points
    // subjects are fine, but the average is 6.3: 2 points short of the hbo gate
    expect(evaluate(p, sliders(6, { wiskunde: 7, natuurkunde: 7, techniek: 7 })).state).toBe('near');
    // exactly on the gate (6.5) counts as enough
    expect(evaluate(p, sliders(6, { wiskunde: 8, natuurkunde: 8, techniek: 7 })).state).toBe('open');
  });

  it('average gate counts in whole points and steps take both gaps into account', () => {
    const p = PROFESSION_BY_ID.get('journalist')!; // nederlands 7, engels 6, geschiedenis 6; gate 6.5
    const e = evaluate(p, sliders(6));
    expect(e.subjectGap).toBe(1);
    expect(e.avgGapPoints).toBe(5);
    expect(e.avgDeficit).toBeCloseTo(0.5);
    expect(e.stepsToOpen).toBe(5);
    expect(e.state).toBe('near');
  });

  it('why() lists subject gaps and the remaining average gap', () => {
    const p = PROFESSION_BY_ID.get('journalist')!;
    expect(why(p, sliders(6))).toEqual([
      { kind: 'subject', subject: 'nederlands', have: 6, need: 7, points: 1 },
      { kind: 'average', points: 4 },
    ]);
    expect(why(p, sliders(7))).toEqual([]);
  });

  it('focus() returns at most three gaps, largest first', () => {
    const p = PROFESSION_BY_ID.get('chirurg')!;
    const f = focus(p, sliders(3));
    expect(f.length).toBe(3);
    expect(f[0]!.points).toBeGreaterThanOrEqual(f[1]!.points);
    expect(f[1]!.points).toBeGreaterThanOrEqual(f[2]!.points);
  });
});
