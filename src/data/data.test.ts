import { describe, expect, it } from 'vitest';
import { LANGS, LEVELS, SUBJECT_IDS, type Localized } from '../engine/types';
import { PROFESSIONS } from './professions';
import { SUBJECTS } from './subjects';

function expectLocalized(l: Localized | undefined, where: string): void {
  expect(l, where).toBeDefined();
  for (const lang of LANGS) {
    const v = l![lang];
    expect(typeof v, `${where}.${lang}`).toBe('string');
    expect(v.trim().length, `${where}.${lang}`).toBeGreaterThan(0);
  }
}

describe('subjects', () => {
  it('match SUBJECT_IDS in order and are fully translated', () => {
    expect(SUBJECTS.map((s) => s.id)).toEqual([...SUBJECT_IDS]);
    for (const s of SUBJECTS) {
      expect(s.emoji.length, s.id).toBeGreaterThan(0);
      expectLocalized(s.name, `${s.id}.name`);
      if (s.short) expectLocalized(s.short, `${s.id}.short`);
    }
  });
});

describe('professions', () => {
  it('there are exactly 36 with unique ids', () => {
    expect(PROFESSIONS.length).toBe(36);
    expect(new Set(PROFESSIONS.map((p) => p.id)).size).toBe(36);
    for (const p of PROFESSIONS) expect(p.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('every floor has 5 to 10 tiles', () => {
    for (const level of LEVELS) {
      const count = PROFESSIONS.filter((p) => p.level === level).length;
      expect(count, `level ${level}`).toBeGreaterThanOrEqual(5);
      expect(count, `level ${level}`).toBeLessThanOrEqual(10);
    }
  });

  it('names and descriptions exist in all three languages', () => {
    for (const p of PROFESSIONS) {
      expectLocalized(p.name, `${p.id}.name`);
      expectLocalized(p.about, `${p.id}.about`);
      if (p.short) expectLocalized(p.short, `${p.id}.short`);
      expect(p.emoji.length, p.id).toBeGreaterThan(0);
    }
  });

  it('needs reference existing subjects, once each, with values in range', () => {
    const known = new Set<string>(SUBJECT_IDS);
    for (const p of PROFESSIONS) {
      const subjects = p.needs.map((n) => n.subject);
      expect(new Set(subjects).size, p.id).toBe(subjects.length);
      for (const n of p.needs) {
        expect(known.has(n.subject), `${p.id} -> ${n.subject}`).toBe(true);
        expect(Number.isInteger(n.min), p.id).toBe(true);
      }
      if (p.level === 0) {
        for (const n of p.needs) expect(n.min, p.id).toBeLessThanOrEqual(3);
      } else {
        expect(p.needs.length, p.id).toBeGreaterThanOrEqual(2);
        expect(p.needs.length, p.id).toBeLessThanOrEqual(5);
        for (const n of p.needs) {
          expect(n.min, p.id).toBeGreaterThanOrEqual(4);
          expect(n.min, p.id).toBeLessThanOrEqual(9);
        }
      }
      expect([1, 2, 3, 4, 5]).toContain(p.pay);
    }
  });

  it('ladder rungs are contiguous from 1 and never step down a floor', () => {
    const families = new Map<string, typeof PROFESSIONS[number][]>();
    for (const p of PROFESSIONS) families.set(p.family, [...(families.get(p.family) ?? []), p]);
    for (const [family, members] of families) {
      const sorted = [...members].sort((a, b) => a.rung - b.rung);
      expect(sorted.map((p) => p.rung), family).toEqual(sorted.map((_, i) => i + 1));
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.level, family).toBeGreaterThanOrEqual(sorted[i - 1]!.level);
      }
    }
  });

  it('every ladder is monotonic: each rung needs at least what the rung below needs', () => {
    const families = new Map<string, typeof PROFESSIONS[number][]>();
    for (const p of PROFESSIONS) families.set(p.family, [...(families.get(p.family) ?? []), p]);
    for (const members of families.values()) {
      const sorted = [...members].sort((a, b) => a.rung - b.rung);
      for (let i = 1; i < sorted.length; i++) {
        const lower = sorted[i - 1]!;
        const upper = sorted[i]!;
        for (const need of lower.needs) {
          const up = upper.needs.find((n) => n.subject === need.subject);
          expect(up, `${upper.id} drops ${need.subject} from ${lower.id}`).toBeDefined();
          expect(up!.min, `${upper.id} asks less ${need.subject} than ${lower.id}`).toBeGreaterThanOrEqual(need.min);
        }
      }
    }
  });

  it('the three required ladders exist, with physics rising on every electrical rung', () => {
    const ladder = (family: string) =>
      PROFESSIONS.filter((p) => p.family === family)
        .sort((a, b) => a.rung - b.rung)
        .map((p) => p.id);
    expect(ladder('elektro')).toEqual([
      'elektromonteur',
      'technicus-elektrotechniek',
      'elektrotechnisch-ingenieur',
      'electrical-engineer',
    ]);
    expect(ladder('zorg')).toEqual(['verzorgende', 'verpleegkundige', 'arts', 'chirurg']);
    expect(ladder('bouw')).toEqual(['timmerman', 'meubelmaker', 'bouwkundig-ingenieur', 'architect']);

    const physics = ladder('elektro').map(
      (id) => PROFESSIONS.find((p) => p.id === id)!.needs.find((n) => n.subject === 'natuurkunde')?.min ?? 0,
    );
    for (let i = 1; i < physics.length; i++) expect(physics[i]).toBeGreaterThan(physics[i - 1]!);
  });

  it('every subject is a key subject (highest requirement) of at least two professions', () => {
    const counts = new Map<string, number>();
    for (const p of PROFESSIONS) {
      if (p.needs.length === 0) continue;
      const top = Math.max(...p.needs.map((n) => n.min));
      for (const n of p.needs) if (n.min === top) counts.set(n.subject, (counts.get(n.subject) ?? 0) + 1);
    }
    for (const s of SUBJECT_IDS) expect(counts.get(s) ?? 0, s).toBeGreaterThanOrEqual(2);
  });
});
