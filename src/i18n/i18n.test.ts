import { describe, expect, it } from 'vitest';
import { LANGS } from '../engine/types';
import { HTML_LANG, MESSAGES, PLURAL_KEYS, detectLang, t, tp } from './index';

describe('i18n', () => {
  it('every language has the same keys, all non-empty, with the same placeholders', () => {
    // `.few` / `.many` plural forms exist only where the language needs them (Ukrainian).
    const base = (l: (typeof LANGS)[number]) =>
      Object.keys(MESSAGES[l]).filter((k) => !/\.(few|many)$/.test(k)).sort();
    const keys = base('en');
    for (const lang of LANGS) {
      expect(base(lang), lang).toEqual(keys);
      for (const k of Object.keys(MESSAGES[lang])) {
        const v = (MESSAGES[lang] as Record<string, string>)[k]!;
        const ref = (MESSAGES.en as Record<string, string>)[k.replace(/\.(few|many)$/, '.other')]!;
        expect(v.trim().length, `${lang}.${k}`).toBeGreaterThan(0);
        const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
        expect(ph(v), `${lang}.${k}`).toEqual(ph(ref));
      }
    }
  });

  it('every plural string has exactly the CLDR categories of its language', () => {
    for (const lang of LANGS) {
      const categories = new Intl.PluralRules(HTML_LANG[lang]).resolvedOptions().pluralCategories;
      expect(categories.length, lang).toBeGreaterThan(1);
      for (const k of PLURAL_KEYS) {
        const present = Object.keys(MESSAGES[lang])
          .filter((key) => key.startsWith(`${k}.`))
          .map((key) => key.slice(k.length + 1))
          .sort();
        expect(present, `${lang} ${k}`).toEqual([...categories].sort());
      }
    }
  });

  it('picks plural forms', () => {
    expect(tp('en', 'tile.ariaSteps', 1)).toBe('1 point missing');
    expect(tp('en', 'tile.ariaSteps', 3)).toBe('3 points missing');
    expect(tp('nl', 'tile.ariaSteps', 1)).toBe('er mist 1 punt');
    expect(tp('nl', 'tile.ariaSteps', 2)).toBe('er missen 2 punten');
    expect(tp('ua', 'tile.ariaSteps', 1)).toBe('ще 1 бал');
    expect(tp('ua', 'tile.ariaSteps', 3)).toBe('ще 3 бали');
    expect(tp('ua', 'tile.ariaSteps', 5)).toBe('ще 5 балів');
    expect(tp('ua', 'tile.ariaSteps', 11)).toBe('ще 11 балів');
    expect(tp('ua', 'tile.ariaSteps', 21)).toBe('ще 21 бал');
  });

  it('fills placeholders', () => {
    expect(t('en', 'summary.counts', { open: 12, total: 36, near: 7 })).toBe('Open: 12 of 36 · nearly there: 7');
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
