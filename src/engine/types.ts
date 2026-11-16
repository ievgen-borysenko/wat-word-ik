/** App language codes. `ua` is the app's own code for Ukrainian. */
export const LANGS = ['nl', 'en', 'ua'] as const;
export type Lang = (typeof LANGS)[number];

export type Localized = Readonly<Record<Lang, string>>;

/** Fixed order: the URL hash encodes the sliders in exactly this order. */
export const SUBJECT_IDS = [
  'wiskunde',
  'natuurkunde',
  'scheikunde',
  'biologie',
  'nederlands',
  'engels',
  'geschiedenis',
  'aardrijkskunde',
  'techniek',
  'kunst',
] as const;
export type SubjectId = (typeof SUBJECT_IDS)[number];

export interface Subject {
  readonly id: SubjectId;
  readonly emoji: string;
  readonly name: Localized;
  /** Shorter name for hints and compact labels; falls back to `name`. */
  readonly short?: Localized;
}

/** 0 = no diploma, 1 = mbo 2-3, 2 = mbo 4, 3 = hbo, 4 = wo. */
export const LEVELS = [0, 1, 2, 3, 4] as const;
export type Level = (typeof LEVELS)[number];

/**
 * General level gate: the average of all sliders must reach this value.
 * A rough stand-in for the school track in this demo.
 */
export const MIN_AVG: Readonly<Record<Level, number>> = { 0: 0, 1: 4.5, 2: 5.5, 3: 6.5, 4: 7.5 };

export const GRADE_MIN = 1;
export const GRADE_MAX = 10;
export const DEFAULT_GRADE = 6;

export interface Need {
  readonly subject: SubjectId;
  readonly min: number;
}

export type Pay = 1 | 2 | 3 | 4 | 5;

/**
 * Field of work, for the doors view: neutral groups by kind of work, never by
 * level or pay. The order here is the order of the groups on screen.
 */
export const FIELDS = ['care', 'technology', 'making', 'nature', 'people'] as const;
export type Field = (typeof FIELDS)[number];

export interface Profession {
  readonly id: string;
  readonly level: Level;
  readonly emoji: string;
  readonly name: Localized;
  /** Shorter name for compact tiles; falls back to `name`. */
  readonly short?: Localized;
  readonly about: Localized;
  readonly needs: readonly Need[];
  /** Demo pay scale 1..5, shown as euro symbols. */
  readonly pay: Pay;
  /** Professions of one family form a ladder; `rung` counts from 1. */
  readonly family: string;
  readonly rung: number;
  /** Field of work: the group of its door in the doors view. */
  readonly field: Field;
  /**
   * mbo professions (levels 1 and 2) only: the vmbo direction that fits best. A fit,
   * not a requirement: a vmbo diploma of any direction admits to mbo.
   */
  readonly vmbo?: VmboDirection;
  /** hbo and wo professions (levels 3 and 4) only: admission by havo or vwo profile. */
  readonly admission?: ProfileAdmission;
}

export type Sliders = Readonly<Record<SubjectId, number>>;

export type State = 'open' | 'near' | 'far';

/*
 * The onderbouw view (onderbouw.html): klas 1-3 of secondary school, before the
 * profile choice. The input is the school level and the profile, not grades.
 */

/**
 * School levels, low to high: vmbo-bb/kb, vmbo-gl/tl, havo, vwo. The order is used for
 * "from havo up": without a profile, and with a profile that admits to the programme, a
 * higher level never opens less. A havo or vwo profile without admission closes an hbo
 * or wo door that vmbo-gl/tl shows one step away, via mbo 4 (see engine/route.ts).
 */
export const SCHOOL_LEVELS = ['bbkb', 'gltl', 'havo', 'vwo'] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];

/** The four havo and vwo profiles: Natuur & Techniek, Natuur & Gezondheid, Economie & Maatschappij, Cultuur & Maatschappij. */
export const HAVO_VWO_PROFILES = ['nt', 'ng', 'em', 'cm'] as const;
export type HavoVwoProfile = (typeof HAVO_VWO_PROFILES)[number];

/**
 * Four broad vmbo directions. The real vmbo-bb/kb/gl has ten profiles; this demo
 * groups them into four, and the page says so.
 */
export const VMBO_DIRECTIONS = ['techniek', 'zorg', 'economie', 'groen'] as const;
export type VmboDirection = (typeof VMBO_DIRECTIONS)[number];

export type SchoolProfile = HavoVwoProfile | VmboDirection;

/** Exam subjects that an admission rule can ask for on top of a profile. */
export const EXAM_SUBJECTS = ['wiskunde-a', 'wiskunde-b', 'natuurkunde', 'scheikunde', 'biologie'] as const;
export type ExamSubject = (typeof EXAM_SUBJECTS)[number];

/**
 * Subjects that a cell of the regulation may offer as a choice next to an exam subject
 * above: natuur, leven & technologie (nlt), onderzoek & ontwerpen (o&o) and the
 * Praktijkgerichte Programma Technologie (PgP-T). The bovenbouw view has no box for
 * them: it names them in words, and a group is met only by its exam subjects.
 */
export const OTHER_OPTIONS = ['nlt', 'o&o', 'pgp-t'] as const;
export type OtherOption = (typeof OTHER_OPTIONS)[number];

/** A subject as a cell of the regulation names it. */
export type RathoSubject = ExamSubject | OtherOption;

/**
 * One cell of a regulation row as data, written by hand next to the cell's text (the
 * data test checks the two against each other; nothing parses the text at run time):
 *
 *   `*`  admits: the profile gives the right to admission;
 *   `#`  noRight: the profile gives no right to admission;
 *   else subjects: groups that must all be in the exam, each by one of its subjects.
 *        `nat` is [[nat]], `nat of nlt` is [[nat, nlt]], `nat + wisB` is [[nat], [wisB]],
 *        `(wisA of wisB) + (nat of nlt)` is [[wisA, wisB], [nat, nlt]].
 */
export type CellRule =
  | { readonly kind: 'admits' }
  | { readonly kind: 'noRight' }
  | { readonly kind: 'subjects'; readonly groups: readonly (readonly RathoSubject[])[] };

/** One admission rule by profile: which profiles admit directly, which with one extra subject. */
export interface ProfileRule {
  /**
   * Profiles that give direct admission. Empty only when every profile that admits
   * needs an extra subject (wo Geneeskunde: N&T with biology, N&G with physics).
   */
  readonly direct: readonly HavoVwoProfile[];
  /**
   * For a profile that is not direct: the one extra subject that closes the gap.
   * A profile that is in neither list needs a different profile.
   */
  readonly bridge: Readonly<Partial<Record<HavoVwoProfile, ExamSubject>>>;
  /** Where the rule comes from. The engine does not read it; the data test requires it. */
  readonly source?: AdmissionSource;
}

/**
 * Admission to an hbo or wo programme by havo or vwo profile. For wo the rule is the
 * vwo rule; from havo, wo is one step short anyway. For hbo the rule is the one for
 * havo pupils, and `vwo` the one for vwo pupils: the regulation has a table for each.
 */
export interface ProfileAdmission extends ProfileRule {
  /** hbo only: the rule for vwo pupils, with its own source. The data test requires it for hbo. */
  readonly vwo?: ProfileRule;
}

/**
 * One programme in the Dutch admission regulation, the Regeling aanmelding en
 * toelating hoger onderwijs (Ratho, BWBR0035059): Bijlage A lists the extra
 * requirements of wo programmes for vwo profiles, Bijlage B those of hbo
 * programmes for havo and vwo profiles. A programme without a row there has no
 * extra requirements: every profile admits.
 */
export interface AdmissionSource {
  readonly bijlage: 'A' | 'B';
  /** The table the row is in, as headed in the bijlage; null for a programme without a row. */
  readonly table: string | null;
  /** The programme as written in the bijlage, or its usual name when it has no row there. */
  readonly programme: string;
  /** The cells NT, NG, EM, CM as written; null when the bijlage has no row for the programme. */
  readonly cells: Readonly<Record<HavoVwoProfile, string>> | null;
  /** The same cells as typed rules, for the bovenbouw view; null exactly when `cells` is null. */
  readonly rules: Readonly<Record<HavoVwoProfile, CellRule>> | null;
  /** The version of the regulation that was read (the date it is in force from). */
  readonly version: string;
  /** True when the row (or its absence) was read twice and both readings agreed. */
  readonly verified: boolean;
  /** The diploma the row is for: hbo rows come from a havo table or a vwo table; wo rows are for vwo. */
  readonly intake: 'havo' | 'vwo';
  /**
   * A footnote that lets the institution give these profiles until the end of the first
   * year to catch up these subjects. The door stays closed (the stricter reading); the
   * card says it.
   */
  readonly catchUp?: { readonly profiles: readonly HavoVwoProfile[]; readonly subjects: readonly ExamSubject[] };
  /** What the row says that the data cannot hold, such as a footnote. */
  readonly note?: string;
}
