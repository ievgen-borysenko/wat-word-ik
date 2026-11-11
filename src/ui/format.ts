import { SUBJECTS } from '../data/subjects';
import type { Gap } from '../engine/hints';
import type { Lang, Level, Profession, SubjectId } from '../engine/types';
import { t, type MessageKey } from '../i18n';

const SUBJECT_BY_ID = new Map(SUBJECTS.map((s) => [s.id, s]));

export function subjectName(id: SubjectId, lang: Lang, short = true): string {
  const s = SUBJECT_BY_ID.get(id);
  if (!s) return id;
  return (short && s.short ? s.short : s.name)[lang];
}

export function subjectEmoji(id: SubjectId): string {
  return SUBJECT_BY_ID.get(id)?.emoji ?? '';
}

export function shortName(p: Profession, lang: Lang): string {
  return (p.short ?? p.name)[lang];
}

export function floorLabel(level: Level, lang: Lang): string {
  return t(lang, `floor.${level}.label` as MessageKey);
}

export function floorAbout(level: Level, lang: Lang): string {
  return t(lang, `floor.${level}.about` as MessageKey);
}

/** "Maths +2, overall level +1" for the goal banner. */
export function gapList(gaps: readonly Gap[], lang: Lang): string {
  return gaps
    .map((g) =>
      g.kind === 'subject'
        ? t(lang, 'goal.subject', { subject: subjectName(g.subject, lang), n: g.points })
        : t(lang, 'goal.average', { n: g.points }),
    )
    .join(', ');
}

export function euros(pay: number): string {
  return '€'.repeat(pay);
}

/** Format an average like 6.4 with the decimal mark of the language. */
export function decimal(v: number, lang: Lang): string {
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return lang === 'en' ? s : s.replace('.', ',');
}
