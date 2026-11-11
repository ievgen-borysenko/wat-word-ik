import type { Lang, Localized } from '../engine/types';
import en from './en.json';
import nl from './nl.json';
import ua from './ua.json';

export type MessageKey = keyof typeof en;
type Messages = Readonly<Record<MessageKey, string>>;

export const MESSAGES: Readonly<Record<Lang, Messages>> = { en, nl, ua };

// The app code for Ukrainian is `ua`; the standard language tag for HTML is `uk`.
export const HTML_LANG: Readonly<Record<Lang, string>> = { ua: 'uk', nl: 'nl', en: 'en-GB' };

/** Look up a UI string and fill `{name}` placeholders. Unknown placeholders stay visible. */
export function t(lang: Lang, key: MessageKey, params: Readonly<Record<string, string | number>> = {}): string {
  const template = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Pick the text for a language from a data record. */
export function pick(l: Localized, lang: Lang): string {
  return l[lang];
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
