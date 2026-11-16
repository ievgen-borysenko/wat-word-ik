import {
  HAVO_VWO_PROFILES,
  SCHOOL_LEVELS,
  VMBO_DIRECTIONS,
  type ExamSubject,
  type HavoVwoProfile,
  type ProfileAdmission,
  type Profession,
  type SchoolLevel,
  type SchoolProfile,
  type VmboDirection,
} from './types';

/*
 * The onderbouw view: what is open from a school level and a profile (demo rules).
 *
 *   open    this level and profile lead there directly;
 *   detour  reachable with one extra step, and the step is named;
 *   closed  not on this route for now: it needs another level or profile, and
 *           the view says which. Nothing is shown as closed for good.
 *
 * The profession's `level` stays the source of its diploma level:
 *
 *   0, 1 (no diploma, mbo 2-3)  open from every school level;
 *   2 (mbo 4)                   open from vmbo-gl/tl, havo and vwo. From vmbo-bb/kb
 *                               a detour: the page reads bb/kb as bb, the stricter
 *                               half, so mbo 2 comes first (with kb it is direct);
 *   3 (hbo)                     from havo and vwo by profile (`admission`): direct,
 *                               one extra subject, or another profile. From vmbo-gl/tl
 *                               a detour via mbo 4 (where profile rules do not apply)
 *                               or havo 4. From vmbo-bb/kb closed: from vmbo-gl/tl up;
 *   4 (wo)                      from vwo by profile, as hbo. From havo with a direct
 *                               profile a detour via vwo 5 or an hbo first year
 *                               (propedeuse); with another profile closed. From vmbo
 *                               closed: from havo up.
 *
 * A vmbo direction never closes anything: a vmbo diploma of any direction admits
 * to mbo. It only says which mbo professions fit it best (fitOf).
 *
 * Without a chosen profile, havo and vwo show what the level alone decides: open
 * when every profile opens it, otherwise the best any profile reaches, with the
 * profiles that reach it.
 *
 * Order of the levels. Without a profile, and with a profile that admits to the
 * programme (direct or with one extra subject), a higher level never shows a door
 * as less open. A havo or vwo profile without admission is the one exception: it
 * closes an hbo or wo door, with the profiles that do admit, while vmbo-gl/tl shows
 * the same hbo door one step away via mbo 4. That is deliberate: from vmbo-gl/tl
 * mbo 4 is the normal next school; for a havo or vwo pupil it is a route of several
 * years, not one extra step, and showing it would erase what the profile changes.
 */

export type RouteState = 'open' | 'detour' | 'closed';

/** One extra step. A detour lists one or two of them as alternatives: either is enough. */
export type RouteStep =
  /** An extra exam subject in the profile. */
  | { readonly kind: 'subject'; readonly subject: ExamSubject }
  /** vmbo-bb: an mbo 2 diploma first (with kb, mbo 4 is direct). */
  | { readonly kind: 'mbo2' }
  /** mbo 4 first, then hbo: the profile rules do not apply on that route. */
  | { readonly kind: 'mbo4' }
  /** vmbo-gl/tl diploma with one extra subject, then havo 4. */
  | { readonly kind: 'havo4' }
  /** havo diploma, then vwo 5. */
  | { readonly kind: 'vwo5' }
  /** havo, then the first year of hbo (propedeuse), then wo. */
  | { readonly kind: 'propedeuse' };

/** What a closed door needs: a level from `from` up, or one of these profiles at this level. */
export type ClosedNeed =
  | { readonly kind: 'level'; readonly from: SchoolLevel }
  | { readonly kind: 'profile'; readonly profiles: readonly HavoVwoProfile[] };

export type RouteView =
  | { readonly state: 'open' }
  | {
      readonly state: 'detour';
      /** Alternatives, either is enough; empty when choosing one of `profiles` is the whole step. */
      readonly steps: readonly RouteStep[];
      /** Without a chosen profile: the profiles that reach this; null when every profile does. */
      readonly profiles: readonly HavoVwoProfile[] | null;
    }
  | { readonly state: 'closed'; readonly need: ClosedNeed };

const OPEN: RouteView = { state: 'open' };

export function isVmbo(level: SchoolLevel): boolean {
  return level === 'bbkb' || level === 'gltl';
}

/** The profile buttons of a level: four vmbo directions, or the four havo and vwo profiles. */
export function profilesOf(level: SchoolLevel): readonly SchoolProfile[] {
  return isVmbo(level) ? VMBO_DIRECTIONS : HAVO_VWO_PROFILES;
}

/** `profile` when it belongs to `level`, else null ("not chosen yet"). */
export function validProfile(level: SchoolLevel, profile: string | null): SchoolProfile | null {
  return profile !== null && (profilesOf(level) as readonly string[]).includes(profile) ? (profile as SchoolProfile) : null;
}

function isHavoVwoProfile(profile: SchoolProfile | null): profile is HavoVwoProfile {
  return profile !== null && (HAVO_VWO_PROFILES as readonly string[]).includes(profile);
}

/** Every profile direct: the fallback for a profession without admission data (the data test forbids that). */
const ANY_PROFILE: ProfileAdmission = { direct: HAVO_VWO_PROFILES, bridge: {} };

function admissionOf(p: Profession): ProfileAdmission {
  return p.admission ?? ANY_PROFILE;
}

/** hbo from havo or vwo, and wo from vwo: by the profile. */
function byAdmission(p: Profession, profile: HavoVwoProfile): RouteView {
  const a = admissionOf(p);
  if (a.direct.includes(profile)) return OPEN;
  const subject = a.bridge[profile];
  if (subject !== undefined) return { state: 'detour', steps: [{ kind: 'subject', subject }], profiles: null };
  return { state: 'closed', need: { kind: 'profile', profiles: a.direct } };
}

/** wo from havo: one step via vwo 5 or an hbo first year, with a direct profile only. */
function woFromHavo(p: Profession, profile: HavoVwoProfile): RouteView {
  const a = admissionOf(p);
  if (a.direct.includes(profile)) {
    return { state: 'detour', steps: [{ kind: 'vwo5' }, { kind: 'propedeuse' }], profiles: null };
  }
  return { state: 'closed', need: { kind: 'profile', profiles: a.direct } };
}

function sameStep(a: RouteStep, b: RouteStep): boolean {
  return a.kind === b.kind && (a.kind !== 'subject' || (b.kind === 'subject' && a.subject === b.subject));
}

/** No profile chosen yet: what the level alone decides, over every profile. */
function overProfiles(byProfile: (profile: HavoVwoProfile) => RouteView): RouteView {
  const views = HAVO_VWO_PROFILES.map((profile) => ({ profile, view: byProfile(profile) }));
  const reaching = (state: RouteState) => views.filter((v) => v.view.state === state);
  const open = reaching('open');
  if (open.length === views.length) return OPEN;
  if (open.length > 0) return { state: 'detour', steps: [], profiles: open.map((v) => v.profile) };
  const detour = reaching('detour');
  if (detour.length > 0) {
    const steps: RouteStep[] = [];
    for (const { view } of detour) {
      if (view.state !== 'detour') continue;
      for (const s of view.steps) if (!steps.some((t) => sameStep(s, t))) steps.push(s);
    }
    return { state: 'detour', steps, profiles: detour.length === views.length ? null : detour.map((v) => v.profile) };
  }
  // Every profile closed: no havo or vwo route is shaped like this, but say what the first one needs.
  return views[0]?.view ?? OPEN;
}

/** What a level and a profile (or none yet) say about one profession. */
export function routeOf(p: Profession, level: SchoolLevel, profile: SchoolProfile | null): RouteView {
  const chosen = isHavoVwoProfile(profile) ? profile : null;
  const pick = (byProfile: (profile: HavoVwoProfile) => RouteView) =>
    chosen === null ? overProfiles(byProfile) : byProfile(chosen);
  switch (p.level) {
    case 0:
    case 1:
      return OPEN;
    case 2:
      return level === 'bbkb' ? { state: 'detour', steps: [{ kind: 'mbo2' }], profiles: null } : OPEN;
    case 3:
      if (level === 'bbkb') return { state: 'closed', need: { kind: 'level', from: 'gltl' } };
      if (level === 'gltl') return { state: 'detour', steps: [{ kind: 'mbo4' }, { kind: 'havo4' }], profiles: null };
      return pick((pr) => byAdmission(p, pr));
    case 4:
      if (isVmbo(level)) return { state: 'closed', need: { kind: 'level', from: 'havo' } };
      if (level === 'havo') return pick((pr) => woFromHavo(p, pr));
      return pick((pr) => byAdmission(p, pr));
  }
}

/** How a vmbo direction relates to an mbo profession: the direction that fits best, and whether it is yours. */
export interface Fit {
  readonly direction: VmboDirection;
  /** null while no direction is chosen. */
  readonly yours: boolean | null;
}

/** Only for mbo professions at a vmbo level; never a reason to close a door. */
export function fitOf(p: Profession, level: SchoolLevel, profile: SchoolProfile | null): Fit | null {
  if (!isVmbo(level) || p.vmbo === undefined) return null;
  const chosen = profile !== null && (VMBO_DIRECTIONS as readonly string[]).includes(profile) ? profile : null;
  return { direction: p.vmbo, yours: chosen === null ? null : chosen === p.vmbo };
}

export interface RouteCounts {
  readonly open: number;
  readonly detour: number;
  readonly closed: number;
  readonly total: number;
}

export function routeCounts(views: Iterable<RouteView>): RouteCounts {
  let open = 0;
  let detour = 0;
  let closed = 0;
  for (const v of views) {
    if (v.state === 'open') open++;
    else if (v.state === 'detour') detour++;
    else closed++;
  }
  return { open, detour, closed, total: open + detour + closed };
}

/**
 * The small count on a profile button: for havo and vwo, how many doors that profile
 * opens (`opens`); for a vmbo direction, how many mbo professions fit it best
 * (`fits`), because a vmbo direction opens and closes nothing.
 */
export interface ProfileCount {
  readonly profile: SchoolProfile;
  readonly kind: 'opens' | 'fits';
  readonly count: number;
}

export function profileCounts(professions: readonly Profession[], level: SchoolLevel): ProfileCount[] {
  if (isVmbo(level)) {
    return VMBO_DIRECTIONS.map((profile) => ({
      profile,
      kind: 'fits',
      count: professions.filter((p) => p.vmbo === profile).length,
    }));
  }
  return HAVO_VWO_PROFILES.map((profile) => ({
    profile,
    kind: 'opens',
    count: professions.filter((p) => routeOf(p, level, profile).state === 'open').length,
  }));
}

/** Levels in order, for "from havo up". */
export function levelRank(level: SchoolLevel): number {
  return SCHOOL_LEVELS.indexOf(level);
}
