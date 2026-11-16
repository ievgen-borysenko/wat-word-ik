import { describe, expect, it } from 'vitest';
import { PROFESSIONS, PROFESSION_BY_ID } from '../data/professions';
import {
  admissionAt,
  admittingProfiles,
  fitOf,
  isVmbo,
  levelRank,
  profileCounts,
  profilesOf,
  routeCounts,
  routeOf,
  validProfile,
  type RouteView,
} from './route';
import { HAVO_VWO_PROFILES, SCHOOL_LEVELS, VMBO_DIRECTIONS, type Profession, type SchoolLevel, type SchoolProfile } from './types';

/** A made-up profession with only what the routing reads. */
function prof(level: Profession['level'], extra: Partial<Profession> = {}): Profession {
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
    ...extra,
  };
}

const HBO = prof(3, { admission: { direct: ['nt'], bridge: { ng: 'natuurkunde' } } });
const WO = prof(4, { admission: { direct: ['ng'], bridge: { nt: 'biologie' } } });
/** No direct profile: every profile that admits needs an extra subject, like wo Geneeskunde. */
const WO_NO_DIRECT = prof(4, { admission: { direct: [], bridge: { nt: 'biologie', ng: 'natuurkunde' } } });
const RANK = { closed: 0, detour: 1, open: 2 } as const;
const byId = (id: string) => PROFESSION_BY_ID.get(id)!;

describe('levels and profiles', () => {
  it('vmbo levels get the four directions, havo and vwo the four profiles', () => {
    expect(profilesOf('bbkb')).toEqual(VMBO_DIRECTIONS);
    expect(profilesOf('gltl')).toEqual(VMBO_DIRECTIONS);
    expect(profilesOf('havo')).toEqual(HAVO_VWO_PROFILES);
    expect(profilesOf('vwo')).toEqual(HAVO_VWO_PROFILES);
    expect(SCHOOL_LEVELS.filter(isVmbo)).toEqual(['bbkb', 'gltl']);
    expect(SCHOOL_LEVELS.map(levelRank)).toEqual([0, 1, 2, 3]);
  });

  it('a profile counts only on its own level', () => {
    expect(validProfile('havo', 'nt')).toBe('nt');
    expect(validProfile('vwo', 'cm')).toBe('cm');
    expect(validProfile('gltl', 'zorg')).toBe('zorg');
    expect(validProfile('havo', 'zorg')).toBeNull();
    expect(validProfile('bbkb', 'nt')).toBeNull();
    expect(validProfile('vwo', null)).toBeNull();
    expect(validProfile('vwo', '__proto__')).toBeNull();
  });
});

describe('routeOf', () => {
  it('no diploma and mbo 2-3: open from every level, whatever the profile', () => {
    for (const level of SCHOOL_LEVELS) {
      for (const profile of [null, ...profilesOf(level)]) {
        expect(routeOf(prof(0), level, profile)).toEqual({ state: 'open' });
        expect(routeOf(prof(1, { vmbo: 'zorg' }), level, profile)).toEqual({ state: 'open' });
      }
    }
  });

  it('mbo 4: open from vmbo-gl/tl up, one step (mbo 2 first) from vmbo-bb/kb', () => {
    const p = prof(2, { vmbo: 'techniek' });
    expect(routeOf(p, 'bbkb', null)).toEqual({ state: 'detour', steps: [{ kind: 'mbo2' }], profiles: null });
    for (const direction of VMBO_DIRECTIONS) expect(routeOf(p, 'bbkb', direction).state).toBe('detour');
    for (const level of ['gltl', 'havo', 'vwo'] as const) expect(routeOf(p, level, null)).toEqual({ state: 'open' });
  });

  it('a vmbo direction never closes an mbo door: it only says what fits', () => {
    for (const p of PROFESSIONS.filter((x) => x.level === 1 || x.level === 2)) {
      for (const level of ['bbkb', 'gltl'] as const) {
        const none = routeOf(p, level, null);
        for (const direction of VMBO_DIRECTIONS) expect(routeOf(p, level, direction), p.id).toEqual(none);
        expect(none.state, p.id).not.toBe('closed');
      }
    }
  });

  it('hbo from havo and vwo: direct, one extra subject, or another profile', () => {
    for (const level of ['havo', 'vwo'] as const) {
      expect(routeOf(HBO, level, 'nt')).toEqual({ state: 'open' });
      expect(routeOf(HBO, level, 'ng')).toEqual({
        state: 'detour',
        steps: [{ kind: 'subject', subject: 'natuurkunde' }],
        profiles: null,
      });
      expect(routeOf(HBO, level, 'em')).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt'] } });
    }
  });

  it('hbo from vmbo: via mbo 4 or havo 4 from gl/tl, whatever the direction; from bb/kb not yet', () => {
    for (const profile of [null, ...VMBO_DIRECTIONS]) {
      expect(routeOf(HBO, 'gltl', profile)).toEqual({
        state: 'detour',
        steps: [{ kind: 'mbo4' }, { kind: 'havo4' }],
        profiles: null,
      });
      expect(routeOf(HBO, 'bbkb', profile)).toEqual({ state: 'closed', need: { kind: 'level', from: 'gltl' } });
    }
  });

  it('wo from vwo by profile; from havo one step with a direct profile; from vmbo from havo up', () => {
    expect(routeOf(WO, 'vwo', 'ng')).toEqual({ state: 'open' });
    expect(routeOf(WO, 'vwo', 'nt')).toEqual({ state: 'detour', steps: [{ kind: 'subject', subject: 'biologie' }], profiles: null });
    expect(routeOf(WO, 'vwo', 'cm')).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['ng'] } });
    expect(routeOf(WO, 'havo', 'ng')).toEqual({
      state: 'detour',
      steps: [{ kind: 'vwo5' }, { kind: 'propedeuse' }],
      profiles: null,
    });
    // An extra subject and a move up are two steps: not on this route for now.
    expect(routeOf(WO, 'havo', 'nt')).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['ng'] } });
    for (const level of ['bbkb', 'gltl'] as const) {
      expect(routeOf(WO, level, null)).toEqual({ state: 'closed', need: { kind: 'level', from: 'havo' } });
    }
  });

  it('hbo at vwo uses the vwo rule; at havo and below the havo rule', () => {
    const twoRules = prof(3, {
      admission: { direct: ['nt'], bridge: {}, vwo: { direct: ['nt', 'ng'], bridge: { cm: 'wiskunde-a' } } },
    });
    expect(routeOf(twoRules, 'havo', 'ng')).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt'] } });
    expect(routeOf(twoRules, 'vwo', 'ng')).toEqual({ state: 'open' });
    expect(routeOf(twoRules, 'vwo', 'cm')).toEqual({ state: 'detour', steps: [{ kind: 'subject', subject: 'wiskunde-a' }], profiles: null });
    expect(routeOf(twoRules, 'vwo', 'em')).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt', 'ng'] } });
    expect(admissionAt(twoRules, 'gltl')).toBe(twoRules.admission);
    // Without a vwo rule, vwo uses the havo rule; wo never reads one.
    expect(admissionAt(HBO, 'vwo')).toBe(HBO.admission);
    // The data: Technische Informatica has no row for vwo pupils, so C&M is open from vwo only.
    expect(routeOf(byId('software-engineer'), 'havo', 'cm').state).toBe('detour');
    expect(routeOf(byId('software-engineer'), 'vwo', 'cm').state).toBe('open');
  });

  it('wo without a direct profile: one subject from vwo, closed from vwo up below it, other profiles name the bridged ones', () => {
    expect(routeOf(WO_NO_DIRECT, 'vwo', 'nt')).toEqual({ state: 'detour', steps: [{ kind: 'subject', subject: 'biologie' }], profiles: null });
    expect(routeOf(WO_NO_DIRECT, 'vwo', 'ng')).toEqual({ state: 'detour', steps: [{ kind: 'subject', subject: 'natuurkunde' }], profiles: null });
    expect(routeOf(WO_NO_DIRECT, 'vwo', 'em')).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt', 'ng'] } });
    expect(routeOf(WO_NO_DIRECT, 'vwo', null)).toEqual({
      state: 'detour',
      steps: [
        { kind: 'subject', subject: 'biologie' },
        { kind: 'subject', subject: 'natuurkunde' },
      ],
      profiles: ['nt', 'ng'],
    });
    for (const profile of [null, ...HAVO_VWO_PROFILES]) {
      expect(routeOf(WO_NO_DIRECT, 'havo', profile)).toEqual({ state: 'closed', need: { kind: 'level', from: 'vwo' } });
    }
    for (const level of ['bbkb', 'gltl'] as const) {
      expect(routeOf(WO_NO_DIRECT, level, null)).toEqual({ state: 'closed', need: { kind: 'level', from: 'vwo' } });
    }
  });

  it('without a profile: what the level alone decides, and which profiles reach it', () => {
    expect(routeOf(HBO, 'havo', null)).toEqual({ state: 'detour', steps: [], profiles: ['nt'] });
    expect(routeOf(WO, 'havo', null)).toEqual({
      state: 'detour',
      steps: [{ kind: 'vwo5' }, { kind: 'propedeuse' }],
      profiles: ['ng'],
    });
    const anyProfile = prof(4, { admission: { direct: [...HAVO_VWO_PROFILES], bridge: {} } });
    expect(routeOf(anyProfile, 'vwo', null)).toEqual({ state: 'open' });
    expect(routeOf(anyProfile, 'havo', null)).toEqual({
      state: 'detour',
      steps: [{ kind: 'vwo5' }, { kind: 'propedeuse' }],
      profiles: null,
    });
    // A vmbo direction passed on havo is "not chosen yet".
    expect(routeOf(HBO, 'havo', 'zorg')).toEqual(routeOf(HBO, 'havo', null));
  });

  /** True when the havo/vwo profile admits to the profession: no admission rule, direct, or one extra subject. */
  const admits = (p: Profession, profile: (typeof HAVO_VWO_PROFILES)[number]) =>
    p.admission === undefined || p.admission.direct.includes(profile) || p.admission.bridge[profile] !== undefined;

  it('without a profile, a higher level never shows a door as less open', () => {
    for (const p of PROFESSIONS) {
      for (let i = 1; i < SCHOOL_LEVELS.length; i++) {
        const lower = SCHOOL_LEVELS[i - 1]!;
        const upper = SCHOOL_LEVELS[i]!;
        expect(RANK[routeOf(p, upper, null).state], `${p.id} ${lower} -> ${upper}`).toBeGreaterThanOrEqual(
          RANK[routeOf(p, lower, null).state],
        );
      }
    }
  });

  it('with a profile that admits, a higher level never shows a door as less open: vmbo-gl/tl, havo, vwo', () => {
    for (const p of PROFESSIONS) {
      for (const profile of HAVO_VWO_PROFILES) {
        const vwo = RANK[routeOf(p, 'vwo', profile).state];
        const havo = RANK[routeOf(p, 'havo', profile).state];
        expect(vwo, `${p.id} ${profile} havo -> vwo`).toBeGreaterThanOrEqual(havo);
        if (!admits(p, profile)) continue;
        for (const direction of [null, ...VMBO_DIRECTIONS]) {
          expect(havo, `${p.id} ${profile} gltl -> havo`).toBeGreaterThanOrEqual(RANK[routeOf(p, 'gltl', direction).state]);
        }
      }
    }
  });

  it('a havo or vwo profile without admission closes hbo and wo doors, with the profiles that admit; vmbo-gl/tl shows hbo via mbo 4', () => {
    let pinned = 0;
    for (const p of PROFESSIONS) {
      for (const profile of HAVO_VWO_PROFILES) {
        if (admits(p, profile)) continue;
        for (const level of ['havo', 'vwo'] as const) {
          // hbo at vwo uses its vwo rule, which may admit this profile.
          const rule = admissionAt(p, level);
          if (rule.direct.includes(profile) || rule.bridge[profile] !== undefined) continue;
          // wo without a direct profile is two steps from havo for every profile: it names vwo.
          const need =
            p.level === 4 && level === 'havo' && rule.direct.length === 0
              ? { kind: 'level', from: 'vwo' }
              : { kind: 'profile', profiles: admittingProfiles(rule) };
          expect(routeOf(p, level, profile), `${p.id} ${level} ${profile}`).toEqual({ state: 'closed', need });
        }
        if (p.level === 3) {
          expect(routeOf(p, 'gltl', null).state, p.id).toBe('detour');
          pinned++;
        }
      }
    }
    expect(pinned).toBeGreaterThan(0);
  });

  it('the exception, pinned: havo with E&M on an N&T-only hbo programme is closed with the profile; vmbo-gl/tl is one step via mbo 4', () => {
    const ntOnly = prof(3, { admission: { direct: ['nt'], bridge: {} } });
    expect(routeOf(ntOnly, 'havo', 'em')).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt'] } });
    expect(routeOf(ntOnly, 'vwo', 'em')).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt'] } });
    expect(routeOf(ntOnly, 'gltl', 'economie')).toEqual({
      state: 'detour',
      steps: [{ kind: 'mbo4' }, { kind: 'havo4' }],
      profiles: null,
    });
    // The same in the data: hbo Mechatronica asks two extra subjects of C&M.
    expect(routeOf(byId('mechatronica-engineer'), 'havo', 'cm')).toEqual({
      state: 'closed',
      need: { kind: 'profile', profiles: ['nt'] },
    });
    expect(routeOf(byId('mechatronica-engineer'), 'gltl', null).state).toBe('detour');
  });

  it('"not chosen yet" is open only when every profile opens it, else the best a profile reaches, as a step', () => {
    for (const p of PROFESSIONS) {
      for (const level of ['havo', 'vwo'] as const) {
        const none = RANK[routeOf(p, level, null).state];
        const best = Math.max(...HAVO_VWO_PROFILES.map((pr) => RANK[routeOf(p, level, pr).state]));
        const all = HAVO_VWO_PROFILES.every((pr) => routeOf(p, level, pr).state === 'open');
        expect(none, `${p.id} ${level}`).toBe(all ? 2 : Math.min(best, 1));
      }
    }
  });

  it('a closed door names a level or profiles that do reach it', () => {
    const check = (p: Profession, level: SchoolLevel, profile: SchoolProfile | null, view: RouteView) => {
      if (view.state !== 'closed') return;
      const where = `${p.id} ${level} ${String(profile)}`;
      if (view.need.kind === 'level') {
        const from = view.need.from;
        expect(levelRank(from), where).toBeGreaterThan(levelRank(level));
        expect(routeOf(p, from, null).state, where).not.toBe('closed');
        for (const lower of SCHOOL_LEVELS.filter((l) => levelRank(l) < levelRank(from))) {
          expect(routeOf(p, lower, null).state, `${where}, ${lower}`).toBe('closed');
        }
      } else if (view.need.kind === 'profile') {
        expect(view.need.profiles.length, where).toBeGreaterThan(0);
        for (const other of view.need.profiles) expect(routeOf(p, level, other).state, `${where} -> ${other}`).not.toBe('closed');
      } else {
        expect.fail(`${where}: the onderbouw view never names subjects for a closed door`);
      }
    };
    for (const p of PROFESSIONS) {
      for (const level of SCHOOL_LEVELS) {
        for (const profile of [null, ...profilesOf(level)]) check(p, level, profile, routeOf(p, level, profile));
      }
    }
  });

  it('a detour always names its step', () => {
    for (const p of PROFESSIONS) {
      for (const level of SCHOOL_LEVELS) {
        for (const profile of [null, ...profilesOf(level)]) {
          const v = routeOf(p, level, profile);
          if (v.state === 'detour') expect(v.steps.length + (v.profiles?.length ?? 0), `${p.id} ${level}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the data (Ratho 2026): Geneeskunde from vwo N&T plus biology or N&G plus physics, not E&M; the lawyer from every profile', () => {
    expect(routeOf(byId('arts'), 'vwo', 'nt')).toMatchObject({ state: 'detour', steps: [{ kind: 'subject', subject: 'biologie' }] });
    expect(routeOf(byId('arts'), 'vwo', 'ng')).toMatchObject({ state: 'detour', steps: [{ kind: 'subject', subject: 'natuurkunde' }] });
    expect(routeOf(byId('arts'), 'vwo', 'em')).toEqual({ state: 'closed', need: { kind: 'profile', profiles: ['nt', 'ng'] } });
    expect(routeOf(byId('arts'), 'havo', null)).toEqual({ state: 'closed', need: { kind: 'level', from: 'vwo' } });
    for (const profile of HAVO_VWO_PROFILES) expect(routeOf(byId('advocaat'), 'vwo', profile).state).toBe('open');
  });
});

describe('fitOf', () => {
  it('only for mbo professions at a vmbo level', () => {
    const kok = byId('kok');
    expect(fitOf(kok, 'gltl', null)).toEqual({ direction: 'economie', yours: null });
    expect(fitOf(kok, 'bbkb', 'economie')).toEqual({ direction: 'economie', yours: true });
    expect(fitOf(kok, 'gltl', 'zorg')).toEqual({ direction: 'economie', yours: false });
    expect(fitOf(kok, 'havo', 'nt')).toBeNull();
    expect(fitOf(byId('schoonmaker'), 'gltl', 'zorg')).toBeNull();
    expect(fitOf(byId('arts'), 'gltl', 'zorg')).toBeNull();
  });
});

describe('counts', () => {
  it('counts the three states', () => {
    const views: RouteView[] = [
      { state: 'open' },
      { state: 'open' },
      { state: 'detour', steps: [{ kind: 'mbo4' }], profiles: null },
      { state: 'closed', need: { kind: 'level', from: 'havo' } },
    ];
    expect(routeCounts(views)).toEqual({ open: 2, detour: 1, closed: 1, total: 4 });
  });

  it('a profile button counts the doors it opens; a vmbo direction counts the mbo doors that fit it', () => {
    for (const level of ['havo', 'vwo'] as const) {
      for (const c of profileCounts(PROFESSIONS, level)) {
        expect(c.kind).toBe('opens');
        expect(c.count).toBe(PROFESSIONS.filter((p) => routeOf(p, level, c.profile).state === 'open').length);
      }
    }
    const mbo = PROFESSIONS.filter((p) => p.level === 1 || p.level === 2).length;
    for (const level of ['bbkb', 'gltl'] as const) {
      const counts = profileCounts(PROFESSIONS, level);
      expect(counts.map((c) => c.kind)).toEqual(['fits', 'fits', 'fits', 'fits']);
      expect(counts.reduce((n, c) => n + c.count, 0)).toBe(mbo);
    }
  });
});
