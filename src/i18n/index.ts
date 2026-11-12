import type { Lang } from '../engine/types';
import en from './en.json';
import nl from './nl.json';
import ua from './ua.json';

export type MessageKey = keyof typeof en;
type Messages = Readonly<Record<MessageKey, string>>;

export const MESSAGES: Readonly<Record<Lang, Messages>> = { en, nl, ua };

// The app code for Ukrainian is `ua`; the standard language tag for HTML is `uk`.
export const HTML_LANG: Readonly<Record<Lang, string>> = { ua: 'uk', nl: 'nl', en: 'en-GB' };

type Params = Readonly<Record<string, string | number>>;

function fill(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Look up a UI string and fill `{name}` placeholders. Unknown placeholders stay visible. */
export function t(lang: Lang, key: MessageKey, params: Params = {}): string {
  return fill(MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key, params);
}

/** Strings with a count: stored as `<key>.one`, `.few`, `.many`, `.other` (CLDR plural categories). */
export const PLURAL_KEYS = ['tile.ariaSteps', 'card.focusAverage'] as const;
export type PluralKey = (typeof PLURAL_KEYS)[number];

export function tp(lang: Lang, key: PluralKey, n: number, params: Params = {}): string {
  const category = new Intl.PluralRules(HTML_LANG[lang]).select(n);
  const msgs = MESSAGES[lang] as Readonly<Record<string, string>>;
  const template = msgs[`${key}.${category}`] ?? msgs[`${key}.other`] ?? key;
  return fill(template, { n, ...params });
}

/** First browser language we support: uk/ru -> ua, nl -> nl, en -> en; otherwise English. */
export function detectLang(languages: readonly string[] | undefined): Lang {
  for (const raw of languages ?? []) {
    const code = raw.toLowerCase().split('-')[0];
    if (code === 'uk' || code === 'ru') return 'ua';
    if (code === 'nl') return 'nl';
    if (code === 'en') return 'en';
  }
  return 'en';
}
