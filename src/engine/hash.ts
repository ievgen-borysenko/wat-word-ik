import { validProfile } from './route';
import { uniformSliders } from './scoring';
import {
  DEFAULT_GRADE,
  LANGS,
  SCHOOL_LEVELS,
  SUBJECT_IDS,
  type Lang,
  type SchoolLevel,
  type SchoolProfile,
  type Sliders,
  type SubjectId,
} from './types';

/**
 * URL hash state, e.g. `#s=6666666666&g=arts&l=ua`.
 * Sliders are one character each in SUBJECT_IDS order; 10 is written as `a`.
 * `lang` is null unless the language came with the link or was picked on the
 * page, so a guessed browser language never ends up in a shared link.
 *
 * One more field is not state: the view-switch marker `v=1` (VIEW_MARKER). The link
 * to the other view adds it when the grades on screen are the user's own, so the
 * page it opens does not say they came from a link. It carries no data, only the
 * exact `v=1` counts, decodeHash ignores it, and encodeHash never writes it: the
 * page's first write of its own hash removes it from the address.
 */
export interface HashState {
  readonly sliders: Sliders;
  readonly goal: string | null;
  readonly lang: Lang | null;
}

function gradeChar(v: number): string {
  return v === 10 ? 'a' : String(v);
}

function charGrade(c: string): number | null {
  if (c === 'a') return 10;
  if (c >= '1' && c <= '9' && c.length === 1) return Number(c);
  return null;
}

export function encodeSliders(sliders: Sliders): string {
  return SUBJECT_IDS.map((s) => gradeChar(sliders[s])).join('');
}

export function decodeSliders(raw: string | null): Sliders | null {
  if (raw === null || raw.length !== SUBJECT_IDS.length) return null;
  const out = {} as Record<SubjectId, number>;
  for (let i = 0; i < SUBJECT_IDS.length; i++) {
    const g = charGrade(raw.charAt(i));
    if (g === null) return null;
    out[SUBJECT_IDS[i] as SubjectId] = g;
  }
  return out;
}

export function encodeHash(state: HashState): string {
  const parts = [`s=${encodeSliders(state.sliders)}`];
  if (state.goal) parts.push(`g=${encodeURIComponent(state.goal)}`);
  if (state.lang) parts.push(`l=${state.lang}`);
  return `#${parts.join('&')}`;
}

/** The view-switch marker, as it appears in the hash. */
export const VIEW_MARKER = 'v=1';

/** `hash` (as encodeHash writes it) with the view-switch marker added at the end. */
export function withViewMarker(hash: string): string {
  return `${hash}&${VIEW_MARKER}`;
}

function parseParams(hash: unknown): URLSearchParams | null {
  if (typeof hash !== 'string') return null;
  try {
    return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  } catch {
    return null;
  }
}

/** True when the hash carries a valid `s=` field: the grades came with the link. */
export function hashHasSliders(hash: unknown): boolean {
  const params = parseParams(hash);
  return params !== null && decodeSliders(params.get('s')) !== null;
}

/**
 * True when the hash carries the view-switch marker: `v=1` exactly (the first `v`
 * field), anything else is not the marker. Says nothing about the other fields.
 */
export function hashHasViewMarker(hash: unknown): boolean {
  const params = parseParams(hash);
  return params !== null && params.get('v') === '1';
}

/** Never throws: any field that does not parse falls back to its default. */
export function decodeHash(hash: unknown, knownIds: ReadonlySet<string>): HashState {
  const fallback: HashState = { sliders: uniformSliders(DEFAULT_GRADE), goal: null, lang: null };
  const params = parseParams(hash);
  if (params === null) return fallback;
  const sliders = decodeSliders(params.get('s')) ?? fallback.sliders;
  const g = params.get('g');
  const goal = g !== null && knownIds.has(g) ? g : null;
  const l = params.get('l');
  const lang = (LANGS as readonly string[]).includes(l ?? '') ? (l as Lang) : null;
  return { sliders, goal, lang };
}

/*
 * The onderbouw view (onderbouw.html) has its own state, in the same style:
 * `#n=havo&p=nt&l=nl`. `n` is the school level (SCHOOL_LEVELS), `p` the profile or
 * vmbo direction of that level, left out while none is chosen, and `l` the language
 * as above. Each page reads only its own keys: decodeHash ignores `n` and `p`,
 * decodeRouteHash ignores `s`, `g` and the view-switch marker, and the first write
 * of a page's own hash drops whatever it does not own.
 */
export interface RouteHashState {
  readonly level: SchoolLevel;
  readonly profile: SchoolProfile | null;
  readonly lang: Lang | null;
}

/** The level shown when the link names none: havo, the middle of the four. */
export const DEFAULT_SCHOOL_LEVEL: SchoolLevel = 'havo';

export function encodeRouteHash(state: RouteHashState): string {
  const parts = [`n=${state.level}`];
  if (state.profile) parts.push(`p=${state.profile}`);
  if (state.lang) parts.push(`l=${state.lang}`);
  return `#${parts.join('&')}`;
}

/** Never throws: a level that does not parse falls back to the default, a profile that does not belong to the level to none. */
export function decodeRouteHash(hash: unknown): RouteHashState {
  const params = parseParams(hash);
  if (params === null) return { level: DEFAULT_SCHOOL_LEVEL, profile: null, lang: null };
  const n = params.get('n') ?? '';
  const level = (SCHOOL_LEVELS as readonly string[]).includes(n) ? (n as SchoolLevel) : DEFAULT_SCHOOL_LEVEL;
  const profile = validProfile(level, params.get('p'));
  const l = params.get('l');
  const lang = (LANGS as readonly string[]).includes(l ?? '') ? (l as Lang) : null;
  return { level, profile, lang };
}

/**
 * What a link between the onderbouw view and the grade views carries: the language,
 * when it was chosen (as `l=` alone), and nothing else. Without a `#`, so a link
 * template can put its own literal `#` in front.
 */
export function langFragment(lang: Lang | null): string {
  return lang ? `l=${lang}` : '';
}
