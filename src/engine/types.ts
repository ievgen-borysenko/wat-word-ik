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

/** School levels, low to high: vmbo-bb/kb, vmbo-gl/tl, havo, vwo. The order is used: a higher level never opens less. */
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
 * Admission to an hbo or wo programme from havo or vwo, by profile (demo data).
 * The same rule holds for havo and vwo; for wo, havo is one step short anyway.
 */
export interface ProfileAdmission {
  /** Profiles that give direct admission. At least one. */
  readonly direct: readonly HavoVwoProfile[];
  /**
   * For a profile that is not direct: the one extra subject that closes the gap.
   * A profile that is in neither list needs a different profile.
   */
  readonly bridge: Readonly<Partial<Record<HavoVwoProfile, ExamSubject>>>;
}
