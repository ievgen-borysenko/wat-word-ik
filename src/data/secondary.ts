import type { ExamSubject, HavoVwoProfile, Localized, OtherOption, SchoolLevel, VmboDirection } from '../engine/types';
import { L } from './subjects';

/*
 * DEMO data (M0) for the onderbouw view: names of the school levels, profiles,
 * vmbo directions and exam subjects. The admission rules themselves are on each
 * profession (professions.ts), checked against the Ratho (docs/sources.md).
 */

/** Button labels of the school levels. The names are Dutch school terms, kept in every language. */
export const SCHOOL_LEVEL_NAMES: Readonly<Record<SchoolLevel, Localized>> = {
  bbkb: L('vmbo-bb/kb', 'vmbo-bb/kb', 'vmbo-bb/kb'),
  gltl: L('vmbo-gl/tl', 'vmbo-gl/tl', 'vmbo-gl/tl'),
  havo: L('havo', 'havo', 'havo'),
  vwo: L('vwo', 'vwo', 'vwo'),
};

/** The havo and vwo profiles: the full name, and the short form used on doors. */
export const PROFILE_NAMES: Readonly<Record<HavoVwoProfile, { readonly name: Localized; readonly short: Localized }>> = {
  nt: {
    name: L('Natuur & Techniek', 'Nature & Technology', 'Природа і техніка'),
    short: L('N&T', 'N&T', 'N&T'),
  },
  ng: {
    name: L('Natuur & Gezondheid', 'Nature & Health', 'Природа і здоров’я'),
    short: L('N&G', 'N&G', 'N&G'),
  },
  em: {
    name: L('Economie & Maatschappij', 'Economics & Society', 'Економіка і суспільство'),
    short: L('E&M', 'E&M', 'E&M'),
  },
  cm: {
    name: L('Cultuur & Maatschappij', 'Culture & Society', 'Культура і суспільство'),
    short: L('C&M', 'C&M', 'C&M'),
  },
};

/** The four broad vmbo directions (the real vmbo has ten profiles). */
export const DIRECTION_NAMES: Readonly<Record<VmboDirection, Localized>> = {
  techniek: L('Techniek', 'Technology', 'Техніка'),
  zorg: L('Zorg en welzijn', 'Care and welfare', 'Догляд і добробут'),
  economie: L('Economie', 'Economics', 'Економіка'),
  groen: L('Groen', 'Green (nature and farming)', 'Зелений напрям (природа й аграрна справа)'),
};

/** Exam subjects as named in Dutch schools; translated where the name is not a school term. */
export const EXAM_SUBJECT_NAMES: Readonly<Record<ExamSubject, Localized>> = {
  'wiskunde-a': L('wiskunde A', 'maths A (wiskunde A)', 'математика A (wiskunde A)'),
  'wiskunde-b': L('wiskunde B', 'maths B (wiskunde B)', 'математика B (wiskunde B)'),
  natuurkunde: L('natuurkunde', 'physics', 'фізика'),
  scheikunde: L('scheikunde', 'chemistry', 'хімія'),
  biologie: L('biologie', 'biology', 'біологія'),
};

/**
 * The exam subjects by their short school names, for lists on the bovenbouw view's doors
 * and cards ("maths A or maths B"), where the full names would nest brackets; the boxes
 * show the full names above.
 */
export const EXAM_SUBJECT_SHORT: Readonly<Record<ExamSubject, Localized>> = {
  'wiskunde-a': L('wiskunde A', 'maths A', 'математика A'),
  'wiskunde-b': L('wiskunde B', 'maths B', 'математика B'),
  natuurkunde: L('natuurkunde', 'physics', 'фізика'),
  scheikunde: L('scheikunde', 'chemistry', 'хімія'),
  biologie: L('biologie', 'biology', 'біологія'),
};

/**
 * The subjects a cell of the regulation can offer as a choice that the bovenbouw view
 * has no box for: the abbreviation as the regulation writes it, and the full name
 * from the legend of its Bijlage B (Dutch school terms, kept in every language).
 */
export const OTHER_OPTION_NAMES: Readonly<Record<OtherOption, { readonly short: string; readonly name: Localized }>> = {
  nlt: {
    short: 'nlt',
    name: L('nlt (natuur, leven & technologie)', 'nlt (natuur, leven & technologie)', 'nlt (natuur, leven & technologie)'),
  },
  'o&o': {
    short: 'o&o',
    name: L('o&o (onderzoek & ontwerpen)', 'o&o (onderzoek & ontwerpen)', 'o&o (onderzoek & ontwerpen)'),
  },
  'pgp-t': {
    short: 'PgP-T',
    name: L(
      'PgP-T (Praktijkgerichte Programma Technologie)',
      'PgP-T (Praktijkgerichte Programma Technologie)',
      'PgP-T (Praktijkgerichte Programma Technologie)',
    ),
  },
};
