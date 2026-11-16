import { describe, expect, it } from 'vitest';
import { PROFESSIONS, PROFESSION_BY_ID } from '../data/professions';
import { doorCounts, doorOf, groupByField, nextStep } from './doors';
import { evaluate, plusOne, uniformSliders, withSlider } from './scoring';
import { FIELDS, GRADE_MAX, SUBJECT_IDS, type Profession, type Sliders, type SubjectId } from './types';

function sliders(base: number, over: Partial<Record<SubjectId, number>> = {}): Sliders {
  return { ...uniformSliders(base), ...over };
}

function door(id: string, s: Sliders) {
  const p = PROFESSION_BY_ID.get(id);
  if (!p) throw new Error(`unknown profession ${id}`);
  return doorOf(evaluate(p, s));
}

const views = (s: Sliders) => PROFESSIONS.map((p) => doorOf(evaluate(p, s)));

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

function randomSliders(next: () => number): Sliders {
  return Object.fromEntries(SUBJECT_IDS.map((s) => [s, 1 + Math.floor(next() * 10)])) as Record<SubjectId, number>;
}

describe('door states', () => {
  it('open doors are exactly the open professions', () => {
    const s = sliders(6);
    for (const p of PROFESSIONS) expect(doorOf(evaluate(p, s)).state === 'open', p.id).toBe(evaluate(p, s).state === 'open');
  });

  it('a door one subject point short is ajar, and names that subject', () => {
    // Kapper: kunst 6, nederlands 5, average 4.5. At 6 everywhere but kunst 5: one point short in art.
    expect(door('kapper', sliders(6, { kunst: 5 }))).toEqual({ state: 'ajar', key: { kind: 'subject', subject: 'kunst' } });
  });

  it('a door short only on the average by one point is ajar for any subject', () => {
    // Software engineer: wiskunde 7, engels 7, techniek 6, average 6.5 (65 points).
    // Those three met, and 64 points in all: no subject short, the average one point short.
    const s = sliders(6, { wiskunde: 7, engels: 7, natuurkunde: 7, scheikunde: 7 });
    const e = evaluate(PROFESSION_BY_ID.get('software-engineer')!, s);
    expect(e.deficits).toEqual([]);
    expect(e.avgGapPoints).toBe(1);
    expect(door('software-engineer', s)).toEqual({ state: 'ajar', key: { kind: 'any' } });
  });

  it('two points short is not ajar but closed ("not open yet")', () => {
    expect(door('kapper', sliders(6, { kunst: 4 })).state).toBe('closed');
  });

  it('property: ajar exactly when some single +1 opens the door, and its key is such a +1 (500 random slider sets)', () => {
    const next = rng(20261116);
    for (let i = 0; i < 500; i++) {
      const s = randomSliders(next);
      for (const p of PROFESSIONS) {
        const v = doorOf(evaluate(p, s));
        const openers = SUBJECT_IDS.filter((sub) => plusOne(PROFESSIONS, s, sub).includes(p));
        expect(v.state === 'ajar', `${p.id} at ${JSON.stringify(s)}`).toBe(openers.length > 0);
        if (v.key?.kind === 'subject') expect(openers).toContain(v.key.subject);
        if (v.key?.kind === 'any') {
          expect(openers).toEqual(SUBJECT_IDS.filter((sub) => s[sub] < GRADE_MAX));
        }
      }
    }
  });
});

describe('counter', () => {
  it('counts open, ajar and closed doors, adding up to all 36', () => {
    for (const g of [1, 3, 6, 9, 10]) {
      const c = doorCounts(views(sliders(g)));
      expect(c.open + c.ajar + c.closed, `all ${g}`).toBe(36);
      expect(c.total).toBe(36);
    }
  });

  it('at the lowest sliders some doors are still open', () => {
    expect(doorCounts(views(sliders(1))).open).toBeGreaterThan(0);
    expect(doorCounts(views(sliders(3))).open).toBe(PROFESSIONS.filter((p) => p.level === 0).length);
  });

  it('at all 10 every door is open', () => {
    expect(doorCounts(views(sliders(10)))).toEqual({ open: 36, ajar: 0, closed: 0, total: 36 });
  });

  it('counts a mixed set by hand', () => {
    const c = doorCounts([
      { state: 'open', key: null },
      { state: 'ajar', key: { kind: 'any' } },
      { state: 'closed', key: null },
      { state: 'closed', key: null },
    ]);
    expect(c).toEqual({ open: 1, ajar: 1, closed: 2, total: 4 });
  });
});

describe('next step', () => {
  it('is the +1 that opens the most doors, matching plusOne', () => {
    const s = sliders(6);
    const step = nextStep(PROFESSIONS, s);
    expect(step.kind).toBe('plusOne');
    if (step.kind !== 'plusOne') return;
    const counts = SUBJECT_IDS.map((sub) => plusOne(PROFESSIONS, s, sub).length);
    expect(step.opens).toBe(Math.max(...counts));
    // Ties go to the first subject in SUBJECT_IDS order.
    expect(step.subject).toBe(SUBJECT_IDS[counts.indexOf(step.opens)]);
    expect(plusOne(PROFESSIONS, s, step.subject).length).toBe(step.opens);
  });

  it('when no single +1 opens a door, names the closest door and its points', () => {
    for (const g of [1, 3]) {
      const s = sliders(g);
      expect(SUBJECT_IDS.every((sub) => plusOne(PROFESSIONS, s, sub).length === 0), `all ${g}`).toBe(true);
      const step = nextStep(PROFESSIONS, s);
      expect(step.kind, `all ${g}`).toBe('next');
      if (step.kind !== 'next') continue;
      const steps = PROFESSIONS.map((p) => evaluate(p, s))
        .filter((e) => e.state !== 'open')
        .map((e) => e.stepsToOpen);
      expect(step.points).toBe(Math.min(...steps));
      expect(step.points).toBeGreaterThan(1);
      expect(evaluate(step.profession, s).stepsToOpen).toBe(step.points);
    }
  });

  it('there is always a next step until every door is open', () => {
    const next = rng(7);
    for (let i = 0; i < 300; i++) {
      const s = randomSliders(next);
      const allOpen = PROFESSIONS.every((p) => evaluate(p, s).state === 'open');
      expect(nextStep(PROFESSIONS, s).kind === 'allOpen').toBe(allOpen);
    }
    expect(nextStep(PROFESSIONS, sliders(10))).toEqual({ kind: 'allOpen' });
  });

  it('taking the +1 it names opens exactly that many more doors', () => {
    const s = sliders(7, { wiskunde: 5, engels: 5 });
    const step = nextStep(PROFESSIONS, s);
    expect(step.kind).toBe('plusOne');
    if (step.kind !== 'plusOne') return;
    const before = views(s).filter((v) => v.state === 'open').length;
    const after = views(withSlider(s, step.subject, s[step.subject] + 1)).filter((v) => v.state === 'open').length;
    expect(after - before).toBe(step.opens);
  });
});

describe('grouping by field', () => {
  const nl = (p: Profession) => (p.short ?? p.name).nl;
  const groups = groupByField(PROFESSIONS, nl, 'nl');

  it('keeps every profession once, in the FIELDS order', () => {
    expect(groups.map((g) => g.field)).toEqual([...FIELDS]);
    const ids = groups.flatMap((g) => g.professions.map((p) => p.id));
    expect(ids.length).toBe(36);
    expect(new Set(ids)).toEqual(new Set(PROFESSIONS.map((p) => p.id)));
  });

  it('orders each group alphabetically by the shown name, in every language', () => {
    for (const [lang, locale] of [['nl', 'nl'], ['en', 'en-GB'], ['ua', 'uk']] as const) {
      const name = (p: Profession) => (p.short ?? p.name)[lang];
      const collator = new Intl.Collator(locale, { sensitivity: 'base' });
      for (const g of groupByField(PROFESSIONS, name, locale)) {
        const names = g.professions.map(name);
        expect(names, `${lang} ${g.field}`).toEqual([...names].sort(collator.compare));
      }
    }
  });

  it('is not ordered by level or by pay', () => {
    // At least one group would change if it were sorted by level or by pay instead.
    const byLevel = groups.some((g) => g.professions.some((p, i) => i > 0 && p.level < g.professions[i - 1]!.level));
    const byPay = groups.some((g) => g.professions.some((p, i) => i > 0 && p.pay < g.professions[i - 1]!.pay));
    expect(byLevel).toBe(true);
    expect(byPay).toBe(true);
  });
});
