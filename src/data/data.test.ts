import { describe, expect, it } from 'vitest';
import { profileCounts } from '../engine/route';
import {
  EXAM_SUBJECTS,
  FIELDS,
  HAVO_VWO_PROFILES,
  LANGS,
  LEVELS,
  SCHOOL_LEVELS,
  SUBJECT_IDS,
  VMBO_DIRECTIONS,
  type Localized,
} from '../engine/types';
import { PROFESSIONS, RATHO_VERSION } from './professions';
import { DIRECTION_NAMES, EXAM_SUBJECT_NAMES, PROFILE_NAMES, SCHOOL_LEVEL_NAMES } from './secondary';
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

  it('every floor has 5 to 8 tiles (one row of 8 on every screen)', () => {
    for (const level of LEVELS) {
      const count = PROFESSIONS.filter((p) => p.level === level).length;
      expect(count, `level ${level}`).toBeGreaterThanOrEqual(5);
      expect(count, `level ${level}`).toBeLessThanOrEqual(8);
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

  it('every profession has a known field, and every field holds 4 to 8 (one row of 8 on a phone)', () => {
    const known = new Set<string>(FIELDS);
    for (const p of PROFESSIONS) expect(known.has(p.field), `${p.id}.field = ${p.field}`).toBe(true);
    for (const field of FIELDS) {
      const count = PROFESSIONS.filter((p) => p.field === field).length;
      expect(count, `field ${field}`).toBeGreaterThanOrEqual(4);
      expect(count, `field ${field}`).toBeLessThanOrEqual(8);
    }
  });

  it('no field is a level in disguise: every field spans at least three levels', () => {
    for (const field of FIELDS) {
      const levels = new Set(PROFESSIONS.filter((p) => p.field === field).map((p) => p.level));
      expect(levels.size, `field ${field} has levels ${[...levels].join(', ')}`).toBeGreaterThanOrEqual(3);
    }
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

describe('onderbouw data (school levels, profiles, vmbo directions)', () => {
  it('every level, profile, direction and exam subject has a name in all three languages, and nothing more', () => {
    expect(Object.keys(SCHOOL_LEVEL_NAMES)).toEqual([...SCHOOL_LEVELS]);
    expect(Object.keys(PROFILE_NAMES)).toEqual([...HAVO_VWO_PROFILES]);
    expect(Object.keys(DIRECTION_NAMES)).toEqual([...VMBO_DIRECTIONS]);
    expect(Object.keys(EXAM_SUBJECT_NAMES)).toEqual([...EXAM_SUBJECTS]);
    for (const [id, l] of Object.entries(SCHOOL_LEVEL_NAMES)) expectLocalized(l, `level ${id}`);
    for (const [id, p] of Object.entries(PROFILE_NAMES)) {
      expectLocalized(p.name, `profile ${id}.name`);
      expectLocalized(p.short, `profile ${id}.short`);
    }
    for (const [id, l] of Object.entries(DIRECTION_NAMES)) expectLocalized(l, `direction ${id}`);
    for (const [id, l] of Object.entries(EXAM_SUBJECT_NAMES)) expectLocalized(l, `exam subject ${id}`);
  });

  it('every mbo profession names the vmbo direction that fits it best, and no other profession has one', () => {
    const known = new Set<string>(VMBO_DIRECTIONS);
    for (const p of PROFESSIONS) {
      if (p.level === 1 || p.level === 2) expect(known.has(p.vmbo ?? ''), `${p.id}.vmbo = ${String(p.vmbo)}`).toBe(true);
      else expect(p.vmbo, `${p.id} is not mbo`).toBeUndefined();
    }
  });

  it('every hbo and wo profession has a profile that admits, directly or with one subject; only they have admission data', () => {
    for (const p of PROFESSIONS) {
      if (p.level === 3 || p.level === 4) {
        expect(p.admission, p.id).toBeDefined();
        const admitting = p.admission!.direct.length + Object.keys(p.admission!.bridge).length;
        expect(admitting, `${p.id} has no profile that admits`).toBeGreaterThan(0);
      } else {
        expect(p.admission, `${p.id} is not hbo or wo`).toBeUndefined();
      }
    }
  });

  it('every referenced profile and subject exists; a profile is direct or bridged, never both, and once', () => {
    const profiles = new Set<string>(HAVO_VWO_PROFILES);
    const subjects = new Set<string>(EXAM_SUBJECTS);
    for (const p of PROFESSIONS) {
      const a = p.admission;
      if (!a) continue;
      expect(new Set(a.direct).size, `${p.id} lists a direct profile twice`).toBe(a.direct.length);
      for (const d of a.direct) expect(profiles.has(d), `${p.id}.direct ${d}`).toBe(true);
      for (const [profile, subject] of Object.entries(a.bridge)) {
        expect(profiles.has(profile), `${p.id}.bridge ${profile}`).toBe(true);
        expect(subjects.has(subject), `${p.id}.bridge ${profile} -> ${subject}`).toBe(true);
        expect((a.direct as readonly string[]).includes(profile), `${p.id}: ${profile} is direct and bridged`).toBe(false);
      }
    }
  });

  it('every admission row has a source: a Ratho bijlage, a programme and the version read', () => {
    for (const p of PROFESSIONS) {
      const a = p.admission;
      if (!a) continue;
      const src = a.source;
      expect(src, `${p.id} has no source`).toBeDefined();
      expect(src!.version, p.id).toBe(RATHO_VERSION);
      if (src!.verified) {
        // Bijlage A is wo, Bijlage B is hbo.
        expect(src!.bijlage, p.id).toBe(p.level === 4 ? 'A' : 'B');
        expect(src!.programme.trim().length, `${p.id} names no programme`).toBeGreaterThan(0);
      }
    }
  });

  it('the data agrees with the cells it cites: * is direct, # is closed; no row means every profile', () => {
    for (const p of PROFESSIONS) {
      const a = p.admission;
      const cells = a?.source?.cells;
      if (!a || cells === undefined) continue;
      if (cells === null) {
        expect(a.direct, `${p.id} has no row, so every profile admits`).toEqual([...HAVO_VWO_PROFILES]);
        expect(a.source!.table, p.id).toBeNull();
        continue;
      }
      expect(a.source!.table, p.id).not.toBeNull();
      for (const profile of HAVO_VWO_PROFILES) {
        const cell = cells[profile];
        const where = `${p.id} ${profile} "${cell}"`;
        expect(a.direct.includes(profile), where).toBe(cell === '*');
        if (cell === '#') expect(a.bridge[profile], where).toBeUndefined();
      }
    }
  });

  it('every vmbo direction fits at least one mbo profession', () => {
    for (const d of VMBO_DIRECTIONS) expect(PROFESSIONS.some((p) => p.vmbo === d), d).toBe(true);
  });

  // The counts on the profile buttons. A change here is a change in the data:
  // update these numbers on purpose, together with the data.
  it('the counts per profile are stable', () => {
    const counts = (level: (typeof SCHOOL_LEVELS)[number]) =>
      Object.fromEntries(profileCounts(PROFESSIONS, level).map((c) => [c.profile, c.count]));
    expect(counts('havo')).toEqual({ nt: 28, ng: 27, em: 27, cm: 23 });
    expect(counts('vwo')).toEqual({ nt: 33, ng: 28, em: 28, cm: 24 });
    expect(counts('gltl')).toEqual({ techniek: 9, zorg: 4, economie: 1, groen: 1 });
    expect(counts('bbkb')).toEqual(counts('gltl'));
  });
});
