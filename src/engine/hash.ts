import { DEFAULT_GRADE, LANGS, SUBJECT_IDS, type Lang, type Sliders, type SubjectId } from './types';
import { uniformSliders } from './scoring';

/**
 * URL hash state, e.g. `#s=6666666666&g=arts&l=ua`.
 * Sliders are one character each in SUBJECT_IDS order; 10 is written as `a`.
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

/** Never throws: any field that does not parse falls back to its default. */
export function decodeHash(hash: unknown, knownIds: ReadonlySet<string>): HashState {
  const fallback: HashState = { sliders: uniformSliders(DEFAULT_GRADE), goal: null, lang: null };
  if (typeof hash !== 'string') return fallback;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  } catch {
    return fallback;
  }
  const sliders = decodeSliders(params.get('s')) ?? fallback.sliders;
  const g = params.get('g');
  const goal = g !== null && knownIds.has(g) ? g : null;
  const l = params.get('l');
  const lang = (LANGS as readonly string[]).includes(l ?? '') ? (l as Lang) : null;
  return { sliders, goal, lang };
}
