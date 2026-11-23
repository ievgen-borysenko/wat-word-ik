import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAPS,
  EMITTED_FILES,
  FORBIDDEN,
  FORMAT,
  KEYS,
  MAX_BYTES,
  MAX_DEPTH,
  MAX_INPUTS,
  MAX_INT_DIGITS,
  MAX_PER_RULE,
  MAX_PROFESSIONS,
  PATTERNS,
  PHRASES,
  READ_DEPTH,
  RULES,
  SUBJECT_IDS,
  WEIGHTS,
  checkEmitted,
  formatFinding,
  hasPhrase,
} from './check-data.mjs';

/*
 * The second check of the emitted data files. Every planted sample below is put
 * together at run time from fragments and code points, so this file holds none
 * of them as text; the collector's tests (collector/tests/) plant their own,
 * built apart from these.
 */
const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'check-data.mjs');
/** @param {string} path */
const source = (path) => readFileSync(join(ROOT, path), 'utf8');

/** @type {string[]} */
const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** @param {...number} codes */
const chars = (...codes) => String.fromCodePoint(...codes);
const COLON = chars(0x3a);
const SLASH = chars(0x2f);
const AT = chars(0x40);
const LESS = chars(0x3c);
const GREATER = chars(0x3e);
const BACKTICK = chars(0x60);
const BACKSLASH = chars(0x5c);
const HOST = ['exa', 'mple', '.', 'org'].join('');
const URL = ['ht', 'tps', COLON, SLASH, SLASH, HOST, SLASH, 'x'].join('');
const ADDRESS = ['some', 'one', AT, HOST].join('');
const MARKUP = [LESS, 'b', GREATER].join('');

/**
 * A value in the collector's canonical form: keys sorted, two spaces of indent,
 * a final line feed. For values with ASCII text and no integer-like keys only,
 * which is all this file writes.
 * @param {unknown} value
 */
function canonical(value) {
  /** @type {(v: unknown) => unknown} */
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      const o = /** @type {Record<string, unknown>} */ (v);
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sort(o[k])]));
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** A clean emitted file: one source, two professions. */
const BASE = {
  format: 1,
  inputs: [{ id: 'test-source', sha256: 'a'.repeat(64), version: '2.1' }],
  professions: {
    alpha: { biologie: { importance: 210, level: 320 }, wiskunde: { importance: 412, level: 610 } },
    beta: { wiskunde: { importance: 100, level: 0 } },
  },
};
const TEXT = canonical(BASE);
const LAST_LINE = TEXT.split('\n').length - 1;

/**
 * The clean file with a change made to a copy of its value.
 * @param {(doc: any) => void} change
 */
function edited(change) {
  const doc = structuredClone(BASE);
  change(doc);
  return canonical(doc);
}

/** An id of word fragments joined by hyphens. @param {...string[]} words */
const id = (...words) => words.map((parts) => parts.join('')).join('-');

/** The words of a PHRASES entry, each in a form the entry matches: a word with any ending gets "ing", one with an optional s gets the s. @param {string} entry */
const phraseWords = (entry) =>
  entry
    .replaceAll('|', '')
    .split(' ')
    .map((w) => (w.endsWith('*') ? `${w.slice(0, -1)}ing` : w.endsWith('(s)') ? `${w.slice(0, -3)}s` : w));

/** The words with `between` filler words between each two of them. @param {string[]} words @param {number} between */
const spread = (words, between, filler = 'x') => words.flatMap((w, i) => (i === 0 ? [w] : [...Array(between).fill(filler), w]));

/**
 * Where a finding must point: [line, column], or the place of a text in the
 * file (its nth occurrence from 0, moved `offset` bytes on; `line`: column 1
 * of that line), or null for anywhere.
 * @typedef {[number, number] | { find: string | Buffer, nth?: number, offset?: number, line?: boolean } | null} At
 * @typedef {{ what: string, rule: string, data: Buffer, at: [number, number] | null, planted: string | null }} Sample
 */

/**
 * @param {Buffer} data
 * @param {At} at
 * @returns {[number, number] | null}
 */
function resolveAt(data, at) {
  if (at === null || Array.isArray(at)) return at;
  const needle = typeof at.find === 'string' ? Buffer.from(at.find, 'utf8') : at.find;
  let index = -1;
  for (let i = 0; i <= (at.nth ?? 0); i++) index = data.indexOf(needle, index + 1);
  if (index === -1) throw new Error('the text that places the finding is not in the sample');
  index += at.offset ?? 0;
  let line = 1;
  let start = 0;
  for (let i = 0; i < index; i++) {
    if (data[i] === 0x0a) {
      line++;
      start = i + 1;
    }
  }
  return [line, at.line ? 1 : index - start + 1];
}

/**
 * @param {string} what
 * @param {string} rule
 * @param {string | Buffer} content
 * @param {At} at
 * @param {string | null} [planted]
 * @returns {Sample}
 */
function sample(what, rule, content, at, planted = null) {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return { what, rule, data, at: resolveAt(data, at), planted };
}

const ZWSP = chars(0x200b);
const RLO = chars(0x202e);
const TAGS = chars(0xe0069, 0xe0067, 0xe007f);
const VARIATION = chars(0xfe0f);
const BOM = chars(0xfeff);
const NUL = chars(0);
const DEL = chars(0x7f);
const ESC = chars(0x1b);
const NBSP = chars(0xa0);
const CYRILLIC_A = chars(0x430);
const LATIN1 = Buffer.concat([
  Buffer.from(TEXT.slice(0, TEXT.indexOf('"2.1"') + 1), 'latin1'),
  Buffer.from([0xe9]),
  Buffer.from(TEXT.slice(TEXT.indexOf('"2.1"') + 2), 'latin1'),
]);
const PHRASE_ID = id(['ign', 'ore'], ['the'], ['pre', 'vious'], ['instruc', 'tions']);
const PHRASE_SOURCE = id(['disre', 'gard'], ['pre', 'vious'], ['ru', 'les']);
const PHRASE_VERSION = ['for', 'get.every', 'thing'].join('');
const SORTED = /** @type {object} */ (JSON.parse(TEXT));

/** @type {Sample[]} */
const PLANTED = [
  // Bytes: printable ASCII, tab and line feed only.
  sample('zero-width space in a version', 'bytes', edited((d) => (d.inputs[0].version = `2${ZWSP}1`)), { find: ZWSP }, ZWSP),
  sample('right-to-left override before a profession id', 'bytes', TEXT.replace('"alpha"', `"${RLO}alpha"`), { find: RLO }, RLO),
  sample('tag characters in a source id', 'bytes', TEXT.replace('test-source', `test${TAGS}-source`), { find: TAGS }, TAGS),
  sample('variation selector in a hash', 'bytes', TEXT.replace('"aaaa', `"a${VARIATION}aaa`), { find: VARIATION }, VARIATION),
  sample('byte order mark', 'bytes', BOM + TEXT, [1, 1], BOM),
  sample('carriage return before a line feed', 'bytes', TEXT.replace('\n', `${chars(0x0d)}\n`), [1, 2]),
  sample('NUL byte in a number', 'bytes', TEXT.replace('412', `41${NUL}2`), { find: NUL }),
  sample('delete character in a key', 'bytes', TEXT.replace('"beta"', `"be${DEL}ta"`), { find: DEL }),
  sample('escape character in a version', 'bytes', TEXT.replace('"2.1"', `"2${ESC}1"`), { find: ESC }),
  sample('no-break space in a version', 'bytes', TEXT.replace('"2.1"', `"2${NBSP}1"`), { find: NBSP }, NBSP),
  sample('letter outside ASCII that looks Latin', 'bytes', TEXT.replace('"alpha"', `"alph${CYRILLIC_A}"`), { find: CYRILLIC_A }, CYRILLIC_A),
  sample('Latin-1 byte (not UTF-8)', 'bytes', LATIN1, { find: Buffer.from([0xe9]) }),
  // Forbidden sequences anywhere.
  sample('web address as a version', 'forbidden', edited((d) => (d.inputs[0].version = URL)), { find: COLON + SLASH + SLASH }, URL),
  sample('address without a scheme as a source id', 'forbidden', edited((d) => (d.inputs[0].id = SLASH + SLASH + HOST)), { find: SLASH + SLASH }, SLASH + SLASH + HOST),
  sample('e-mail address as a profession id', 'forbidden', TEXT.replace('"beta"', `"${ADDRESS}"`), { find: AT }, ADDRESS),
  sample('markup in a version', 'forbidden', edited((d) => (d.inputs[0].version = `2${MARKUP}`)), { find: LESS }, MARKUP),
  sample('backtick in a source id', 'forbidden', edited((d) => (d.inputs[0].id = `test${BACKTICK}source`)), { find: BACKTICK }),
  sample('backslash: an escape in a key', 'forbidden', TEXT.replace('"alpha"', `"${BACKSLASH}u0061lpha"`), { find: BACKSLASH }),
  // Lines.
  sample('empty file', 'lines', '', [1, 1]),
  sample('no line feed at the end', 'lines', TEXT.slice(0, -1), [LAST_LINE, 2]),
  sample('empty line', 'lines', TEXT.replace('\n', '\n\n'), [2, 1]),
  // Caps on bytes and professions.
  sample('file larger than its cap', 'file-size', TEXT + ' '.repeat(MAX_BYTES), [0, 0]),
  sample(
    'more professions than the cap',
    'row-cap',
    edited((d) => (d.professions = Object.fromEntries(Array.from({ length: MAX_PROFESSIONS + 1 }, (_, i) => [`p${i}`, {}])))),
    { find: '"professions": ', offset: 15 },
  ),
  // Length caps.
  sample('profession id longer than its cap', 'field-length', TEXT.replace('"beta"', `"${'b'.repeat(CAPS.id + 1)}"`), { find: '"bbb' }),
  sample('source id longer than its cap', 'field-length', edited((d) => (d.inputs[0].id = 's'.repeat(CAPS.id + 1))), { find: '"sss' }),
  sample('version longer than its cap', 'field-length', edited((d) => (d.inputs[0].version = `${'1.'.repeat(10)}1`)), { find: '"1.1.' }),
  sample('hash longer than its cap', 'field-length', edited((d) => (d.inputs[0].sha256 = 'a'.repeat(CAPS.sha256 + 1))), { find: '"aaa' }),
  // Patterns and closed lists.
  sample('profession id with a capital', 'field-shape', TEXT.replace('"alpha"', '"Alpha"'), { find: '"Alpha"' }),
  sample('profession id with an underscore', 'field-shape', TEXT.replace('"alpha"', '"al_pha"'), { find: '"al_pha"' }),
  sample('profession id with a trailing hyphen', 'field-shape', TEXT.replace('"alpha"', '"alpha-"'), { find: '"alpha-"' }),
  sample('a key that names the prototype', 'field-shape', TEXT.replace('"alpha"', '"__proto__"'), { find: '"__proto__"' }),
  sample('source id with a full stop', 'field-shape', edited((d) => (d.inputs[0].id = 'test.source')), { find: '"test.source"' }),
  sample('hash in upper case', 'field-shape', edited((d) => (d.inputs[0].sha256 = 'A'.repeat(64))), { find: '"AAA' }),
  sample('hash one digit short', 'field-shape', edited((d) => (d.inputs[0].sha256 = 'a'.repeat(63))), { find: '"aaa' }),
  sample('version with a space', 'field-shape', TEXT.replace('"2.1"', '"2 1"'), { find: '"2 1"' }),
  sample('version with two full stops in a row', 'field-shape', TEXT.replace('"2.1"', '"2..1"'), { find: '"2..1"' }),
  sample('unknown subject', 'field-shape', TEXT.replace('"biologie"', '"latijn"'), { find: '"latijn"' }),
  sample('subject in upper case', 'field-shape', TEXT.replace('"biologie"', '"Biologie"'), { find: '"Biologie"' }),
  // Ranges.
  sample('importance below its range', 'range', TEXT.replace('"importance": 100', '"importance": 99'), { find: '"importance": 99', offset: 14 }),
  sample('importance above its range', 'range', TEXT.replace('"importance": 412', '"importance": 501'), { find: '"importance": 501', offset: 14 }),
  sample('level below its range', 'range', TEXT.replace('"level": 0\n', '"level": -1\n'), { find: '"level": -1', offset: 9 }),
  sample('level above its range', 'range', TEXT.replace('"level": 610', '"level": 701'), { find: '"level": 701', offset: 9 }),
  // Phrasing of an embedded instruction in an id or a version.
  sample('instruction as a profession id', 'phrase', TEXT.replace('"beta"', `"${PHRASE_ID}"`), { find: `"${PHRASE_ID}"` }, PHRASE_ID),
  sample('instruction as a source id', 'phrase', edited((d) => (d.inputs[0].id = PHRASE_SOURCE)), { find: `"${PHRASE_SOURCE}"` }, PHRASE_SOURCE),
  sample('instruction as a version', 'phrase', edited((d) => (d.inputs[0].version = PHRASE_VERSION)), { find: `"${PHRASE_VERSION}"` }, PHRASE_VERSION),
  ...PHRASES.map((entry, i) => {
    const key = spread(phraseWords(entry), 1, 'green').join('-');
    return sample(`phrase list entry ${i + 1} with a word between, as a profession id`, 'phrase', TEXT.replace('"beta"', `"${key}"`), { find: `"${key}"` }, key);
  }),
  // Unique keys.
  sample('two sources with the same id', 'duplicate-key', edited((d) => d.inputs.push({ ...d.inputs[0], version: '3' })), { find: '"test-source"', nth: 1 }),
  // Strict JSON.
  sample('a key twice in an object', 'json-syntax', TEXT.replace('"format": 1,', '"format": 1,\n  "format": 1,'), { find: '"format"', nth: 1 }),
  sample('number with a fraction', 'json-syntax', TEXT.replace('412', '4.12'), { find: '4.12' }),
  sample('number with an exponent', 'json-syntax', TEXT.replace('412', '4E2'), { find: '4E2' }),
  sample('not a number', 'json-syntax', TEXT.replace('"level": 610', '"level": NaN'), { find: 'NaN' }),
  sample('infinity', 'json-syntax', TEXT.replace('"level": 610', '"level": -Infinity'), { find: '-Inf' }),
  sample('integer of more digits than the cap', 'json-syntax', TEXT.replace('"level": 610', `"level": ${'9'.repeat(MAX_INT_DIGITS + 1)}`), { find: '999' }),
  sample('number with a leading zero', 'json-syntax', TEXT.replace('"level": 610', '"level": 0610'), { find: '0610', offset: 1 }),
  sample('comma after the last item', 'json-syntax', TEXT.replace('    }\n  ],', '    },\n  ],'), { find: '  ],', offset: 2 }),
  sample('text in single quotes', 'json-syntax', TEXT.replace('"2.1"', "'2.1'"), { find: "'2.1'" }),
  sample('tab inside a string', 'json-syntax', TEXT.replace('"2.1"', `"2${chars(9)}1"`), { find: chars(9) }),
  sample('cut-off JSON', 'json-syntax', `${TEXT.slice(0, TEXT.indexOf('"professions"'))}\n`, null),
  sample('more after the value', 'json-syntax', `${TEXT}{}\n`, [LAST_LINE + 1, 1]),
  sample('a bare word', 'json-syntax', TEXT.replace('"level": 610', '"level": yes'), { find: 'yes' }),
  // Keys and types.
  sample('top level a list', 'json-shape', canonical([BASE]), [1, 1]),
  sample('top level text', 'json-shape', '"x"\n', [1, 1]),
  sample('unknown key at the top level', 'json-shape', edited((d) => (d.note = 'x')), [1, 1]),
  sample('top level without professions', 'json-shape', edited((d) => delete d.professions), [1, 1]),
  sample('format 2', 'json-shape', TEXT.replace('"format": 1', '"format": 2'), { find: '"format": 2', offset: 10 }),
  sample('format as text', 'json-shape', TEXT.replace('"format": 1', '"format": "1"'), { find: '"format": "1"', offset: 10 }),
  sample('format true', 'json-shape', TEXT.replace('"format": 1', '"format": true'), { find: '"format": true', offset: 10 }),
  sample('inputs an object', 'json-shape', edited((d) => (d.inputs = {})), { find: '"inputs": ', offset: 10 }),
  sample(
    'more sources than the cap',
    'json-shape',
    edited((d) => (d.inputs = Array.from({ length: MAX_INPUTS + 1 }, (_, i) => ({ id: `s${i}`, sha256: 'a'.repeat(64), version: '1' })))),
    { find: '"inputs": ', offset: 10 },
  ),
  sample('source with an unknown key', 'json-shape', edited((d) => (d.inputs[0].mirror = 'x')), { find: '    {', offset: 4 }),
  sample('source without a version', 'json-shape', edited((d) => delete d.inputs[0].version), { find: '    {', offset: 4 }),
  sample('source id that is a number', 'json-shape', edited((d) => (d.inputs[0].id = 7)), { find: '"id": 7', offset: 6 }),
  sample('weight as text', 'json-shape', TEXT.replace('"level": 610', '"level": "610"'), { find: '"610"' }),
  sample('weight true', 'json-shape', TEXT.replace('"level": 610', '"level": true'), { find: 'true' }),
  sample('weight null', 'json-shape', TEXT.replace('"level": 610', '"level": null'), { find: 'null' }),
  sample('professions a list', 'json-shape', edited((d) => (d.professions = [])), { find: '"professions": ', offset: 15 }),
  sample('a profession that is a list', 'json-shape', edited((d) => (d.professions.beta = [])), { find: '"beta": ', offset: 8 }),
  sample('subject with an unknown key', 'json-shape', edited((d) => (d.professions.beta.wiskunde.note = 1)), { find: '"wiskunde": ', nth: 1, offset: 12 }),
  sample('subject without a level', 'json-shape', edited((d) => delete d.professions.beta.wiskunde.level), { find: '"wiskunde": ', nth: 1, offset: 12 }),
  sample('weights without a source', 'json-shape', edited((d) => (d.inputs = [])), { find: '"professions": ', offset: 15 }),
  // Canonical form.
  sample('keys out of order', 'canonical', `${JSON.stringify({ professions: BASE.professions, inputs: BASE.inputs, format: 1 }, null, 2)}\n`, [2, 1]),
  sample('compact JSON', 'canonical', `${JSON.stringify(SORTED)}\n`, [1, 1]),
  sample('four spaces of indent', 'canonical', `${JSON.stringify(SORTED, null, 4)}\n`, [2, 1]),
  sample('a space at the end of a line', 'canonical', TEXT.replace('"format": 1,', '"format": 1, '), [2, 1]),
  sample('a space before the first line', 'canonical', ` ${TEXT}`, [1, 1]),
  sample('minus zero', 'canonical', TEXT.replace('"level": 0\n', '"level": -0\n'), { find: '-0', line: true }),
  sample('nested deeper than the canonical form allows', 'canonical', `${'['.repeat(MAX_DEPTH + 2)}${']'.repeat(MAX_DEPTH + 2)}\n`, [1, MAX_DEPTH + 2]),
];

/** @param {Buffer} data */
const findingsOf = (data) => checkEmitted(data, 'emitted').findings;

describe('check-data: the files it checks', () => {
  it('passes the tracked emitted files: the synthetic fixture, as the gate does, and the site file', () => {
    expect(EMITTED_FILES).toEqual(['collector/fixtures/synthetic/expected.json', 'src/data/sourced.json']);
    for (const file of EMITTED_FILES) {
      const result = checkEmitted(readFileSync(join(ROOT, file)), file);
      expect(result.findings, file).toEqual([]);
    }
    expect(checkEmitted(readFileSync(join(ROOT, EMITTED_FILES[0] ?? '')), 'f')).toMatchObject({ professions: 3, inputs: 1 });
  });

  it('passes the empty file, which the site file is in this version', () => {
    const empty = '{\n  "format": 1,\n  "inputs": [],\n  "professions": {}\n}\n';
    expect(source('src/data/sourced.json')).toBe(empty);
    expect(checkEmitted(Buffer.from(empty), 'f')).toEqual({ findings: [], professions: 0, inputs: 0 });
  });

  it('writes the canonical form in this test as the collector does', () => {
    const fixture = source('collector/fixtures/synthetic/expected.json');
    expect(canonical(JSON.parse(fixture))).toBe(fixture);
    expect(findingsOf(Buffer.from(TEXT))).toEqual([]);
  });

  it('checks every emitted file of the collector: the out of each named set in collector/run.py', () => {
    const outs = [...source('collector/run.py').matchAll(/'out': '([^']+)'/g)].map((m) => m[1]);
    expect(outs.length).toBeGreaterThan(0);
    expect([...outs].sort()).toEqual([...EMITTED_FILES].sort());
  });
});

describe('check-data: planted samples', () => {
  it('has a sample of every rule, and every sample has a rule of the check', () => {
    expect(new Set(PLANTED.map((s) => s.rule))).toEqual(new Set(RULES));
    expect(new Set(PLANTED.map((s) => s.what)).size).toBe(PLANTED.length);
  });

  it.each(PLANTED)('refuses $what by the rule $rule at its place', ({ rule, data, at }) => {
    const found = findingsOf(data);
    if (at === null) expect(found.map((f) => f.rule)).toContain(rule);
    else expect(found.map((f) => [f.rule, f.line, f.column])).toContainEqual([rule, ...at]);
  });

  it('never quotes the file in a finding', () => {
    for (const { what, data, planted } of PLANTED) {
      for (const f of findingsOf(data)) {
        const report = formatFinding(f);
        expect(report, what).toMatch(/^[\x20-\x7e]+$/);
        if (planted !== null) expect(report.includes(planted), what).toBe(false);
      }
    }
  });

  it('lists at most MAX_PER_RULE findings of one rule in a file, then says so', () => {
    const bytes = findingsOf(Buffer.from(TEXT.replace('"2.1"', `"${`2${NUL}`.repeat(MAX_PER_RULE + 50)}"`))).filter((f) => f.rule === 'bytes');
    expect(bytes.length).toBe(MAX_PER_RULE + 1);
    expect(bytes.at(-1)).toEqual({ rule: 'bytes', file: 'emitted', line: 0, column: 0, where: 'more not listed' });
    const at = findingsOf(Buffer.from(TEXT.replace('"2.1"', `"${`2${AT}`.repeat(MAX_PER_RULE + 50)}"`))).filter((f) => f.rule === 'forbidden');
    expect(at.length).toBe(MAX_PER_RULE + 1);
    expect(at.at(-1)?.where).toBe('at sign, more not listed');
  });

  it('stops reading nesting deeper than READ_DEPTH as a syntax error', () => {
    const deep = `${'['.repeat(READ_DEPTH + 2)}${']'.repeat(READ_DEPTH + 2)}\n`;
    expect(findingsOf(Buffer.from(deep)).map((f) => f.rule)).toEqual(['json-syntax']);
  });
});

describe('check-data: the phrase list', () => {
  it('matches each entry with up to three words between its words, as words and as an id', () => {
    for (const entry of PHRASES) {
      const words = phraseWords(entry);
      for (const between of [0, 1, 3]) {
        const parts = spread(words, between);
        expect(hasPhrase(parts.map((w) => (w[0] ?? '').toUpperCase() + w.slice(1)).join(' ')), `entry ${entry.replaceAll('|', ' ')}`).toBe(true);
        expect(hasPhrase(parts.join('-')), `entry ${entry.replaceAll('|', ' ')}`).toBe(true);
      }
    }
  });

  it('does not match with four words between', () => {
    for (const entry of PHRASES) {
      const words = phraseWords(entry);
      if (words.length > 1) expect(hasPhrase(spread(words, 4).join(' ')), `entry ${entry.replaceAll('|', ' ')}`).toBe(false);
    }
  });

  it('fits every planted phrase id in the cap of a profession id', () => {
    for (const entry of PHRASES) expect(spread(phraseWords(entry), 1, 'green').join('-').length).toBeLessThanOrEqual(CAPS.id);
  });

  it('passes ids and versions with words near the phrases', () => {
    // In this order the file itself trips no entry: a test below reads it whole.
    const ids = ['prompt-book-editor', 'dental-assistant', 'new-media-designer', 'instructional-designer', 'software-developer',
      'break-dancer', 'model-maker', 'you-and-now', 'language-teacher', 'system-analyst']; // prettier-ignore
    expect(findingsOf(Buffer.from(edited((d) => (d.professions = Object.fromEntries(ids.map((p) => [p, {}]))))))).toEqual([]);
    for (const version of ['30.0', '1.2.1', '2024.11', 'v1']) {
      expect(findingsOf(Buffer.from(edited((d) => (d.inputs[0].version = version)))), version).toEqual([]);
    }
  });

  it('this check, its test and the site file hold no planted text and trip no entry', () => {
    for (const path of ['scripts/check-data.mjs', 'scripts/check-data.test.mjs', 'src/data/sourced.json']) {
      const text = source(path).toLowerCase();
      expect(hasPhrase(text), path).toBe(false);
      for (const planted of [URL, ADDRESS, HOST, MARKUP, PHRASE_ID]) expect(text.includes(planted.toLowerCase()), path).toBe(false);
    }
  });
});

describe('check-data: the grammar is the gate grammar', () => {
  const SHAPES = source('collector/shapes.py');
  const GATE = source('collector/gate.py');
  const CANON = source('collector/canon.py');

  /** The text after `NAME = ` on its own line. @param {string} text @param {string} name */
  const assigned = (text, name) => {
    const m = new RegExp(`^${name} = (.+)$`, 'm').exec(text);
    if (!m) throw new Error(`${name} is not assigned on a line of its own`);
    return m[1] ?? '';
  };
  /** The quoted strings of a tuple assigned over several lines. @param {string} text @param {string} name */
  const tuple = (text, name) => {
    const m = new RegExp(`^${name} = \\(\\n(.*?)\\n\\)$`, 'ms').exec(text);
    if (!m) throw new Error(`${name} is not a tuple over several lines`);
    return [...(m[1] ?? '').matchAll(/'([^']*)'/g)].map((x) => x[1]);
  };
  /** A raw string pattern as a whole-value JavaScript pattern source. @param {string} name */
  const pattern = (name) => `^${/^r'(.*)'$/.exec(assigned(SHAPES, name))?.[1]}$`;
  /** @param {string} text */
  const integer = (text) => Number(text.replaceAll('_', ''));

  it('has the site subjects, in the order of the gate and of src/engine/types.ts', () => {
    expect(tuple(SHAPES, 'SUBJECT_IDS')).toEqual(SUBJECT_IDS);
    const types = /export const SUBJECT_IDS = \[([\s\S]*?)\] as const;/.exec(source('src/engine/types.ts'))?.[1] ?? '';
    expect([...types.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual(SUBJECT_IDS);
  });

  it('has the weights and their ranges', () => {
    const names = Object.fromEntries([...assigned(SHAPES, 'WEIGHT_NAMES').matchAll(/'([A-Z]+)': '([a-z]+)'/g)].map((m) => [m[1], m[2]]));
    const ranges = [...assigned(SHAPES, 'SCALE_RANGES').matchAll(/'([A-Z]+)': \((\d+), (\d+)\)/g)];
    expect(ranges.length).toBe(2);
    expect(Object.fromEntries(ranges.map((m) => [names[m[1] ?? ''] ?? '', [Number(m[2]), Number(m[3])]]))).toEqual(WEIGHTS);
  });

  it('has the patterns, word for word', () => {
    expect(PATTERNS.id.source).toBe(pattern('PROFESSION_ID'));
    expect(assigned(SHAPES, 'SOURCE_ID')).toBe('PROFESSION_ID');
    expect(PATTERNS.sha256.source).toBe(pattern('SHA256'));
    expect(PATTERNS.version.source).toBe(pattern('VERSION'));
    for (const re of Object.values(PATTERNS)) expect(re.flags).toBe('');
  });

  it('has the caps, the format and the integer rules', () => {
    expect(integer(assigned(SHAPES, 'SOURCE_ID_MAX'))).toBe(CAPS.id);
    expect(integer(assigned(SHAPES, 'VERSION_MAX'))).toBe(CAPS.version);
    expect(Number(/_text\(profession, shapes\.PROFESSION_ID, (\d+),/.exec(GATE)?.[1])).toBe(CAPS.id);
    expect(Number(/_text\(entry\['sha256'\], shapes\.SHA256, (\d+),/.exec(GATE)?.[1])).toBe(CAPS.sha256);
    expect(integer(assigned(SHAPES, 'EMITTED_MAX_BYTES'))).toBe(MAX_BYTES);
    expect(assigned(SHAPES, 'EMITTED_MAX_PROFESSIONS')).toBe('PROFESSIONS.max_rows');
    expect(Number(/^PROFESSIONS = TableShape\([\s\S]*?max_rows=(\d+),/m.exec(SHAPES)?.[1])).toBe(MAX_PROFESSIONS);
    expect(integer(assigned(SHAPES, 'MAX_SOURCES'))).toBe(MAX_INPUTS);
    expect(integer(assigned(SHAPES, 'FORMAT'))).toBe(FORMAT);
    expect(integer(assigned(CANON, 'MAX_INT_DIGITS'))).toBe(MAX_INT_DIGITS);
    expect(Number(/if depth > (\d+):/.exec(CANON)?.[1])).toBe(MAX_DEPTH);
    expect(integer(assigned(GATE, 'MAX_PER_RULE'))).toBe(MAX_PER_RULE);
  });

  it('has the keys, the empty list of inputs and the rule for weights without a source', () => {
    expect(assigned(GATE, 'EMITTED_KEYS')).toBe(`(${KEYS.top.map((k) => `'${k}'`).join(', ')})`);
    expect(assigned(GATE, 'INPUT_KEYS')).toBe(`(${KEYS.input.map((k) => `'${k}'`).join(', ')})`);
    expect(GATE).toContain("_sources(value['inputs'], INPUT_KEYS, file, out, 'inputs', minimum=0)");
    expect(GATE).toContain("'professions: weights without a source in inputs'");
  });

  it('has the rules of the gate that apply to a JSON file, in its order', () => {
    const tables = ['header', 'columns', 'reference', 'rows'];
    expect(tuple(GATE, 'RULES').filter((r) => !tables.includes(r ?? ''))).toEqual(RULES);
  });

  it('has the forbidden sequences, by name and code point', () => {
    const block = /^FORBIDDEN = \(\n([\s\S]*?)\n\)$/m.exec(GATE)?.[1] ?? '';
    const gate = [...block.matchAll(/^\s+\('([a-z -]+)', (.+)\),$/gm)].map((m) => ({
      name: m[1],
      bytes: (m[2] ?? '').split(' + ').flatMap((part) => {
        const c = /^chr\(0x([0-9A-F]+)\)(?: \* (\d+))?$/.exec(part);
        if (!c) throw new Error('a forbidden sequence the test cannot read');
        return Array(Number(c[2] ?? 1)).fill(Number.parseInt(c[1] ?? '', 16));
      }),
    }));
    expect(gate).toEqual(FORBIDDEN);
  });

  it('has the phrase list, entry for entry', () => {
    expect(tuple(GATE, 'PHRASES')).toEqual(PHRASES);
    expect(PHRASES.length).toBe(22);
  });

  // The characters each pattern accepts at each place, written out, as in collector/tests/test_grammar.py.
  it('accepts exactly the written characters at each place of an id and a version', () => {
    const printable = Array.from({ length: 0x7f - 0x20 }, (_, i) => chars(0x20 + i));
    const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const LOWER = UPPER.toLowerCase();
    const DIGITS = '0123456789';
    const ALNUM = DIGITS + UPPER + LOWER;
    /** @type {[RegExp, string, (c: string) => string, string][]} */
    const places = [
      [PATTERNS.id, 'first', (c) => `${c}ab`, LOWER],
      [PATTERNS.id, 'inside', (c) => `ab${c}cd`, `-${DIGITS}${LOWER}`],
      [PATTERNS.id, 'after a hyphen', (c) => `ab-${c}d`, DIGITS + LOWER],
      [PATTERNS.id, 'last', (c) => `ab${c}`, DIGITS + LOWER],
      [PATTERNS.version, 'first', (c) => `${c}1`, ALNUM],
      [PATTERNS.version, 'inside', (c) => `1${c}2`, `.${ALNUM}`],
      [PATTERNS.version, 'after a full stop', (c) => `1.${c}2`, ALNUM],
      [PATTERNS.version, 'last', (c) => `1${c}`, ALNUM],
      [PATTERNS.sha256, 'anywhere', (c) => `${'0'.repeat(32)}${c}${'0'.repeat(31)}`, '0123456789abcdef'],
    ];
    for (const [re, place, make, want] of places) {
      expect(printable.filter((c) => re.test(make(c))).join(''), `${re.source} ${place}`).toBe(want);
    }
  });
});

describe('check-data: command line', () => {
  /** @param {string[]} args @param {string} [cwd] */
  const run = (args, cwd = ROOT) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-data-'));
    made.push(dir);
    return dir;
  };

  it('checks the emitted files of the collector by default and exits 0', () => {
    const r = run([]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(
      'check:data: 2 emitted file(s) hold only their grammar: collector/fixtures/synthetic/expected.json (3 profession(s), 1 source(s)), src/data/sourced.json (0 profession(s), 0 source(s))\n',
    );
  });

  it('exits 1 for each planted sample, naming file, line and rule, never the text', () => {
    const dir = folder();
    const files = PLANTED.map((s, i) => {
      const path = join(dir, `sample-${i}.json`);
      writeFileSync(path, s.data);
      return path;
    });
    const clean = join(dir, 'clean.json');
    writeFileSync(clean, TEXT);
    const r = run([clean, ...files]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toContain(`${clean} refused`);
    expect(r.stderr).toContain(`check:data: ${PLANTED.length} of ${PLANTED.length + 1} file(s) refused`);
    PLANTED.forEach(({ what, rule, at, planted }, i) => {
      const path = files[i] ?? '';
      expect(r.stderr, what).toContain(`check:data: ${path} refused`);
      expect(r.stderr, what).toContain(at === null ? `  ${rule} ${path}:` : `  ${rule} ${path}:${at[0]}:${at[1]}`);
      if (planted !== null) expect(r.stderr.includes(planted), what).toBe(false);
    });
    for (const line of r.stderr.split('\n').slice(0, -1)) expect(line).toMatch(/^[\x20-\x7e]+$/);
  });

  it('exits 2 for a file it cannot read, a folder, an option, or a folder without the emitted files', () => {
    const dir = folder();
    mkdirSync(join(dir, 'sub'));
    const missing = run([join(dir, 'missing.json')]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('(ENOENT)');
    expect(run([join(dir, 'sub')]).status).toBe(2);
    const option = run(['--all']);
    expect(option.status).toBe(2);
    expect(option.stderr).toContain('usage:');
    expect(run([], dir).status).toBe(2);
  });
});
