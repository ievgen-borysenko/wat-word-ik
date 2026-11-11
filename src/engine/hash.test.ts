import { describe, expect, it } from 'vitest';
import { decodeHash, encodeHash, type HashState } from './hash';
import { uniformSliders } from './scoring';
import { SUBJECT_IDS, type Sliders } from './types';

const IDS = new Set(['arts', 'journalist']);
const DEFAULT = uniformSliders(6);

describe('hash codec', () => {
  it('encodes the documented format, 10 as "a"', () => {
    const s: Sliders = { ...uniformSliders(6), wiskunde: 10, kunst: 1 };
    expect(encodeHash({ sliders: s, goal: 'arts', lang: 'ua' })).toBe('#s=a666666661&g=arts&l=ua');
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
