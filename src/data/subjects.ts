import type { Localized, Subject } from '../engine/types';

export const L = (nl: string, en: string, ua: string): Localized => ({ nl, en, ua });

/** DEMO data (M0). Order matches SUBJECT_IDS. */
export const SUBJECTS: readonly Subject[] = [
  { id: 'wiskunde', emoji: '🔢', name: L('Wiskunde', 'Maths', 'Математика') },
  { id: 'natuurkunde', emoji: '🧲', name: L('Natuurkunde', 'Physics', 'Фізика') },
  { id: 'scheikunde', emoji: '🧪', name: L('Scheikunde', 'Chemistry', 'Хімія') },
  { id: 'biologie', emoji: '🌱', name: L('Biologie', 'Biology', 'Біологія') },
  {
    id: 'nederlands',
    emoji: '📖',
    name: L('Nederlands (lezen en schrijven)', 'Dutch (reading and writing)', 'Нідерландська (читання й письмо)'),
    short: L('Nederlands', 'Dutch', 'Нідерландська'),
  },
  { id: 'engels', emoji: '💬', name: L('Engels', 'English', 'Англійська') },
  {
    id: 'geschiedenis',
    emoji: '🏛️',
    name: L('Geschiedenis en maatschappij', 'History and society', 'Історія і суспільство'),
    short: L('Geschiedenis', 'History', 'Історія'),
  },
  { id: 'aardrijkskunde', emoji: '🌍', name: L('Aardrijkskunde', 'Geography', 'Географія') },
  {
    id: 'techniek',
    emoji: '🔧',
    name: L('Techniek (maken met je handen)', 'Technology (making things)', 'Техніка (робота руками)'),
    short: L('Techniek', 'Technology', 'Техніка'),
  },
  {
    id: 'kunst',
    emoji: '🎨',
    name: L('Kunst en vormgeving', 'Art and design', 'Мистецтво й дизайн'),
    short: L('Kunst', 'Art', 'Мистецтво'),
  },
];
