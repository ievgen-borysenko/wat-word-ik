import { isVmbo, profileCounts, routeWith, type ProfileCount, type ProfileJudge, type RouteView } from './route';
import {
  EXAM_SUBJECTS,
  HAVO_VWO_PROFILES,
  type CellRule,
  type ExamSubject,
  type HavoVwoProfile,
  type ProfileRule,
  type Profession,
  type RathoSubject,
  type SchoolLevel,
  type SchoolProfile,
} from './types';

/*
 * The bovenbouw view (bovenbouw.html): after the profile choice. Admission to hbo and wo
 * is judged on what the pupil actually has: the profile and the exam subjects the pupil
 * takes on top of it (the boxes on the page), against the regulation's cell for that
 * profile in full (`source.rules`, see AdmissionSource in types.ts):
 *
 *   `*`, or no row     open;
 *   every group met    open (a group is met by one of its exam subjects);
 *   one group missing  one step more, and the door names its exam subjects;
 *   more missing       not on this route for now, and the door names what is missing;
 *   `#`                not on this route for now, and the door names the profiles that admit.
 *
 * nlt, o&o and PgP-T have no box: a group is met only by its exam subjects, and the
 * card names the others in words. Everything else is the routing of engine/route.ts,
 * shared with the onderbouw view: hbo at havo follows the havo rule, at vwo the vwo
 * rule (admissionAt); below the programme's level the steps are mbo 2, mbo 4, havo 4,
 * vwo 5 and an hbo first year, and wo from havo is one step when the pupil meets the
 * vwo rule. The vmbo levels have no boxes, and their doors are the onderbouw doors.
 */

const OPEN: RouteView = { state: 'open' };

const ADMITS: CellRule = { kind: 'admits' };
const NO_RIGHT: CellRule = { kind: 'noRight' };

export function isExamSubject(s: RathoSubject): s is ExamSubject {
  return (EXAM_SUBJECTS as readonly string[]).includes(s);
}

/**
 * The cell of `profile` under `rule`, as a typed rule. A programme without a row
 * admits every profile. Without typed cells (a made-up rule in a test), the rule is
 * read from `direct` and `bridge`, and a profile in neither gets no right to admission:
 * the stricter reading.
 */
export function cellRuleOf(rule: ProfileRule, profile: HavoVwoProfile): CellRule {
  const src = rule.source;
  if (src !== undefined) {
    if (src.rules !== null) return src.rules[profile];
    if (src.cells === null) return ADMITS;
  }
  if (rule.direct.includes(profile)) return ADMITS;
  const bridge = rule.bridge[profile];
  return bridge === undefined ? NO_RIGHT : { kind: 'subjects', groups: [[bridge]] };
}

/** How a pupil fares against one cell. */
export type Verdict =
  /** The profile admits, or the pupil has a subject of every group: `met` lists the groups the subjects meet. */
  | { readonly kind: 'met'; readonly met: readonly (readonly RathoSubject[])[] }
  /** Groups still missing, in the cell's order (at least one). */
  | { readonly kind: 'missing'; readonly missing: readonly (readonly RathoSubject[])[] }
  /** `#`: no right to admission with this profile. */
  | { readonly kind: 'noRight' };

/** A group is met by one of its exam subjects that the pupil has. */
export function groupMet(group: readonly RathoSubject[], extras: ReadonlySet<ExamSubject>): boolean {
  return group.some((s) => isExamSubject(s) && extras.has(s));
}

export function judgeCell(cell: CellRule, extras: ReadonlySet<ExamSubject>): Verdict {
  if (cell.kind === 'admits') return { kind: 'met', met: [] };
  if (cell.kind === 'noRight') return { kind: 'noRight' };
  const missing = cell.groups.filter((g) => !groupMet(g, extras));
  return missing.length === 0 ? { kind: 'met', met: cell.groups } : { kind: 'missing', missing };
}

/**
 * The profiles that admit under `rule`, for a door closed by `#`: those whose cell is
 * `*` (or every profile, without a row); when none is, those whose cell asks for subjects.
 */
export function admittingCells(rule: ProfileRule): readonly HavoVwoProfile[] {
  const cells = HAVO_VWO_PROFILES.map((pr) => ({ pr, cell: cellRuleOf(rule, pr) }));
  const direct = cells.filter((c) => c.cell.kind === 'admits').map((c) => c.pr);
  return direct.length > 0 ? direct : cells.filter((c) => c.cell.kind === 'subjects').map((c) => c.pr);
}

/** The door for a profile and the pupil's subjects under the rule of the pupil's own level. */
function atLevel(rule: ProfileRule, profile: HavoVwoProfile, extras: ReadonlySet<ExamSubject>): RouteView {
  const v = judgeCell(cellRuleOf(rule, profile), extras);
  if (v.kind === 'met') return OPEN;
  if (v.kind === 'noRight') return { state: 'closed', need: { kind: 'profile', profiles: admittingCells(rule) } };
  const [only] = v.missing;
  const options = only === undefined ? [] : only.filter(isExamSubject);
  if (v.missing.length === 1 && options.length > 0) {
    return { state: 'detour', steps: options.map((subject) => ({ kind: 'subject', subject })), profiles: null };
  }
  return { state: 'closed', need: { kind: 'subjects', groups: v.missing } };
}

/** The bovenbouw judgement: the profile with the pupil's exam subjects. */
export function examJudge(extras: ReadonlySet<ExamSubject>): ProfileJudge {
  return {
    atLevel: (rule, profile) => atLevel(rule, profile, extras),
    meetsFromHavo: (rule, profile) => judgeCell(cellRuleOf(rule, profile), extras).kind === 'met',
  };
}

/** What a level, a profile (or none yet) and the pupil's exam subjects say about one profession. */
export function examRouteOf(
  p: Profession,
  level: SchoolLevel,
  profile: SchoolProfile | null,
  extras: ReadonlySet<ExamSubject>,
): RouteView {
  return routeWith(examJudge(extras), p, level, profile);
}

/**
 * The count on each profile button: for havo and vwo, how many doors that profile
 * opens with the pupil's subjects; for a vmbo direction, as on the onderbouw view, how
 * many mbo professions fit it best.
 */
export function examProfileCounts(
  professions: readonly Profession[],
  level: SchoolLevel,
  extras: ReadonlySet<ExamSubject>,
): ProfileCount[] {
  if (isVmbo(level)) return profileCounts(professions, level);
  const judge = examJudge(extras);
  return HAVO_VWO_PROFILES.map((profile) => ({
    profile,
    kind: 'opens',
    count: professions.filter((p) => routeWith(judge, p, level, profile).state === 'open').length,
  }));
}
