import { describe, expect, it } from 'vitest';
import { profileCounts } from '../engine/route';
import {
  EXAM_SUBJECTS,
  FIELDS,
  HAVO_VWO_PROFILES,
  LANGS,
  LEVELS,
  OTHER_OPTIONS,
  SCHOOL_LEVELS,
  SUBJECT_IDS,
  VMBO_DIRECTIONS,
  type CellRule,
  type ExamSubject,
  type Localized,
  type Profession,
  type ProfileRule,
  type RathoSubject,
} from '../engine/types';
import { PROFESSIONS, RATHO_VERSION } from './professions';
import { DIRECTION_NAMES, EXAM_SUBJECT_NAMES, EXAM_SUBJECT_SHORT, OTHER_OPTION_NAMES, PROFILE_NAMES, SCHOOL_LEVEL_NAMES } from './secondary';
import { SUBJECTS } from './subjects';

function expectLocalized(l: Localized | undefined, where: string): void {
  expect(l, where).toBeDefined();
  for (const lang of LANGS) {
    const v = l![lang];
    expect(typeof v, `${where}.${lang}`).toBe('string');
    expect(v.trim().length, `${where}.${lang}`).toBeGreaterThan(0);
  }
}

/** The admission rules of a profession: its own (havo for hbo, vwo for wo) and, for hbo, the vwo rule. */
function rulesOf(p: Profession): { rule: ProfileRule; intake: 'havo' | 'vwo'; where: string }[] {
  const a = p.admission;
  if (!a) return [];
  const own = { rule: a, intake: p.level === 3 ? ('havo' as const) : ('vwo' as const), where: p.id };
  return a.vwo === undefined ? [own] : [own, { rule: a.vwo, intake: 'vwo' as const, where: `${p.id}.vwo` }];
}

/** The regulation's subject abbreviations (Bijlage A and B, item 1) that are exam subjects in the data. */
const ABBREVIATIONS: Readonly<Record<string, ExamSubject>> = {
  nat: 'natuurkunde',
  biol: 'biologie',
  schk: 'scheikunde',
  wisA: 'wiskunde-a',
  wisB: 'wiskunde-b',
};

/** The exam subjects a cell offers: "nat", or a choice like "nat of nlt of o&o" or "(wisA of wisB)". */
function cellOptions(cell: string): ExamSubject[] {
  return cell
    .replace(/[()]/g, '')
    .split(/\s+of\s+/)
    .map((x) => (Object.hasOwn(ABBREVIATIONS, x.trim()) ? ABBREVIATIONS[x.trim()] : undefined))
    .filter((x): x is ExamSubject => x !== undefined);
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
        for (const { rule, where } of rulesOf(p)) {
          const admitting = rule.direct.length + Object.keys(rule.bridge).length;
          expect(admitting, `${where} has no profile that admits`).toBeGreaterThan(0);
        }
      } else {
        expect(p.admission, `${p.id} is not hbo or wo`).toBeUndefined();
      }
    }
  });

  it('every hbo profession has a rule for vwo pupils; no wo profession has one', () => {
    for (const p of PROFESSIONS) {
      if (p.level === 3) expect(p.admission?.vwo, `${p.id} has no vwo rule`).toBeDefined();
      if (p.level === 4) expect(p.admission?.vwo, `${p.id} is wo: its rule is the vwo rule`).toBeUndefined();
    }
  });

  it('every referenced profile and subject exists; a profile is direct or bridged, never both, and once', () => {
    const profiles = new Set<string>(HAVO_VWO_PROFILES);
    const subjects = new Set<string>(EXAM_SUBJECTS);
    for (const p of PROFESSIONS) {
      for (const { rule: a, where } of rulesOf(p)) {
        expect(new Set(a.direct).size, `${where} lists a direct profile twice`).toBe(a.direct.length);
        for (const d of a.direct) expect(profiles.has(d), `${where}.direct ${d}`).toBe(true);
        for (const [profile, subject] of Object.entries(a.bridge)) {
          expect(profiles.has(profile), `${where}.bridge ${profile}`).toBe(true);
          expect(subjects.has(subject), `${where}.bridge ${profile} -> ${subject}`).toBe(true);
          expect((a.direct as readonly string[]).includes(profile), `${where}: ${profile} is direct and bridged`).toBe(false);
        }
      }
    }
  });

  it('every admission rule has a source: a Ratho bijlage, the intake, a programme and the version read', () => {
    for (const p of PROFESSIONS) {
      for (const { rule, intake, where } of rulesOf(p)) {
        const src = rule.source;
        expect(src, `${where} has no source`).toBeDefined();
        expect(src!.version, where).toBe(RATHO_VERSION);
        expect(src!.intake, where).toBe(intake);
        if (src!.verified) {
          // Bijlage A is wo, Bijlage B is hbo, with a section for havo (3) and one for vwo (4) intake.
          expect(src!.bijlage, where).toBe(p.level === 4 ? 'A' : 'B');
          expect(src!.programme.trim().length, `${where} names no programme`).toBeGreaterThan(0);
          if (p.level === 3 && src!.table !== null) expect(src!.table.startsWith(intake === 'havo' ? '3. ' : '4. '), where).toBe(true);
        }
      }
    }
  });

  it('the data agrees with the cells it cites: * is direct; one subject or a choice is a bridge to one of them; + and # close', () => {
    for (const p of PROFESSIONS) {
      for (const { rule: a, where } of rulesOf(p)) {
        const cells = a.source?.cells;
        if (cells === undefined) continue;
        if (cells === null) {
          expect(a.direct, `${where} has no row, so every profile admits`).toEqual([...HAVO_VWO_PROFILES]);
          expect(a.bridge, where).toEqual({});
          expect(a.source!.table, where).toBeNull();
          continue;
        }
        expect(a.source!.table, where).not.toBeNull();
        for (const profile of HAVO_VWO_PROFILES) {
          const cell = cells[profile];
          const at = `${where} ${profile} "${cell}"`;
          const bridge = a.bridge[profile];
          if (cell === '*') {
            expect(a.direct.includes(profile), at).toBe(true);
            expect(bridge, at).toBeUndefined();
            continue;
          }
          expect(a.direct.includes(profile), at).toBe(false);
          if (cell.includes('+') || cell.includes('#')) {
            expect(bridge, `${at}: more than one step, or no admission`).toBeUndefined();
          } else {
            const options = cellOptions(cell);
            expect(options.length, `${at} names no exam subject the data knows`).toBeGreaterThan(0);
            expect(bridge, `${at} should be a bridge`).toBeDefined();
            expect(options, `${at} does not offer ${String(bridge)}`).toContain(bridge);
          }
        }
      }
    }
  });

  it('a catch-up footnote names profiles that the cells keep closed', () => {
    for (const p of PROFESSIONS) {
      for (const { rule, where } of rulesOf(p)) {
        const catchUp = rule.source?.catchUp;
        if (!catchUp) continue;
        expect(catchUp.profiles.length, where).toBeGreaterThan(0);
        expect(catchUp.subjects.length, where).toBeGreaterThan(0);
        for (const pr of catchUp.profiles) {
          expect(rule.direct.includes(pr), `${where} ${pr}`).toBe(false);
          expect(rule.bridge[pr], `${where} ${pr}`).toBeUndefined();
        }
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
    expect(counts('vwo')).toEqual({ nt: 33, ng: 28, em: 28, cm: 26 });
    expect(counts('gltl')).toEqual({ techniek: 9, zorg: 4, economie: 1, groen: 1 });
    expect(counts('bbkb')).toEqual(counts('gltl'));
  });
});

/** Every abbreviation the regulation's cells use in the data (Bijlage A and B, item 1), as a subject. */
const RATHO_SUBJECTS: Readonly<Record<string, RathoSubject>> = {
  ...ABBREVIATIONS,
  nlt: 'nlt',
  'o&o': 'o&o',
  'PgP-T': 'pgp-t',
};

/**
 * A cell's text read as a rule, here in the test only: the data holds the rule written
 * by hand, and this checks that the two say the same. `+` joins groups, `of` joins the
 * choices of a group, a group may stand in brackets. Null when a word is unknown.
 */
function readCell(text: string): CellRule | null {
  if (text === '*') return { kind: 'admits' };
  if (text === '#') return { kind: 'noRight' };
  const groups: RathoSubject[][] = [];
  for (const part of text.split(' + ')) {
    const inner = /^\((.*)\)$/.exec(part.trim())?.[1] ?? part.trim();
    const group: RathoSubject[] = [];
    for (const word of inner.split(' of ')) {
      const w = word.trim();
      if (!Object.hasOwn(RATHO_SUBJECTS, w)) return null;
      group.push(RATHO_SUBJECTS[w]!);
    }
    groups.push(group);
  }
  return { kind: 'subjects', groups };
}

describe('bovenbouw data (each cell as a typed rule)', () => {
  it('reads the cell texts as the test means them', () => {
    expect(readCell('nat + wisB')).toEqual({ kind: 'subjects', groups: [['natuurkunde'], ['wiskunde-b']] });
    expect(readCell('(wisA of wisB) + (nat of nlt of o&o of PgP-T)')).toEqual({
      kind: 'subjects',
      groups: [
        ['wiskunde-a', 'wiskunde-b'],
        ['natuurkunde', 'nlt', 'o&o', 'pgp-t'],
      ],
    });
    expect(readCell('econ')).toBeNull();
  });

  it('every row has a typed rule next to each cell, and no row has none', () => {
    for (const p of PROFESSIONS) {
      for (const { rule, where } of rulesOf(p)) {
        const src = rule.source!;
        expect(src.rules === null, `${where}: cells and rules go together`).toBe(src.cells === null);
      }
    }
  });

  it('each typed rule says what its cell says', () => {
    let cells = 0;
    for (const p of PROFESSIONS) {
      for (const { rule, where } of rulesOf(p)) {
        const { cells: texts, rules } = rule.source!;
        if (texts === null || rules === null) continue;
        for (const profile of HAVO_VWO_PROFILES) {
          const text = texts[profile];
          expect(readCell(text), `${where} ${profile} "${text}" has a word the test does not know`).not.toBeNull();
          expect(rules[profile], `${where} ${profile} "${text}"`).toEqual(readCell(text));
          cells++;
        }
      }
    }
    expect(cells).toBeGreaterThan(0);
  });

  it('every group can be met with the boxes on the page: it holds an exam subject, and no subject is named twice in a cell', () => {
    for (const p of PROFESSIONS) {
      for (const { rule, where } of rulesOf(p)) {
        for (const profile of HAVO_VWO_PROFILES) {
          const cell = rule.source?.rules?.[profile];
          if (cell?.kind !== 'subjects') continue;
          const all = cell.groups.flat();
          expect(new Set(all).size, `${where} ${profile}`).toBe(all.length);
          for (const g of cell.groups) {
            expect(g.some((s) => (EXAM_SUBJECTS as readonly string[]).includes(s)), `${where} ${profile} [${g.join(', ')}]`).toBe(true);
          }
        }
      }
    }
  });

  it('the typed rules agree with direct and bridge: * is direct, one group is a bridge to one of its subjects, the rest closed', () => {
    for (const p of PROFESSIONS) {
      for (const { rule, where } of rulesOf(p)) {
        const rules = rule.source?.rules;
        if (!rules) continue;
        for (const profile of HAVO_VWO_PROFILES) {
          const cell = rules[profile];
          const at = `${where} ${profile}`;
          expect(rule.direct.includes(profile), at).toBe(cell.kind === 'admits');
          const bridge = rule.bridge[profile];
          if (cell.kind === 'subjects' && cell.groups.length === 1) {
            expect(cell.groups[0], `${at} bridges to ${String(bridge)}`).toContain(bridge);
          } else {
            expect(bridge, at).toBeUndefined();
          }
        }
      }
    }
  });

  it('every exam subject has a short name in all three languages, which starts its full name', () => {
    expect(Object.keys(EXAM_SUBJECT_SHORT)).toEqual([...EXAM_SUBJECTS]);
    for (const s of EXAM_SUBJECTS) {
      expectLocalized(EXAM_SUBJECT_SHORT[s], `exam subject ${s}.short`);
      for (const lang of LANGS) expect(EXAM_SUBJECT_NAMES[s][lang].startsWith(EXAM_SUBJECT_SHORT[s][lang]), `${s}.${lang}`).toBe(true);
    }
  });

  it('every subject without a box has its abbreviation and a full name in all three languages', () => {
    expect(Object.keys(OTHER_OPTION_NAMES)).toEqual([...OTHER_OPTIONS]);
    for (const [id, o] of Object.entries(OTHER_OPTION_NAMES)) {
      expect(o.short.trim().length, id).toBeGreaterThan(0);
      expectLocalized(o.name, `other option ${id}`);
      for (const lang of LANGS) expect(o.name[lang].startsWith(o.short), `${id}.${lang}`).toBe(true);
    }
  });
});
