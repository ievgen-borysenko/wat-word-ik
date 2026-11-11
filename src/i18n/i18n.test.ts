import { describe, expect, it } from 'vitest';
import { LANGS } from '../engine/types';
import { MESSAGES, detectLang, t } from './index';

describe('i18n', () => {
  it('every language has the same keys, all non-empty, with the same placeholders', () => {
    const keys = Object.keys(MESSAGES.en).sort();
    for (const lang of LANGS) {
      expect(Object.keys(MESSAGES[lang]).sort(), lang).toEqual(keys);
      for (const k of keys) {
        const v = MESSAGES[lang][k as keyof typeof MESSAGES.en];
        expect(v.trim().length, `${lang}.${k}`).toBeGreaterThan(0);
        const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
        expect(ph(v), `${lang}.${k}`).toEqual(ph(MESSAGES.en[k as keyof typeof MESSAGES.en]));
      }
    }
  });

  it('fills placeholders', () => {
    expect(t('en', 'summary.counts', { open: 12, total: 36, near: 7 })).toBe('Open: 12 of 36 · one step away: 7');
  });

  it('detects the language from the browser list', () => {
    expect(detectLang(['uk-UA', 'en'])).toBe('ua');
    expect(detectLang(['ru'])).toBe('ua');
    expect(detectLang(['nl-NL'])).toBe('nl');
    expect(detectLang(['de-DE', 'nl'])).toBe('nl');
    expect(detectLang(['en-US', 'nl'])).toBe('en');
    expect(detectLang(['fr'])).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});
