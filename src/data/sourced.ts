import { SUBJECT_IDS, type SubjectId } from '../engine/types';
import data from './sourced.json';

/*
 * The weights collected from open sources: src/data/sourced.json, written by
 * the collector's emit (docs/collector.md) and checked twice before it reaches
 * the site, by the collector's gate and by scripts/check-data.mjs. No source
 * has been collected yet, so the file holds no weights, and no page reads this
 * module yet.
 *
 * Which fields are sourced is read from the file, never typed by hand: a
 * profession's weights are sourced exactly when the file has its entry
 * (weightsProvenance); everything else is demo data (professions.ts).
 */

/** The version of the file's form that this module reads. */
export const SOURCED_FORMAT = 1;

/** A source the weights come from, as the collector's lock pins it. */
export interface SourcedInput {
  readonly id: string;
  /** sha256 of the raw file the weights were derived from. */
  readonly sha256: string;
  readonly version: string;
}

/** In hundredths: importance 100 to 500 (1.00 to 5.00), level 0 to 700 (0.00 to 7.00). */
export interface SourcedWeight {
  readonly importance: number;
  readonly level: number;
}

export type SourcedWeights = Readonly<Partial<Record<SubjectId, SourcedWeight>>>;

export interface Sourced {
  readonly format: typeof SOURCED_FORMAT;
  readonly inputs: readonly SourcedInput[];
  /** By profession id; a profession without weights has no entry. */
  readonly professions: Readonly<Record<string, SourcedWeights>>;
}

/** Where a group of a profession's fields comes from. */
export type Provenance = 'sourced' | 'demo';

function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`sourced.json: ${where} is not an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  const have = Object.keys(value).sort();
  const want = [...keys].sort();
  if (have.length !== want.length || have.some((k, i) => k !== want[i])) {
    throw new Error(`sourced.json: ${where} does not have exactly the keys ${want.join(', ')}`);
  }
}

function integer(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`sourced.json: ${where} is not an integer`);
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new Error(`sourced.json: ${where} is not text`);
  return value;
}

/**
 * The file's content with its types checked: an object of exactly `format`,
 * `inputs` and `professions`, the format this module reads, text where text
 * belongs, integer weights and known subjects. The values themselves (ranges,
 * patterns, caps, canonical form) are the grammar that the gate and
 * check:data hold the file to; this reads what has passed them. Messages name
 * the place, never a value from the file.
 */
export function loadSourced(value: unknown): Sourced {
  const top = object(value, 'the top level');
  exactKeys(top, ['format', 'inputs', 'professions'], 'the top level');
  if (top.format !== SOURCED_FORMAT) throw new Error(`sourced.json: format is not ${SOURCED_FORMAT}`);
  if (!Array.isArray(top.inputs)) throw new Error('sourced.json: inputs is not a list');
  const inputs = top.inputs.map((entry: unknown): SourcedInput => {
    const input = object(entry, 'a source in inputs');
    exactKeys(input, ['id', 'sha256', 'version'], 'a source in inputs');
    return { id: text(input.id, 'a source id'), sha256: text(input.sha256, 'a sha256'), version: text(input.version, 'a version') };
  });
  const known = new Set<string>(SUBJECT_IDS);
  const professions: Record<string, SourcedWeights> = {};
  for (const [id, entry] of Object.entries(object(top.professions, 'professions'))) {
    const weights: Partial<Record<SubjectId, SourcedWeight>> = {};
    for (const [subject, cell] of Object.entries(object(entry, 'a profession'))) {
      if (!known.has(subject)) throw new Error('sourced.json: a subject is not a subject of the site');
      const weight = object(cell, 'a subject');
      exactKeys(weight, ['importance', 'level'], 'a subject');
      weights[subject as SubjectId] = { importance: integer(weight.importance, 'an importance'), level: integer(weight.level, 'a level') };
    }
    // Defined, not assigned, so that no key can reach the prototype.
    Object.defineProperty(professions, id, { value: weights, enumerable: true });
  }
  return { format: SOURCED_FORMAT, inputs, professions };
}

/** The weights collected from open sources, from src/data/sourced.json. */
export const SOURCED: Sourced = loadSourced(data as unknown);

/** A profession's collected weights, or undefined when the file has none for it. */
export function sourcedWeights(professionId: string): SourcedWeights | undefined {
  return Object.hasOwn(SOURCED.professions, professionId) ? SOURCED.professions[professionId] : undefined;
}

/** Where a profession's weights come from: sourced exactly when sourced.json has its entry, demo otherwise. */
export function weightsProvenance(professionId: string): Provenance {
  return sourcedWeights(professionId) === undefined ? 'demo' : 'sourced';
}
