#!/usr/bin/env node
// The data the site reads holds only its grammar: the second check of the
// files that the collector's emit writes (docs/collector.md).
//
// The collector's gate (collector/gate.py) holds every file the collector
// writes to a closed grammar before the file enters the repository. This
// script checks the emitted files against the same grammar once more, written
// apart from the gate, in another language and without a JSON library, so
// that a bug in the gate is not also a bug here. It runs in the audit job,
// which installs no dependencies: it uses Node's own modules only.
//
// The grammar of an emitted file, as collector/shapes.py and gate.py declare it:
//   - at most MAX_BYTES bytes of printable ASCII, tab and line feed, with a
//     line feed at the end and no empty line;
//   - nowhere a scheme separator, a double slash, an at sign, a less-than or
//     greater-than sign, a backtick or a backslash (FORBIDDEN);
//   - strict JSON: no key twice in an object, no fraction or exponent, no NaN
//     or infinity, integers of at most MAX_INT_DIGITS digits;
//   - an object with exactly the keys `format` (FORMAT), `inputs` (0 to
//     MAX_INPUTS sources, each with exactly `id`, `sha256` and `version`, no id
//     twice) and `professions` (at most MAX_PROFESSIONS, keyed by profession
//     id; under each, school subjects of SUBJECT_IDS, each with exactly an
//     `importance` and a `level` in the ranges of WEIGHTS); weights only with
//     at least one source in `inputs`;
//   - ids, hashes and versions within their caps (CAPS) and patterns
//     (PATTERNS), and ids and versions free of the phrasing in PHRASES;
//   - in canonical form: keys sorted, two spaces of indent, ASCII only, a final
//     line feed, as the collector's canonical writer gives it.
//
// The rule ids are the gate's, so a report reads the same from both:
// file-size, bytes, forbidden, lines, row-cap, field-length, field-shape,
// range, phrase, duplicate-key, json-syntax, json-shape and canonical. The
// gate's rules for tables (header, columns, reference, rows) have no part in a
// JSON file. A finding names the rule, the file, the line and the column (the
// byte in the line, both from 1) and at most a description written here; it
// never quotes the file.
//
// The grammar's values (lists, ranges, caps, patterns, the phrase list) are the
// gate's and must stay equal to them: scripts/check-data.test.mjs reads
// collector/shapes.py, gate.py and canon.py and compares. The code that applies
// them is this file's own. Both accept the collector's synthetic fixture and
// the site's file, and each side's tests plant their own refused samples.
// Where the two can still differ is in docs/collector.md, "The second check".
//
// Usage: node scripts/check-data.mjs [file ...]
//   (default: EMITTED_FILES, relative to the current directory)
// Exit codes: 0 every file passes, 1 a file was refused (findings listed),
// 2 the check could not run (a file that cannot be read, bad arguments).

import { closeSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The emitted files: the `out` of every named set in collector/run.py (a test compares). */
export const EMITTED_FILES = ['collector/fixtures/synthetic/expected.json', 'src/data/sourced.json'];

/** The rule ids this check reports, in the gate's order. */
export const RULES = [
  'file-size',
  'bytes',
  'forbidden',
  'lines',
  'row-cap',
  'field-length',
  'field-shape',
  'range',
  'phrase',
  'duplicate-key',
  'json-syntax',
  'json-shape',
  'canonical',
];

export const MAX_BYTES = 300_000;
export const MAX_PROFESSIONS = 200;
export const MAX_INPUTS = 16;
export const FORMAT = 1;
export const MAX_INT_DIGITS = 12;
/** The deepest a value may sit in the canonical form; the top level is 0. */
export const MAX_DEPTH = 32;
/** The deepest the reader follows nesting; deeper, it stops with json-syntax. */
export const READ_DEPTH = 512;
/** At most this many findings of one rule in one file; then one more says so. */
export const MAX_PER_RULE = 100;

/** The site's school subjects (SUBJECT_IDS in src/engine/types.ts). */
export const SUBJECT_IDS = [
  'wiskunde',
  'natuurkunde',
  'scheikunde',
  'biologie',
  'nederlands',
  'engels',
  'geschiedenis',
  'aardrijkskunde',
  'techniek',
  'kunst',
];

/** The keys of the top level and of each source in `inputs`. */
export const KEYS = { top: ['format', 'inputs', 'professions'], input: ['id', 'sha256', 'version'] };

/** The two weights of a subject and their ranges, in hundredths: importance 1.00 to 5.00, level 0.00 to 7.00. */
export const WEIGHTS = { importance: [100, 500], level: [0, 700] };

/** Length caps: a profession or source id, a sha256, a version. */
export const CAPS = { id: 40, sha256: 64, version: 20 };

/**
 * Patterns, matched against the whole value. An id: lower-case letters and
 * digits in words joined by single hyphens, starting with a letter. A version:
 * letters and digits in words joined by full stops.
 */
export const PATTERNS = {
  id: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  sha256: /^[0-9a-f]{64}$/,
  version: /^[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*$/,
};

/** Sequences refused anywhere, by their bytes, so that this file does not hold them as text. */
export const FORBIDDEN = [
  { name: 'scheme separator', bytes: [0x3a, 0x2f, 0x2f] },
  { name: 'double slash', bytes: [0x2f, 0x2f] },
  { name: 'at sign', bytes: [0x40] },
  { name: 'less-than sign', bytes: [0x3c] },
  { name: 'greater-than sign', bytes: [0x3e] },
  { name: 'backtick', bytes: [0x60] },
  { name: 'backslash', bytes: [0x5c] },
];

/**
 * Generic phrasing of an embedded instruction, looked for in every value that
 * can carry words: profession and source ids, and versions. As in the gate,
 * this is a tripwire for the obvious cases, not a filter: the patterns are the
 * guarantee. Each entry is words in this order, at most three other words
 * apart; a word ending in * matches any ending, one ending in (s) an optional
 * s. Each word is split by | so that no phrase stands in this file as text.
 */
export const PHRASES = [
  'ign|ore* instruc|tion(s)',
  'ign|ore* pre|vious',
  'ign|ore* ab|ove',
  'disre|gard* instruc|tion(s)',
  'disre|gard* pre|vious',
  'for|get* instruc|tion(s)',
  'for|get* every|thing',
  'pre|vious instruc|tion(s)',
  'n|ew instruc|tion(s)',
  'sys|tem pro|mpt*',
  'y|ou a|re n|ow',
  'a|s a|n a|i',
  'lang|uage mod|el*',
  'jail|break*',
  'devel|oper mo|de',
  'over|rid* instruc|tion(s)',
  'rev|eal* pro|mpt*',
  'd|o n|ot te|ll',
  'd|o n|ot rev|eal',
  'pre|tend* y|ou',
  'd|ear assis|tant',
  'h|ey assis|tant',
];

/** @param {string} entry */
function phrasePattern(entry) {
  const words = entry
    .replaceAll('|', '')
    .split(' ')
    .map((word) => {
      if (word.endsWith('*')) return `${word.slice(0, -1)}[a-z]*`;
      if (word.endsWith('(s)')) return `${word.slice(0, -3)}s?`;
      return word;
    });
  for (const word of words) if (!/^[a-z]+(?:\[a-z\]\*|s\?)?$/.test(word)) throw new Error('a phrase entry holds more than letters');
  return new RegExp(`\\b${words.join('[^a-z]+(?:[a-z]+[^a-z]+){0,3}')}\\b`);
}

const PHRASE_PATTERNS = PHRASES.map(phrasePattern);

/** True when the text holds an entry of PHRASES, in any case. @param {string} text */
export function hasPhrase(text) {
  const lower = text.toLowerCase();
  return PHRASE_PATTERNS.some((re) => re.test(lower));
}

/**
 * @typedef {{ rule: string, file: string, line: number, column: number, where: string }} Finding
 *   line and column count from 1; line 0 means the whole file
 * @typedef {{ findings: Finding[], professions: number | null, inputs: number | null }} Result
 *   professions, inputs: how many the file holds, or null when it was refused before its shape was read
 */

/** @param {Finding} f */
export function formatFinding(f) {
  const text = `${f.rule} ${f.file}:${f.line}:${f.column}`;
  return f.where ? `${text} (${f.where})` : text;
}

/** Byte offsets where each line starts. @param {Uint8Array} bytes */
function lineStarts(bytes) {
  const starts = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) starts.push(i + 1);
  return starts;
}

/**
 * The line and column (the byte in the line) of an offset, both from 1.
 * @param {number[]} starts
 * @param {number} index
 */
function positionIn(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (/** @type {number} */ (starts[mid]) <= index) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: index - /** @type {number} */ (starts[low]) + 1 };
}

/** @param {number} byte */
const allowedByte = (byte) => byte === 0x09 || byte === 0x0a || (byte >= 0x20 && byte <= 0x7e);

/**
 * The checks of every emitted file before it is read as JSON: size, bytes,
 * forbidden sequences, lines. True when it can be read as ASCII lines.
 * @param {Buffer} bytes
 * @param {(rule: string, index: number | null, where?: string) => void} add
 * @param {(rule: string, line: number, column: number, where?: string) => void} addAt
 */
function checkText(bytes, add, addAt) {
  if (bytes.length > MAX_BYTES) {
    addAt('file-size', 0, 0, `more than ${MAX_BYTES} bytes`);
    return false;
  }
  // Bytes: one finding per run of refused bytes (a character of several bytes is one run).
  let readable = true;
  let listed = 0;
  let inside = false;
  for (let i = 0; i < bytes.length; i++) {
    if (allowedByte(/** @type {number} */ (bytes[i]))) {
      inside = false;
      continue;
    }
    if (inside) continue;
    inside = true;
    readable = false;
    if (listed === MAX_PER_RULE) {
      addAt('bytes', 0, 0, 'more not listed');
      break;
    }
    add('bytes', i);
    listed++;
  }
  for (const { name, bytes: sequence } of FORBIDDEN) {
    const needle = Buffer.from(sequence);
    let count = 0;
    for (let at = bytes.indexOf(needle); at !== -1; at = bytes.indexOf(needle, at + 1)) {
      if (count === MAX_PER_RULE) {
        addAt('forbidden', 0, 0, `${name}, more not listed`);
        break;
      }
      add('forbidden', at, name);
      count++;
    }
  }
  if (bytes.length === 0) {
    addAt('lines', 1, 1, 'empty file');
    return false;
  }
  let lines = true;
  if (bytes[bytes.length - 1] !== 0x0a) {
    add('lines', bytes.length, 'no line feed at the end');
    lines = false;
  }
  /** @type {number[]} where each empty line starts */
  const empty = bytes[0] === 0x0a ? [0] : [];
  for (let at = bytes.indexOf('\n\n'); at !== -1 && empty.length <= MAX_PER_RULE; at = bytes.indexOf('\n\n', at + 1)) empty.push(at + 1);
  for (let i = 0; i < empty.length; i++) {
    if (i === MAX_PER_RULE) {
      addAt('lines', 0, 0, 'empty line, more not listed');
      break;
    }
    add('lines', /** @type {number} */ (empty[i]), 'empty line');
    lines = false;
  }
  return lines && readable;
}

/*
 * A strict JSON reader that keeps where each value and key starts. It accepts
 * what the collector's reader accepts (Python's json module with hooks that
 * refuse a key twice, fractions, exponents, NaN, infinity and long integers)
 * and builds no JavaScript object from the data, so no key can reach a
 * prototype.
 */

/**
 * @typedef {{ kind: 'object', at: number, entries: { key: string, at: number, value: Node }[] }} ObjectNode
 * @typedef {{ kind: 'array', at: number, items: Node[] }} ArrayNode
 * @typedef {ObjectNode | ArrayNode
 *   | { kind: 'string', at: number, value: string }
 *   | { kind: 'integer', at: number, value: number }
 *   | { kind: 'boolean', at: number, value: boolean }
 *   | { kind: 'null', at: number }} Node
 */

class JsonProblem extends Error {
  /** @param {number} at @param {string} message */
  constructor(at, message) {
    super(message);
    this.at = at;
  }
}

/** @param {number} code */
const isDigit = (code) => code >= 0x30 && code <= 0x39;
/** @param {number} code */
const isSpace = (code) => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
/** @type {Record<string, string>} */
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/**
 * @param {string} text
 * @returns {Node}
 */
export function readJson(text) {
  let pos = 0;
  /** @type {(message: string, at?: number) => never} */
  const fail = (message, at = pos) => {
    throw new JsonProblem(at, message);
  };
  const space = () => {
    while (pos < text.length && isSpace(text.charCodeAt(pos))) pos++;
  };
  /** @returns {string} */
  const string = () => {
    const start = pos;
    pos++;
    let out = '';
    for (;;) {
      if (pos >= text.length) fail('a string is not closed', start);
      const code = text.charCodeAt(pos);
      if (code === 0x22) {
        pos++;
        return out;
      }
      if (code < 0x20) fail('a control character in a string');
      if (code !== 0x5c) {
        out += text[pos];
        pos++;
        continue;
      }
      const kind = text[pos + 1] ?? '';
      if (kind === 'u') {
        const hex = text.slice(pos + 2, pos + 6);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) fail('an escape of a character code is not four hexadecimal digits');
        out += String.fromCharCode(Number.parseInt(hex, 16));
        pos += 6;
      } else if (Object.hasOwn(ESCAPES, kind)) {
        out += ESCAPES[kind];
        pos += 2;
      } else {
        fail('an escape that JSON does not have');
      }
    }
  };
  /**
   * @param {number} depth
   * @returns {Node}
   */
  const value = (depth) => {
    if (depth > READ_DEPTH) fail('the value is nested too deeply');
    const at = pos;
    const c = text[pos];
    if (c === '{') {
      pos++;
      space();
      /** @type {ObjectNode} */
      const node = { kind: 'object', at, entries: [] };
      if (text[pos] === '}') {
        pos++;
        return node;
      }
      /** @type {Set<string>} */
      const seen = new Set();
      for (;;) {
        if (text[pos] !== '"') fail('a key in double quotes was expected');
        const keyAt = pos;
        const key = string();
        if (seen.has(key)) fail('an object has the same key twice', keyAt);
        seen.add(key);
        space();
        if (text[pos] !== ':') fail('a colon was expected');
        pos++;
        space();
        node.entries.push({ key, at: keyAt, value: value(depth + 1) });
        space();
        if (text[pos] === ',') {
          pos++;
          space();
          continue;
        }
        if (text[pos] === '}') {
          pos++;
          return node;
        }
        fail('a comma or the end of the object was expected');
      }
    }
    if (c === '[') {
      pos++;
      space();
      /** @type {ArrayNode} */
      const node = { kind: 'array', at, items: [] };
      if (text[pos] === ']') {
        pos++;
        return node;
      }
      for (;;) {
        node.items.push(value(depth + 1));
        space();
        if (text[pos] === ',') {
          pos++;
          space();
          continue;
        }
        if (text[pos] === ']') {
          pos++;
          return node;
        }
        fail('a comma or the end of the list was expected');
      }
    }
    if (c === '"') return { kind: 'string', at, value: string() };
    for (const word of ['NaN', 'Infinity', '-Infinity']) if (text.startsWith(word, pos)) fail('NaN or infinity');
    if (c === '-' || isDigit(text.charCodeAt(pos))) {
      if (c === '-') pos++;
      if (!isDigit(text.charCodeAt(pos))) fail('a digit was expected');
      if (text[pos] === '0') pos++;
      else while (isDigit(text.charCodeAt(pos))) pos++;
      if (text[pos] === '.' || text[pos] === 'e' || text[pos] === 'E') fail('a number has a fraction or an exponent', at);
      const digits = pos - at - (c === '-' ? 1 : 0);
      if (digits > MAX_INT_DIGITS) fail(`an integer has more than ${MAX_INT_DIGITS} digits`, at);
      // -0 reads as 0, as in the collector's reader.
      return { kind: 'integer', at, value: Number(text.slice(at, pos)) || 0 };
    }
    for (const [word, node] of /** @type {[string, Node][]} */ ([
      ['true', { kind: 'boolean', at, value: true }],
      ['false', { kind: 'boolean', at, value: false }],
      ['null', { kind: 'null', at }],
    ])) {
      if (text.startsWith(word, pos)) {
        pos += word.length;
        return node;
      }
    }
    return fail('a value was expected');
  };
  space();
  const root = value(0);
  space();
  if (pos !== text.length) fail('more after the value');
  return root;
}

/** Compares by code point, as Python sorts text. @param {string} a @param {string} b */
function byCodePoint(a, b) {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = /** @type {number} */ (x[i]?.codePointAt(0)) - /** @type {number} */ (y[i]?.codePointAt(0));
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** JSON text of a string with every character outside printable ASCII escaped. @param {string} s */
function quote(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0d) out += '\\r';
    else if (code === 0x09) out += '\\t';
    else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += s[i];
  }
  return `${out}"`;
}

class TooDeep extends Error {
  /** @param {number} at */
  constructor(at) {
    super('the value is nested too deeply');
    this.at = at;
  }
}

/**
 * The canonical text of a value, as the collector's writer gives it (Python's
 * json.dumps with sorted keys, an indent of 2 and ASCII only): every key and
 * item on a line of its own, indented two spaces per level, a comma at the
 * end of every line but the last of its object or list, ": " after a key,
 * keys sorted by code point, `{}` and `[]` when empty.
 * @param {Node} node
 * @param {number} depth
 * @returns {string}
 */
function canonical(node, depth) {
  if (depth > MAX_DEPTH) throw new TooDeep(node.at);
  const inner = '  '.repeat(depth + 1);
  const outer = '  '.repeat(depth);
  switch (node.kind) {
    case 'object': {
      if (node.entries.length === 0) return '{}';
      const sorted = [...node.entries].sort((a, b) => byCodePoint(a.key, b.key));
      return `{\n${sorted.map((e) => `${inner}${quote(e.key)}: ${canonical(e.value, depth + 1)}`).join(',\n')}\n${outer}}`;
    }
    case 'array':
      if (node.items.length === 0) return '[]';
      return `[\n${node.items.map((item) => `${inner}${canonical(item, depth + 1)}`).join(',\n')}\n${outer}]`;
    case 'string':
      return quote(node.value);
    case 'integer':
      return String(node.value);
    case 'boolean':
      return node.value ? 'true' : 'false';
    case 'null':
      return 'null';
  }
}

/**
 * Checks one emitted file.
 * @param {Uint8Array} data the file's bytes
 * @param {string} file the name findings give
 * @returns {Result}
 */
export function checkEmitted(data, file) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  /** @type {Finding[]} */
  const findings = [];
  const starts = lineStarts(bytes);
  /** @type {(rule: string, line: number, column: number, where?: string) => void} */
  const addAt = (rule, line, column, where = '') => {
    findings.push({ rule, file, line, column, where });
  };
  /** @type {(rule: string, index: number | null, where?: string) => void} */
  const add = (rule, index, where = '') => {
    if (index === null) addAt(rule, 0, 0, where);
    else {
      const { line, column } = positionIn(starts, index);
      addAt(rule, line, column, where);
    }
  };
  if (!checkText(bytes, add, addAt)) return { findings, professions: null, inputs: null };

  const text = bytes.toString('latin1');
  /** @type {Node} */
  let root;
  try {
    root = readJson(text);
  } catch (err) {
    if (!(err instanceof JsonProblem)) throw err;
    add('json-syntax', err.at, err.message);
    return { findings, professions: null, inputs: null };
  }
  const counts = checkShape(root, add);

  let want;
  try {
    want = `${canonical(root, 0)}\n`;
  } catch (err) {
    if (!(err instanceof TooDeep)) throw err;
    add('canonical', err.at, err.message);
    return { findings, ...counts };
  }
  if (want !== text) {
    const have = text.split('\n');
    const lines = want.split('\n');
    let line = Math.min(have.length, lines.length);
    for (let i = 0; i < Math.min(have.length, lines.length); i++) {
      if (have[i] !== lines[i]) {
        line = i + 1;
        break;
      }
    }
    addAt('canonical', line, 1, 'differs from the canonical form from this line on');
  }
  return { findings, ...counts };
}

/**
 * The shape of the emitted file, in the order the gate checks it.
 * @param {Node} root
 * @param {(rule: string, index: number | null, where?: string) => void} add
 * @returns {{ professions: number | null, inputs: number | null }}
 */
function checkShape(root, add) {
  /**
   * The object's values by key when it has exactly these keys, else null.
   * @param {Node} node
   * @param {string[]} keys
   * @param {string} where
   */
  const exactly = (node, keys, where) => {
    const want = [...keys].sort();
    if (node.kind === 'object') {
      const have = node.entries.map((e) => e.key).sort();
      if (have.length === want.length && have.every((k, i) => k === want[i])) {
        return new Map(node.entries.map((e) => [e.key, e.value]));
      }
    }
    add('json-shape', node.at, `${where}: an object with the keys ${want.join(', ')}`);
    return null;
  };
  /**
   * A text value within its cap and pattern, and free of phrases when it can carry words.
   * @param {string} value
   * @param {number} at
   * @param {RegExp} pattern
   * @param {number} cap
   * @param {string} where
   * @param {boolean} words
   */
  const fits = (value, at, pattern, cap, where, words) => {
    if ([...value].length > cap) {
      add('field-length', at, `${where}, at most ${cap}`);
      return false;
    }
    if (!pattern.test(value)) {
      add('field-shape', at, where);
      return false;
    }
    if (words && hasPhrase(value)) {
      add('phrase', at, where);
      return false;
    }
    return true;
  };
  /**
   * @param {Node | undefined} node
   * @param {RegExp} pattern
   * @param {number} cap
   * @param {string} where
   * @param {boolean} words
   * @returns {node is { kind: 'string', at: number, value: string }}
   */
  const text = (node, pattern, cap, where, words) => {
    if (node === undefined) return false;
    if (node.kind !== 'string') {
      add('json-shape', node.at, `${where}: not text`);
      return false;
    }
    return fits(node.value, node.at, pattern, cap, where, words);
  };

  const top = exactly(root, KEYS.top, 'top level');
  if (top === null) return { professions: null, inputs: null };
  const format = /** @type {Node} */ (top.get('format'));
  if (format.kind !== 'integer' || format.value !== FORMAT) add('json-shape', format.at, `format: ${FORMAT}`);

  const inputs = /** @type {Node} */ (top.get('inputs'));
  if (inputs.kind !== 'array' || inputs.items.length > MAX_INPUTS) {
    add('json-shape', inputs.at, `inputs: a list of 0 to ${MAX_INPUTS} sources`);
  } else {
    /** @type {Set<string>} */
    const seen = new Set();
    for (const item of inputs.items) {
      const entry = exactly(item, KEYS.input, 'inputs[]');
      if (entry === null) continue;
      const id = entry.get('id');
      if (text(id, PATTERNS.id, CAPS.id, 'inputs[].id', true)) {
        if (seen.has(id.value)) add('duplicate-key', id.at, 'inputs[].id');
        seen.add(id.value);
      }
      text(entry.get('sha256'), PATTERNS.sha256, CAPS.sha256, 'inputs[].sha256', false);
      text(entry.get('version'), PATTERNS.version, CAPS.version, 'inputs[].version', true);
    }
  }
  const inputCount = inputs.kind === 'array' ? inputs.items.length : null;

  const professions = /** @type {Node} */ (top.get('professions'));
  if (professions.kind !== 'object') {
    add('json-shape', professions.at, 'professions: an object');
    return { professions: null, inputs: inputCount };
  }
  if (professions.entries.length > MAX_PROFESSIONS) {
    add('row-cap', professions.at, `professions: at most ${MAX_PROFESSIONS}`);
    return { professions: professions.entries.length, inputs: inputCount };
  }
  if (professions.entries.length > 0 && inputCount === 0) {
    add('json-shape', professions.at, 'professions: weights without a source in inputs');
  }
  for (const { key, at, value } of professions.entries) {
    if (!fits(key, at, PATTERNS.id, CAPS.id, 'professions: key', true)) continue;
    if (value.kind !== 'object') {
      add('json-shape', value.at, 'professions: a value is not an object');
      continue;
    }
    for (const { key: subject, at: subjectAt, value: cell } of value.entries) {
      if (!SUBJECT_IDS.includes(subject)) {
        add('field-shape', subjectAt, 'professions: a subject key');
        continue;
      }
      const weights = exactly(cell, Object.keys(WEIGHTS), 'professions: a subject');
      if (weights === null) continue;
      for (const [name, [low, high]] of Object.entries(WEIGHTS)) {
        const number = /** @type {Node} */ (weights.get(name));
        if (number.kind !== 'integer') {
          add('json-shape', number.at, `professions: ${name}: not an integer`);
        } else if (number.value < /** @type {number} */ (low) || number.value > /** @type {number} */ (high)) {
          add('range', number.at, `professions: ${name}, ${low} to ${high}`);
        }
      }
    }
  }
  return { professions: professions.entries.length, inputs: inputCount };
}

/**
 * At most `max` bytes of a file.
 * @param {string} path
 * @param {number} max
 */
function readCapped(path, max) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(max);
    let length = 0;
    let n = 0;
    while (length < max && (n = readSync(fd, buffer, length, max - length, null)) > 0) length += n;
    return buffer.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

/** Findings shown per rule and file; the rest are counted. */
const SHOWN = 20;

const USAGE = 'usage: node scripts/check-data.mjs [file ...]   (default: the emitted files of the collector, from the current directory)';

/** @param {string[]} argv */
function main(argv) {
  if (argv.some((a) => a.startsWith('-'))) {
    console.error(USAGE);
    return 2;
  }
  const files = argv.length > 0 ? argv : EMITTED_FILES;
  /** @type {Map<string, Buffer>} */
  const read = new Map();
  let unreadable = 0;
  for (const file of files) {
    try {
      // One byte more than the cap, so an oversize file is seen as such without reading all of it.
      read.set(file, readCapped(file, MAX_BYTES + 1));
    } catch (err) {
      const code = /** @type {NodeJS.ErrnoException} */ (err).code ?? 'error';
      console.error(`check:data: cannot read ${file} (${code})`);
      unreadable++;
    }
  }
  if (unreadable > 0) return 2;
  /** @type {string[]} */
  const passed = [];
  let refused = 0;
  for (const [file, bytes] of read) {
    const { findings, professions, inputs } = checkEmitted(bytes, file);
    if (findings.length === 0) {
      passed.push(`${file} (${professions} profession(s), ${inputs} source(s))`);
      continue;
    }
    refused++;
    console.error(`check:data: ${file} refused, ${findings.length} finding(s): rule file:line:column (where)`);
    /** @type {Map<string, number>} */
    const shown = new Map();
    for (const f of findings) {
      const n = (shown.get(f.rule) ?? 0) + 1;
      shown.set(f.rule, n);
      if (n <= SHOWN) console.error(`  ${formatFinding(f)}`);
    }
    for (const [rule, n] of shown) if (n > SHOWN) console.error(`  ... and ${n - SHOWN} more ${rule} finding(s) in ${file}`);
  }
  if (refused > 0) {
    console.error(`check:data: ${refused} of ${read.size} file(s) refused`);
    return 1;
  }
  console.log(`check:data: ${read.size} emitted file(s) hold only their grammar: ${passed.join(', ')}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
