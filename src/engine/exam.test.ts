import { describe, expect, it } from 'vitest';
import { PROFESSIONS, PROFESSION_BY_ID } from '../data/professions';
import { admittingCells, cellRuleOf, examProfileCounts, examRouteOf, judgeCell } from './exam';
import { profileCounts, profilesOf, routeOf, type RouteView } from './route';
import {
  EXAM_SUBJECTS,
  HAVO_VWO_PROFILES,
  SCHOOL_LEVELS,
  VMBO_DIRECTIONS,
  type AdmissionSource,
  type CellRule,
  type ExamSubject,
  type HavoVwoProfile,
  type Profession,
  type ProfileAdmission,
  type RathoSubject,
  type SchoolLevel,
} from './types';

/** A made-up profession with only what the routing reads. */
function prof(level: Profession['level'], admission?: ProfileAdmission): Profession {
  return {
    id: `p${level}`,
    level,
    emoji: 'x',
    name: { nl: 'x', en: 'x', ua: 'x' },
    about: { nl: 'x', en: 'x', ua: 'x' },
    needs: [],
    pay: 1,
    family: 'x',
    rung: 1,
    field: 'care',
    ...(admission === undefined ? {} : { admission }),
  };
}

const STAR: CellRule = { kind: 'admits' };
const NO: CellRule = { kind: 'noRight' };
const needs = (...groups: RathoSubject[][]): CellRule => ({ kind: 'subjects', groups });

/** A rule with typed cells NT, NG, EM, CM; `direct` and `bridge` as the onderbouw data would hold them. */
function rule(nt: CellRule, ng: CellRule, em: CellRule, cm: CellRule): ProfileAdmission {
  const rules = { nt, ng, em, cm };
  const direct = HAVO_VWO_PROFILES.filter((pr) => rules[pr].kind === 'admits');
  const bridge: Partial<Record<HavoVwoProfile, ExamSubject>> = {};
  for (const pr of HAVO_VWO_PROFILES) {
    const c = rules[pr];
    const first = c.kind === 'subjects' && c.groups.length === 1 ? c.groups[0]?.find((s) => (EXAM_SUBJECTS as readonly string[]).includes(s)) : undefined;
    if (first) bridge[pr] = first as ExamSubject;
  }
  const source: AdmissionSource = {
    bijlage: 'B',
    intake: 'havo',
    table: 'test',
    programme: 'Test',
    cells: { nt: '?', ng: '?', em: '?', cm: '?' },
    rules,
    version: 'test',
    verified: true,
  };
  return { direct, bridge, source };
}

const set = (...s: ExamSubject[]): ReadonlySet<ExamSubject> => new Set(s);
const NONE = set();
const ALL_SUBJECTS = set(...EXAM_SUBJECTS);
const OPEN: RouteView = { state: 'open' };
const subject = (s: ExamSubject) => ({ kind: 'subject', subject: s }) as const;
const RANK = { closed: 0, detour: 1, open: 2 } as const;
const byId = (id: string) => PROFESSION_BY_ID.get(id)!;

/** Every set of exam subjects: 32 of them. */
const SUBSETS: ReadonlySet<ExamSubject>[] = Array.from({ length: 1 << EXAM_SUBJECTS.length }, (_, mask) =>
  set(...EXAM_SUBJECTS.filter((_, i) => mask & (1 << i))),
);

describe('judgeCell: every cell shape', () => {
  it('* admits whatever the subjects, # never does', () => {
    for (const extras of SUBSETS) {
      expect(judgeCell(STAR, extras)).toEqual({ kind: 'met', met: [] });
      expect(judgeCell(NO, extras)).toEqual({ kind: 'noRight' });
    }
  });

  it('one subject (nat): met by that subject only', () => {
    const cell = needs(['natuurkunde']);
    expect(judgeCell(cell, NONE)).toEqual({ kind: 'missing', missing: [['natuurkunde']] });
    expect(judgeCell(cell, set('scheikunde', 'biologie', 'wiskunde-b'))).toEqual({ kind: 'missing', missing: [['natuurkunde']] });
    expect(judgeCell(cell, set('natuurkunde'))).toEqual({ kind: 'met', met: [['natuurkunde']] });
  });

  it('a choice (wisA of wisB): met by either', () => {
    const cell = needs(['wiskunde-a', 'wiskunde-b']);
    expect(judgeCell(cell, NONE).kind).toBe('missing');
    expect(judgeCell(cell, set('wiskunde-a')).kind).toBe('met');
    expect(judgeCell(cell, set('wiskunde-b')).kind).toBe('met');
  });

  it('a choice with subjects that have no box (nat of nlt of o&o of PgP-T): only nat meets it on the page', () => {
    const cell = needs(['natuurkunde', 'nlt', 'o&o', 'pgp-t']);
    for (const extras of SUBSETS) expect(judgeCell(cell, extras).kind).toBe(extras.has('natuurkunde') ? 'met' : 'missing');
  });

  it('several subjects (nat + wisB): every group must be met, and the missing ones are named in order', () => {
    const cell = needs(['natuurkunde'], ['wiskunde-b']);
    expect(judgeCell(cell, NONE)).toEqual({ kind: 'missing', missing: [['natuurkunde'], ['wiskunde-b']] });
    expect(judgeCell(cell, set('natuurkunde'))).toEqual({ kind: 'missing', missing: [['wiskunde-b']] });
    expect(judgeCell(cell, set('wiskunde-b', 'wiskunde-a'))).toEqual({ kind: 'missing', missing: [['natuurkunde']] });
    expect(judgeCell(cell, set('natuurkunde', 'wiskunde-b'))).toEqual({ kind: 'met', met: [['natuurkunde'], ['wiskunde-b']] });
  });

  it('choices joined ((wisA of wisB) + (nat of nlt of o&o)) and three groups (nat + schk + (wisA of wisB))', () => {
    const two = needs(['wiskunde-a', 'wiskunde-b'], ['natuurkunde', 'nlt', 'o&o']);
    expect(judgeCell(two, set('wiskunde-a'))).toEqual({ kind: 'missing', missing: [['natuurkunde', 'nlt', 'o&o']] });
    expect(judgeCell(two, set('natuurkunde'))).toEqual({ kind: 'missing', missing: [['wiskunde-a', 'wiskunde-b']] });
    expect(judgeCell(two, set('wiskunde-b', 'natuurkunde')).kind).toBe('met');
    const three = needs(['natuurkunde'], ['scheikunde'], ['wiskunde-a', 'wiskunde-b']);
    expect(judgeCell(three, set('natuurkunde'))).toEqual({ kind: 'missing', missing: [['scheikunde'], ['wiskunde-a', 'wiskunde-b']] });
    expect(judgeCell(three, set('natuurkunde', 'scheikunde', 'wiskunde-a')).kind).toBe('met');
  });
});

describe('cellRuleOf', () => {
  it('reads the typed cells; no row admits every profile; without typed cells, direct and bridge, else no right', () => {
    const r = rule(STAR, needs(['natuurkunde']), NO, needs(['natuurkunde'], ['wiskunde-b']));
    expect(cellRuleOf(r, 'ng')).toEqual(needs(['natuurkunde']));
    expect(cellRuleOf(r, 'cm')).toEqual(needs(['natuurkunde'], ['wiskunde-b']));
    const noRow = byId('journalist').admission!;
    for (const pr of HAVO_VWO_PROFILES) expect(cellRuleOf(noRow, pr)).toEqual(STAR);
    const plain = { direct: ['nt'], bridge: { ng: 'biologie' } } as const;
    expect(cellRuleOf(plain, 'nt')).toEqual(STAR);
    expect(cellRuleOf(plain, 'ng')).toEqual(needs(['biologie']));
    expect(cellRuleOf(plain, 'em')).toEqual(NO);
  });

  it('admittingCells: the * profiles, or when there are none, those that need subjects', () => {
    expect(admittingCells(rule(STAR, NO, STAR, NO))).toEqual(['nt', 'em']);
    expect(admittingCells(rule(needs(['biologie']), needs(['natuurkunde']), NO, NO))).toEqual(['nt', 'ng']);
    expect(admittingCells(byId('arts').admission!)).toEqual(['nt', 'ng']);
  });
});

describe('examRouteOf at the programme level', () => {
  const HBO = prof(3, rule(STAR, needs(['natuurkunde', 'nlt']), needs(['natuurkunde'], ['wiskunde-b']), NO));

  it('every group met: open; one group missing: one step, its exam subjects; more: closed with what is missing; #: the admitting profiles', () => {
    for (const level of ['havo', 'vwo'] as const) {
      expect(examRouteOf(HBO, level, 'nt', NONE)).toEqual(OPEN);
      expect(examRouteOf(HBO, level, 'ng', NONE)).toEqual({ state: 'detour', steps: [subject('natuurkunde')], profiles: null });
      expect(examRouteOf(HBO, level, 'ng', set('natuurkunde'))).toEqual(OPEN);
      expect(examRouteOf(HBO, level, 'em', NONE)).toEqual({
        state: 'closed',
        need: { kind: 'subjects', groups: [['natuurkunde'], ['wiskunde-b']] },
      });
      expect(examRouteOf(HBO, level, 'em', set('wiskunde-b'))).toEqual({ state: 'detour', steps: [subject('natuurkunde')], profiles: null });
      expect(examRouteOf(HBO, level, 'em', set('wiskunde-b', 'natuurkunde'))).toEqual(OPEN);
      for (const extras of SUBSETS) {
        expect(examRouteOf(HBO, level, 'cm', extras)).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt'] } });
      }
    }
  });

  it('a choice of exam subjects is one step with either named', () => {
    const p = prof(3, rule(STAR, STAR, STAR, needs(['wiskunde-a', 'wiskunde-b'])));
    expect(examRouteOf(p, 'havo', 'cm', NONE)).toEqual({
      state: 'detour',
      steps: [subject('wiskunde-a'), subject('wiskunde-b')],
      profiles: null,
    });
    expect(examRouteOf(p, 'havo', 'cm', set('wiskunde-b'))).toEqual(OPEN);
  });

  it('hbo follows the havo rule at havo and the vwo rule at vwo', () => {
    const havo = rule(STAR, STAR, STAR, needs(['wiskunde-a', 'wiskunde-b']));
    const p = prof(3, { ...havo, vwo: rule(STAR, STAR, STAR, STAR) });
    expect(examRouteOf(p, 'havo', 'cm', NONE).state).toBe('detour');
    expect(examRouteOf(p, 'vwo', 'cm', NONE)).toEqual(OPEN);
    // The data: Technische Informatica has no row for vwo pupils.
    expect(examRouteOf(byId('software-engineer'), 'havo', 'cm', NONE).state).toBe('detour');
    expect(examRouteOf(byId('software-engineer'), 'havo', 'cm', set('wiskunde-a'))).toEqual(OPEN);
    expect(examRouteOf(byId('software-engineer'), 'vwo', 'cm', NONE)).toEqual(OPEN);
  });

  it('wo from vwo by the cell; from havo one step (vwo 5 or an hbo first year) only when the subjects meet the vwo rule', () => {
    const WO = prof(4, rule(needs(['biologie']), needs(['natuurkunde']), NO, NO));
    expect(examRouteOf(WO, 'vwo', 'nt', set('biologie'))).toEqual(OPEN);
    expect(examRouteOf(WO, 'havo', 'nt', set('biologie'))).toEqual({
      state: 'detour',
      steps: [{ kind: 'vwo5' }, { kind: 'propedeuse' }],
      profiles: null,
    });
    // Otherwise closed: the door names what the vwo rule still misses (even one subject
    // is a second step from havo), or for # the profiles that admit; never the level.
    expect(examRouteOf(WO, 'havo', 'nt', NONE)).toEqual({ state: 'closed', need: { kind: 'subjects', groups: [['biologie']] } });
    expect(examRouteOf(WO, 'havo', 'em', ALL_SUBJECTS)).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt', 'ng'] } });
    const WO_DIRECT = prof(4, rule(STAR, needs(['natuurkunde']), NO, NO));
    expect(examRouteOf(WO_DIRECT, 'havo', 'ng', set('natuurkunde')).state).toBe('detour');
    expect(examRouteOf(WO_DIRECT, 'havo', 'ng', NONE)).toEqual({ state: 'closed', need: { kind: 'subjects', groups: [['natuurkunde']] } });
    expect(examRouteOf(WO_DIRECT, 'havo', 'em', ALL_SUBJECTS)).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt'] } });
    // Without a profile, when no profile reaches it in one step, what is missing is the level.
    expect(examRouteOf(WO, 'havo', null, NONE)).toEqual({ state: 'closed', need: { kind: 'level', from: 'vwo' } });
    expect(examRouteOf(WO, 'havo', null, set('biologie'))).toEqual({
      state: 'detour',
      steps: [{ kind: 'vwo5' }, { kind: 'propedeuse' }],
      profiles: ['nt'],
    });
  });

  it('without a profile: open when every profile opens it with these subjects, else the best a profile reaches', () => {
    expect(examRouteOf(HBO, 'havo', null, NONE)).toEqual({ state: 'detour', steps: [], profiles: ['nt'] });
    const all = prof(3, rule(STAR, needs(['natuurkunde']), needs(['natuurkunde']), needs(['natuurkunde'])));
    expect(examRouteOf(all, 'vwo', null, NONE)).toEqual({ state: 'detour', steps: [], profiles: ['nt'] });
    expect(examRouteOf(all, 'vwo', null, set('natuurkunde'))).toEqual(OPEN);
    const none = prof(3, rule(needs(['biologie']), needs(['natuurkunde']), NO, NO));
    expect(examRouteOf(none, 'havo', null, NONE)).toEqual({
      state: 'detour',
      steps: [subject('biologie'), subject('natuurkunde')],
      profiles: ['nt', 'ng'],
    });
  });
});

describe('examRouteOf below the programme level and at vmbo: the onderbouw routing', () => {
  it('at a vmbo level every door is the onderbouw door, whatever the subjects', () => {
    for (const p of PROFESSIONS) {
      for (const level of ['bbkb', 'gltl'] as const) {
        for (const profile of [null, ...VMBO_DIRECTIONS]) {
          for (const extras of [NONE, ALL_SUBJECTS, set('natuurkunde')]) {
            expect(examRouteOf(p, level, profile, extras), `${p.id} ${level} ${String(profile)}`).toEqual(routeOf(p, level, profile));
          }
        }
      }
    }
  });

  it('no diploma, mbo 2-3 and mbo 4 do not depend on the profile or the subjects', () => {
    for (const p of PROFESSIONS.filter((x) => x.level <= 2)) {
      for (const level of SCHOOL_LEVELS) {
        for (const profile of [null, ...profilesOf(level)]) {
          for (const extras of SUBSETS) expect(examRouteOf(p, level, profile, extras)).toEqual(routeOf(p, level, profile));
        }
      }
    }
  });
});

describe('examRouteOf on the data', () => {
  /** Every level with every profile of it, and "not chosen yet". */
  const cases = SCHOOL_LEVELS.flatMap((level) => [null, ...profilesOf(level)].map((profile) => ({ level, profile })));

  it('without subjects, every door is in the same state as on the onderbouw view', () => {
    for (const p of PROFESSIONS) {
      for (const { level, profile } of cases) {
        expect(examRouteOf(p, level, profile, NONE).state, `${p.id} ${level} ${String(profile)}`).toBe(routeOf(p, level, profile).state);
      }
    }
  });

  it('another subject never makes a door less open', () => {
    for (const p of PROFESSIONS) {
      for (const { level, profile } of cases) {
        for (const extras of SUBSETS) {
          const before = RANK[examRouteOf(p, level, profile, extras).state];
          for (const s of EXAM_SUBJECTS.filter((x) => !extras.has(x))) {
            const after = RANK[examRouteOf(p, level, profile, set(...extras, s)).state];
            expect(after, `${p.id} ${level} ${String(profile)} +${s}`).toBeGreaterThanOrEqual(before);
          }
        }
      }
    }
  });

  it('a detour names its step, and any exam subject it names opens the door', () => {
    for (const p of PROFESSIONS) {
      for (const { level, profile } of cases) {
        for (const extras of SUBSETS) {
          const v = examRouteOf(p, level, profile, extras);
          if (v.state !== 'detour') continue;
          const where = `${p.id} ${level} ${String(profile)} [${[...extras].join(',')}]`;
          expect(v.steps.length + (v.profiles?.length ?? 0), where).toBeGreaterThan(0);
          if (profile === null) continue;
          for (const step of v.steps) {
            if (step.kind === 'subject') expect(examRouteOf(p, level, profile, set(...extras, step.subject)), where).toEqual(OPEN);
          }
        }
      }
    }
  });

  it('a door closed for subjects opens with one exam subject of each missing group; a door closed for a profile names profiles that reach it', () => {
    let subjects = 0;
    for (const p of PROFESSIONS) {
      for (const level of ['havo', 'vwo'] as const) {
        for (const profile of HAVO_VWO_PROFILES) {
          for (const extras of SUBSETS) {
            const v = examRouteOf(p, level, profile, extras);
            if (v.state !== 'closed') continue;
            const where = `${p.id} ${level} ${profile} [${[...extras].join(',')}]`;
            // wo from havo: with every subject the vwo rule asks, it is the one step via vwo 5.
            const woFromHavo = p.level === 4 && level === 'havo';
            if (v.need.kind === 'subjects') {
              subjects++;
              if (!woFromHavo) expect(v.need.groups.length, where).toBeGreaterThan(1);
              const add = v.need.groups.map((g) => g.find((s): s is ExamSubject => (EXAM_SUBJECTS as readonly string[]).includes(s))!);
              expect(examRouteOf(p, level, profile, set(...extras, ...add)).state, where).toBe(woFromHavo ? 'detour' : 'open');
            } else if (v.need.kind === 'profile') {
              expect(v.need.profiles.length, where).toBeGreaterThan(0);
              // From havo a named profile reaches it with the subjects its rule asks.
              const theirs = woFromHavo ? ALL_SUBJECTS : extras;
              for (const other of v.need.profiles) expect(examRouteOf(p, level, other, theirs).state, `${where} -> ${other}`).not.toBe('closed');
            } else {
              expect.fail(`${where}: with a profile chosen, no door at havo or vwo names a level`);
            }
          }
        }
      }
    }
    expect(subjects).toBeGreaterThan(0);
  });

  it('pins the real rows: Mechatronica, Electrical Engineering, Farmacie, Geneeskunde', () => {
    const mecha = byId('mechatronica-engineer');
    expect(examRouteOf(mecha, 'havo', 'cm', NONE)).toEqual({
      state: 'closed',
      need: { kind: 'subjects', groups: [['wiskunde-a', 'wiskunde-b'], ['natuurkunde', 'nlt', 'o&o', 'pgp-t']] },
    });
    expect(examRouteOf(mecha, 'havo', 'cm', set('wiskunde-a'))).toEqual({ state: 'detour', steps: [subject('natuurkunde')], profiles: null });
    expect(examRouteOf(mecha, 'havo', 'cm', set('wiskunde-a', 'natuurkunde'))).toEqual(OPEN);
    expect(examRouteOf(mecha, 'vwo', 'em', set('natuurkunde'))).toEqual(OPEN);

    const ee = byId('electrical-engineer');
    expect(examRouteOf(ee, 'vwo', 'ng', NONE)).toEqual({ state: 'closed', need: { kind: 'subjects', groups: [['natuurkunde'], ['wiskunde-b']] } });
    expect(examRouteOf(ee, 'vwo', 'ng', set('natuurkunde'))).toEqual({ state: 'detour', steps: [subject('wiskunde-b')], profiles: null });
    expect(examRouteOf(ee, 'vwo', 'ng', set('natuurkunde', 'wiskunde-b'))).toEqual(OPEN);
    expect(examRouteOf(ee, 'havo', 'ng', set('natuurkunde', 'wiskunde-b')).state).toBe('detour');

    const farm = byId('apotheker');
    expect(examRouteOf(farm, 'vwo', 'cm', set('natuurkunde'))).toEqual({
      state: 'closed',
      need: { kind: 'subjects', groups: [['scheikunde'], ['wiskunde-a', 'wiskunde-b']] },
    });
    expect(examRouteOf(farm, 'vwo', 'cm', set('natuurkunde', 'scheikunde'))).toEqual({
      state: 'detour',
      steps: [subject('wiskunde-a'), subject('wiskunde-b')],
      profiles: null,
    });

    const arts = byId('arts');
    expect(examRouteOf(arts, 'vwo', 'em', ALL_SUBJECTS)).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt', 'ng'] } });
    expect(examRouteOf(arts, 'vwo', 'nt', set('biologie'))).toEqual(OPEN);
    expect(examRouteOf(arts, 'havo', 'nt', set('biologie')).state).toBe('detour');
    expect(examRouteOf(arts, 'havo', 'nt', NONE)).toEqual({ state: 'closed', need: { kind: 'subjects', groups: [['biologie']] } });
    expect(examRouteOf(arts, 'havo', null, NONE)).toEqual({ state: 'closed', need: { kind: 'level', from: 'vwo' } });
    // # from havo too: the profiles that admit, as at vwo (arts, chirurg and dierenarts share the cells).
    for (const id of ['arts', 'chirurg', 'dierenarts']) {
      for (const profile of ['em', 'cm'] as const) {
        expect(examRouteOf(byId(id), 'havo', profile, ALL_SUBJECTS), `${id} ${profile}`).toEqual({
          state: 'closed',
          need: { kind: 'profile', profiles: ['nt', 'ng'] },
        });
      }
    }
    // A wo row with a direct profile: from havo, N&G names the subjects of its vwo cell (Natuurkunde: nat + wisB).
    const sci = byId('wetenschapper');
    expect(examRouteOf(sci, 'havo', 'ng', NONE)).toEqual({ state: 'closed', need: { kind: 'subjects', groups: [['natuurkunde'], ['wiskunde-b']] } });
    expect(examRouteOf(sci, 'havo', 'ng', set('natuurkunde'))).toEqual({ state: 'closed', need: { kind: 'subjects', groups: [['wiskunde-b']] } });
    expect(examRouteOf(sci, 'havo', 'ng', set('natuurkunde', 'wiskunde-b')).state).toBe('detour');
  });
});

describe('counts on the profile buttons', () => {
  const counts = (level: SchoolLevel, extras: ReadonlySet<ExamSubject>) =>
    Object.fromEntries(examProfileCounts(PROFESSIONS, level, extras).map((c) => [c.profile, c.count]));

  it('each count is the number of open doors with that profile and these subjects', () => {
    for (const level of ['havo', 'vwo'] as const) {
      for (const extras of [NONE, set('natuurkunde'), ALL_SUBJECTS]) {
        for (const c of examProfileCounts(PROFESSIONS, level, extras)) {
          expect(c.kind).toBe('opens');
          expect(c.count).toBe(PROFESSIONS.filter((p) => examRouteOf(p, level, c.profile, extras).state === 'open').length);
        }
      }
    }
    for (const level of ['bbkb', 'gltl'] as const) expect(examProfileCounts(PROFESSIONS, level, ALL_SUBJECTS)).toEqual(profileCounts(PROFESSIONS, level));
  });

  // The counts of the bovenbouw page, per level and profile. A change here is a change in
  // the data or the judgement: update these numbers on purpose, together with it.
  it('the counts per level and profile are stable', () => {
    expect(counts('havo', NONE)).toEqual({ nt: 28, ng: 27, em: 27, cm: 23 });
    expect(counts('vwo', NONE)).toEqual({ nt: 33, ng: 28, em: 28, cm: 26 });
    expect(counts('havo', set('natuurkunde'))).toEqual({ nt: 28, ng: 28, em: 28, cm: 23 });
    expect(counts('vwo', set('natuurkunde'))).toEqual({ nt: 33, ng: 33, em: 29, cm: 26 });
    expect(counts('havo', set('wiskunde-a'))).toEqual({ nt: 28, ng: 27, em: 27, cm: 27 });
    expect(counts('vwo', set('natuurkunde', 'wiskunde-b'))).toEqual({ nt: 33, ng: 36, em: 32, cm: 32 });
    expect(counts('havo', ALL_SUBJECTS)).toEqual({ nt: 28, ng: 28, em: 28, cm: 28 });
    expect(counts('vwo', ALL_SUBJECTS)).toEqual({ nt: 36, ng: 36, em: 33, cm: 33 });
    expect(counts('gltl', ALL_SUBJECTS)).toEqual({ techniek: 9, zorg: 4, economie: 1, groen: 1 });
    expect(counts('bbkb', NONE)).toEqual(counts('gltl', NONE));
  });
});
