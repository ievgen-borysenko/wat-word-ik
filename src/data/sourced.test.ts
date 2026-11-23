import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFESSIONS } from './professions';
import { SOURCED, loadSourced, sourcedWeights, weightsProvenance } from './sourced';

/*
 * The provenance of the data: which weights come from a source is read from
 * src/data/sourced.json, never typed by hand, and every weight there names
 * its source. The grammar of the file (bytes, ranges, patterns, canonical
 * form) is checked by the collector's gate and by scripts/check-data.mjs;
 * these tests hold it against the site's own data.
 */
const RAW: unknown = JSON.parse(readFileSync(join(import.meta.dirname, 'sourced.json'), 'utf8'));

/** The message of the error that `run` throws. */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('nothing was thrown');
}

describe('sourced data (src/data/sourced.json)', () => {
  it('is read by the loader as it is written', () => {
    expect(SOURCED).toEqual(RAW);
  });

  it('holds weights only for professions of the site, in their ranges', () => {
    const ids = new Set(PROFESSIONS.map((p) => p.id));
    for (const [id, weights] of Object.entries(SOURCED.professions)) {
      expect(ids.has(id), `${id} has weights in sourced.json but is not a profession of the site`).toBe(true);
      for (const [subject, w] of Object.entries(weights)) {
        expect(w.importance, `${id} ${subject} importance`).toBeGreaterThanOrEqual(100);
        expect(w.importance, `${id} ${subject} importance`).toBeLessThanOrEqual(500);
        expect(w.level, `${id} ${subject} level`).toBeGreaterThanOrEqual(0);
        expect(w.level, `${id} ${subject} level`).toBeLessThanOrEqual(700);
      }
    }
  });

  it('names a source for its weights: an id, the sha256 of the raw file and a version, each source once', () => {
    if (Object.keys(SOURCED.professions).length > 0) expect(SOURCED.inputs.length, 'weights without a source').toBeGreaterThan(0);
    for (const input of SOURCED.inputs) {
      expect(input.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(input.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(input.version).toMatch(/^[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*$/);
    }
    expect(new Set(SOURCED.inputs.map((i) => i.id)).size).toBe(SOURCED.inputs.length);
  });

  it("derives provenance from the file: a profession's weights are sourced exactly when the file has its entry", () => {
    for (const p of PROFESSIONS) {
      const entry = Object.hasOwn(SOURCED.professions, p.id);
      expect(weightsProvenance(p.id), p.id).toBe(entry ? 'sourced' : 'demo');
      expect(sourcedWeights(p.id) !== undefined, p.id).toBe(entry);
    }
    const sourced = PROFESSIONS.filter((p) => weightsProvenance(p.id) === 'sourced').map((p) => p.id);
    expect(sourced.sort()).toEqual(Object.keys(SOURCED.professions).sort());
  });

  // The number of professions with sourced weights. A change here is a change in
  // the data: update it on purpose, together with sourced.json.
  it('has no sourced weights yet, so every weight on the site is demo data', () => {
    expect(PROFESSIONS.filter((p) => weightsProvenance(p.id) === 'sourced').length).toBe(0);
    expect(SOURCED.inputs).toEqual([]);
  });

  it('counts no property of an object as an entry', () => {
    for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) expect(weightsProvenance(id), id).toBe('demo');
  });
});

describe('the loader of sourced.json', () => {
  const GOOD = {
    format: 1,
    inputs: [{ id: 'test-source', sha256: '0'.repeat(64), version: '1' }],
    professions: { arts: { biologie: { importance: 300, level: 400 } } },
  };
  /** GOOD with the weights of one subject replaced. */
  const withWeights = (cell: unknown) => ({ ...GOOD, professions: { arts: { biologie: cell } } });

  it('reads a file of the declared shape as it is', () => {
    expect(loadSourced(GOOD)).toEqual(GOOD);
    expect(loadSourced({ format: 1, inputs: [], professions: {} })).toEqual({ format: 1, inputs: [], professions: {} });
  });

  it.each<[string, unknown]>([
    ['a list', []],
    ['null', null],
    ['another format', { ...GOOD, format: 2 }],
    ['the format as text', { ...GOOD, format: '1' }],
    ['an extra key', { ...GOOD, note: 'x' }],
    ['no professions', { format: 1, inputs: [] }],
    ['inputs that are not a list', { ...GOOD, inputs: {} }],
    ['a source without a version', { ...GOOD, inputs: [{ id: 'test-source', sha256: '0'.repeat(64) }] }],
    ['a source id that is not text', { ...GOOD, inputs: [{ id: 7, sha256: '0'.repeat(64), version: '1' }] }],
    ['professions that are a list', { ...GOOD, professions: [] }],
    ['a profession that is a list', { ...GOOD, professions: { arts: [] } }],
    ['an unknown subject', { ...GOOD, professions: { arts: { latijn: { importance: 300, level: 400 } } } }],
    ['a weight with a fraction', withWeights({ importance: 3.5, level: 400 })],
    ['a weight as text', withWeights({ importance: '300', level: 400 })],
    ['a subject without a level', withWeights({ importance: 300 })],
    ['a subject with an extra key', withWeights({ importance: 300, level: 400, note: 1 })],
  ])('refuses %s', (_what, value) => {
    expect(messageOf(() => loadSourced(value))).toMatch(/^sourced\.json: /);
  });

  it('names the place, never a value from the file', () => {
    const message = messageOf(() => loadSourced({ ...GOOD, professions: { arts: { latijn: { importance: 300, level: 400 } } } }));
    expect(message).not.toContain('latijn');
    expect(messageOf(() => loadSourced(withWeights({ importance: 'abc', level: 400 })))).not.toContain('abc');
  });
});
