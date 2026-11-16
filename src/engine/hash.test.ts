import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHOOL_LEVEL,
  EXAM_SUBJECT_CODES,
  VIEW_MARKER,
  decodeExamHash,
  decodeExtras,
  decodeHash,
  decodeRouteHash,
  encodeExamHash,
  encodeExtras,
  encodeHash,
  encodeRouteHash,
  hashHasSliders,
  hashHasViewMarker,
  langFragment,
  withViewMarker,
  type ExamHashState,
  type HashState,
  type RouteHashState,
} from './hash';
import { isVmbo, profilesOf } from './route';
import { uniformSliders } from './scoring';
import { EXAM_SUBJECTS, LANGS, SCHOOL_LEVELS, SUBJECT_IDS, type ExamSubject, type Sliders } from './types';

const IDS = new Set(['arts', 'journalist']);
const DEFAULT = uniformSliders(6);

describe('hash codec', () => {
  it('encodes the documented format, 10 as "a"', () => {
    const s: Sliders = { ...uniformSliders(6), wiskunde: 10, kunst: 1 };
    expect(encodeHash({ sliders: s, goal: 'arts', lang: 'ua' })).toBe('#s=a666666661&g=arts&l=ua');
  });

  it('leaves the language out when there is none to write', () => {
    expect(encodeHash({ sliders: DEFAULT, goal: null, lang: null })).toBe('#s=6666666666');
    expect(encodeHash({ sliders: DEFAULT, goal: 'arts', lang: null })).toBe('#s=6666666666&g=arts');
  });

  it('still reads a language from an older link', () => {
    expect(decodeHash('#s=6666666666&l=ua', IDS).lang).toBe('ua');
    expect(decodeHash('#l=nl', IDS).lang).toBe('nl');
    expect(decodeHash('#s=6666666666', IDS).lang).toBeNull();
  });

  it('tells whether the link carries grades', () => {
    expect(hashHasSliders('#s=6666666666')).toBe(true);
    expect(hashHasSliders('s=a666666661&l=en')).toBe(true);
    expect(hashHasSliders('')).toBe(false);
    expect(hashHasSliders('#l=nl&g=arts')).toBe(false);
    expect(hashHasSliders('#s=666')).toBe(false);
    expect(hashHasSliders('#s=666666666b')).toBe(false);
    expect(hashHasSliders(undefined)).toBe(false);
  });

  it('round-trips every grade in every position', () => {
    for (let i = 0; i < SUBJECT_IDS.length; i++) {
      for (let g = 1; g <= 10; g++) {
        const s = { ...uniformSliders(5), [SUBJECT_IDS[i]!]: g } as Sliders;
        const state: HashState = { sliders: s, goal: i % 2 ? 'journalist' : null, lang: g % 2 ? 'nl' : 'en' };
        expect(decodeHash(encodeHash(state), IDS)).toEqual(state);
      }
    }
  });

  it('falls back to defaults on garbage and never throws', () => {
    const garbage: unknown[] = [
      undefined,
      null,
      42,
      '',
      '#',
      '#s=',
      '#s=66666',
      '#s=66666666666',
      '#s=6666666660',
      '#s=666666666b',
      '#s=66666666A6',
      '#s=6666 66666',
      '#%E0%A4%A',
      '#s=%E0%A4%A&g=%&l=%%',
      '#g=unknown&l=de',
      '#l=UA',
      '#s=6666666666&s=1111111111',
      '#__proto__=1&constructor=2',
      '#' + 'x'.repeat(100000),
    ];
    for (const h of garbage) {
      const d = decodeHash(h, IDS);
      expect(d.goal).toBeNull();
      expect(d.lang).toBeNull();
      if (h !== '#s=6666666666&s=1111111111') expect(d.sliders).toEqual(DEFAULT);
    }
  });

  it('keeps valid fields when others are invalid', () => {
    const d = decodeHash('#s=bad&g=arts&l=nl', IDS);
    expect(d).toEqual({ sliders: DEFAULT, goal: 'arts', lang: 'nl' });
  });
});

describe('view-switch marker', () => {
  const s: Sliders = { ...uniformSliders(6), wiskunde: 10, kunst: 1 };

  it('is added at the end of an encoded hash and is v=1', () => {
    expect(VIEW_MARKER).toBe('v=1');
    expect(withViewMarker(encodeHash({ sliders: s, goal: 'arts', lang: 'ua' }))).toBe('#s=a666666661&g=arts&l=ua&v=1');
    expect(withViewMarker(encodeHash({ sliders: DEFAULT, goal: null, lang: null }))).toBe('#s=6666666666&v=1');
  });

  it('is never written by encodeHash', () => {
    for (const state of [
      { sliders: s, goal: 'arts', lang: 'ua' },
      { sliders: DEFAULT, goal: null, lang: null },
    ] as HashState[]) {
      expect(encodeHash(state)).not.toMatch(/(?:^#|&)v=/);
      expect(encodeHash(decodeHash(withViewMarker(encodeHash(state)), IDS))).toBe(encodeHash(state));
    }
  });

  it('carries no state: decoding ignores it', () => {
    const state: HashState = { sliders: s, goal: 'arts', lang: 'nl' };
    expect(decodeHash(withViewMarker(encodeHash(state)), IDS)).toEqual(state);
    expect(decodeHash('#v=1', IDS)).toEqual({ sliders: DEFAULT, goal: null, lang: null });
  });

  it('is found only as exactly v=1', () => {
    expect(hashHasViewMarker('#s=6666666666&v=1')).toBe(true);
    expect(hashHasViewMarker('#s=6666666666&g=arts&l=nl&v=1')).toBe(true);
    expect(hashHasViewMarker('#v=1&s=6666666666')).toBe(true);
    expect(hashHasViewMarker('#v=1')).toBe(true);
    for (const h of [
      '#s=6666666666',
      '#s=6666666666&v=0',
      '#s=6666666666&v=',
      '#s=6666666666&v',
      '#s=6666666666&v=11',
      '#s=6666666666&v=true',
      '#s=6666666666&V=1',
      '#s=6666666666&v=0&v=1',
      '#s=6666666666&g=v=1',
      '',
      '#',
      undefined,
      null,
      42,
    ] as unknown[]) {
      expect(hashHasViewMarker(h), String(h)).toBe(false);
    }
  });

  it('does not change how grades are validated', () => {
    expect(hashHasSliders('#s=6666666666&v=1')).toBe(true);
    expect(hashHasSliders('#v=1')).toBe(false);
    expect(hashHasSliders('#s=666&v=1')).toBe(false);
    expect(hashHasSliders('#s=666666666b&v=1')).toBe(false);
  });

  it('leaves garbage hashes falling back to the defaults', () => {
    for (const h of ['#s=&v=1', '#s=66666&v=1', '#%E0%A4%A&v=1', '#g=unknown&l=de&v=1', '#v=1&s=6666666660']) {
      expect(decodeHash(h, IDS), h).toEqual({ sliders: DEFAULT, goal: null, lang: null });
    }
  });
});

describe('onderbouw hash (n = level, p = profile)', () => {
  it('encodes the documented format and leaves out what is not chosen', () => {
    expect(encodeRouteHash({ level: 'havo', profile: 'nt', lang: 'nl' })).toBe('#n=havo&p=nt&l=nl');
    expect(encodeRouteHash({ level: 'gltl', profile: null, lang: null })).toBe('#n=gltl');
    expect(encodeRouteHash({ level: 'bbkb', profile: 'zorg', lang: null })).toBe('#n=bbkb&p=zorg');
  });

  it('round-trips every level, profile and language', () => {
    for (const level of SCHOOL_LEVELS) {
      for (const profile of [null, ...profilesOf(level)]) {
        for (const lang of [null, ...LANGS]) {
          const state: RouteHashState = { level, profile, lang };
          expect(decodeRouteHash(encodeRouteHash(state))).toEqual(state);
        }
      }
    }
  });

  it('falls back to havo without a profile on garbage, and never throws', () => {
    expect(DEFAULT_SCHOOL_LEVEL).toBe('havo');
    for (const h of [undefined, null, 42, '', '#', '#n=', '#n=HAVO', '#n=mavo', '#n=havo%00', '#p=zorg', '#%E0%A4%A', '#__proto__=1', '#' + 'n'.repeat(100000)]) {
      expect(decodeRouteHash(h), String(h).slice(0, 20)).toEqual({ level: 'havo', profile: null, lang: null });
    }
  });

  it('keeps a valid profile when the level falls back to the default', () => {
    expect(decodeRouteHash('#n=mavo&p=nt')).toEqual({ level: 'havo', profile: 'nt', lang: null });
  });

  it('drops a profile that does not belong to the level', () => {
    expect(decodeRouteHash('#n=vwo&p=zorg')).toEqual({ level: 'vwo', profile: null, lang: null });
    expect(decodeRouteHash('#n=gltl&p=nt&l=ua')).toEqual({ level: 'gltl', profile: null, lang: 'ua' });
    expect(decodeRouteHash('#n=havo&p=constructor')).toEqual({ level: 'havo', profile: null, lang: null });
  });

  it('each page reads only its own keys', () => {
    // The grade pages ignore n and p ...
    expect(decodeHash('#n=vwo&p=ng&l=en', IDS)).toEqual({ sliders: DEFAULT, goal: null, lang: 'en' });
    expect(decodeHash('#s=a666666661&g=arts&n=vwo&p=ng&v=1', IDS)).toEqual({
      sliders: { ...uniformSliders(6), wiskunde: 10, kunst: 1 },
      goal: 'arts',
      lang: null,
    });
    expect(hashHasSliders('#n=vwo&p=ng')).toBe(false);
    expect(hashHasViewMarker('#n=vwo&p=ng')).toBe(false);
    // ... and the onderbouw page ignores s, g and the view-switch marker.
    expect(decodeRouteHash('#s=a666666661&g=arts&l=nl&v=1')).toEqual({ level: 'havo', profile: null, lang: 'nl' });
    expect(decodeRouteHash('#s=a666666661&n=vwo&p=em&v=1')).toEqual({ level: 'vwo', profile: 'em', lang: null });
    // Neither writes the other's keys.
    expect(encodeHash(decodeHash('#s=6666666666&n=vwo&p=ng', IDS))).toBe('#s=6666666666');
    expect(encodeRouteHash(decodeRouteHash('#n=vwo&p=ng&s=6666666666&g=arts&v=1'))).toBe('#n=vwo&p=ng');
  });

  it('a link between the pages carries the language only, and only when it was chosen', () => {
    expect(langFragment('ua')).toBe('l=ua');
    expect(langFragment(null)).toBe('');
    expect(decodeHash(`#${langFragment('nl')}`, IDS)).toEqual({ sliders: DEFAULT, goal: null, lang: 'nl' });
    expect(decodeRouteHash(`#${langFragment('en')}`)).toEqual({ level: 'havo', profile: null, lang: 'en' });
  });
});

describe('bovenbouw hash (n, p and x = the exam subjects on top of the profile)', () => {
  /** Every set of exam subjects, in the order of EXAM_SUBJECTS. */
  const SUBSETS: ExamSubject[][] = Array.from({ length: 1 << EXAM_SUBJECTS.length }, (_, mask) =>
    EXAM_SUBJECTS.filter((_, i) => mask & (1 << i)),
  );

  it('encodes the documented format: short codes in a fixed order, x and p left out when empty', () => {
    expect(encodeExamHash({ level: 'vwo', profile: 'ng', extras: ['wiskunde-b', 'natuurkunde'], lang: 'nl' })).toBe('#n=vwo&p=ng&x=wb.na&l=nl');
    expect(encodeExamHash({ level: 'havo', profile: null, extras: ['biologie', 'wiskunde-a'], lang: null })).toBe('#n=havo&x=wa.bi');
    expect(encodeExamHash({ level: 'havo', profile: 'cm', extras: [], lang: 'en' })).toBe('#n=havo&p=cm&l=en');
    expect(EXAM_SUBJECT_CODES).toEqual({ 'wiskunde-a': 'wa', 'wiskunde-b': 'wb', natuurkunde: 'na', scheikunde: 'sk', biologie: 'bi' });
    expect(new Set(Object.values(EXAM_SUBJECT_CODES)).size).toBe(EXAM_SUBJECTS.length);
  });

  it('writes no subjects at a vmbo level, and reads none there', () => {
    expect(encodeExamHash({ level: 'gltl', profile: 'zorg', extras: ['natuurkunde'], lang: null })).toBe('#n=gltl&p=zorg');
    expect(decodeExamHash('#n=bbkb&x=na.wb')).toEqual({ level: 'bbkb', profile: null, extras: [], lang: null });
  });

  it('round-trips every level, profile, set of subjects and language', () => {
    for (const level of SCHOOL_LEVELS) {
      for (const profile of [null, ...profilesOf(level)]) {
        for (const extras of SUBSETS) {
          for (const lang of [null, ...LANGS]) {
            const state: ExamHashState = { level, profile, extras: isVmbo(level) ? [] : extras, lang };
            expect(decodeExamHash(encodeExamHash(state))).toEqual(state);
          }
        }
      }
    }
  });

  it('reads the subjects in any order, once each, and drops what it does not know', () => {
    expect(decodeExtras('na.wb')).toEqual(['wiskunde-b', 'natuurkunde']);
    expect(decodeExtras('wb.na')).toEqual(['wiskunde-b', 'natuurkunde']);
    expect(decodeExtras('na.na.na')).toEqual(['natuurkunde']);
    expect(decodeExtras('zz.na.NA.Wb..bi.')).toEqual(['natuurkunde', 'biologie']);
    for (const junk of [null, '', '.', 'x', '__proto__', 'constructor', 'na,wb', 'na wb', 'natuurkunde', 'wiskunde-a', 'n'.repeat(100000)]) {
      expect(decodeExtras(junk), String(junk).slice(0, 20)).toEqual([]);
    }
    expect(encodeExtras(['biologie', 'wiskunde-a', 'biologie'])).toBe('wa.bi');
    expect(encodeExtras([])).toBe('');
  });

  it('never throws, and falls back to havo without a profile or subjects on garbage', () => {
    for (const h of [undefined, null, 42, '', '#', '#x=', '#x=zz', '#%E0%A4%A', '#__proto__=1&x=na', '#' + 'x=na.'.repeat(20000)]) {
      const d = decodeExamHash(h);
      expect(d.level, String(h).slice(0, 20)).toBe('havo');
      expect(d.profile, String(h).slice(0, 20)).toBeNull();
      expect(d.lang, String(h).slice(0, 20)).toBeNull();
    }
    expect(decodeExamHash('#' + 'x=na.'.repeat(20000)).extras).toEqual(['natuurkunde']);
    expect(decodeExamHash('#n=vwo&p=zorg&x=bi&l=de')).toEqual({ level: 'vwo', profile: null, extras: ['biologie'], lang: null });
  });

  it('each page reads only its own keys: onderbouw ignores x, the bovenbouw page ignores s, g and the view-switch marker', () => {
    expect(decodeRouteHash('#n=vwo&p=ng&x=na.wb&l=nl')).toEqual({ level: 'vwo', profile: 'ng', lang: 'nl' });
    expect(encodeRouteHash(decodeRouteHash('#n=vwo&p=ng&x=na.wb'))).toBe('#n=vwo&p=ng');
    expect(decodeHash('#n=vwo&p=ng&x=na', IDS)).toEqual({ sliders: DEFAULT, goal: null, lang: null });
    expect(decodeExamHash('#s=a666666661&g=arts&n=vwo&p=em&x=sk&v=1')).toEqual({ level: 'vwo', profile: 'em', extras: ['scheikunde'], lang: null });
    expect(encodeExamHash(decodeExamHash('#s=a666666661&g=arts&n=vwo&p=em&x=sk&v=1'))).toBe('#n=vwo&p=em&x=sk');
    expect(decodeExamHash(`#${langFragment('ua')}`)).toEqual({ level: 'havo', profile: null, extras: [], lang: 'ua' });
  });
});
