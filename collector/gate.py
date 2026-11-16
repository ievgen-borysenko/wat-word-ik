"""The gate: the check of every file the collector lets into the repository.

It holds each file to its declared shape (shapes.py), a closed grammar, and
refuses anything outside it. Its findings name a rule, a file, a line and a
column, and at most a description taken from the shape; they never quote the
file's content, so reading a report cannot pass on what a file carries.

Rules (the ids that findings and the self-test use):

  file-size     the file is larger than its cap
  bytes         a byte that is not printable ASCII, tab or line feed: this
                keeps out by construction zero-width and bidirectional
                characters, tag characters, variation selectors, a byte order
                mark, control characters, carriage returns and any letter
                outside ASCII
  forbidden     a scheme separator, a double slash, an at sign, a less-than or
                greater-than sign, a backtick or a backslash, anywhere
  lines         an empty file, an empty line, or no line feed at the end
  row-cap       more data rows (or professions) than the cap
  header        the first line is not the exact header
  columns       a row with another number of fields than the header
  field-length  a field longer than its cap
  field-shape   a field outside its pattern or closed list of values
  range         an integer outside its range
  phrase        generic phrasing of an embedded instruction in a free-text
                field (see PHRASES)
  duplicate-key two rows (or JSON entries) with the same key
  reference     an extract row that names a profession or element the
                mappings do not have, or another occupation code than the
                professions mapping gives; two professions with the same
                occupation code and different titles
  rows          the extract does not have exactly one row per profession,
                element and scale
  json-syntax   not strict JSON: a syntax error, a duplicate key, a number
                with a fraction or exponent, NaN or infinity
  json-shape    JSON without the declared keys and types
  canonical     the emitted file is not in canonical form (canon.py)

The tables must pass every rule; the emitted file every rule that applies to
JSON. The lock is written by a person and later names download addresses, so
it gets the byte, line, syntax and shape rules but not `forbidden`.

Line and column count from 1; the column is the byte in the line. Line 0
means the whole file, or a place inside a JSON value that the check does not
locate.
"""

import json
import re
from dataclasses import dataclass

import canon
import shapes

RULES = (
    'file-size',
    'bytes',
    'forbidden',
    'lines',
    'row-cap',
    'header',
    'columns',
    'field-length',
    'field-shape',
    'range',
    'phrase',
    'duplicate-key',
    'reference',
    'rows',
    'json-syntax',
    'json-shape',
    'canonical',
)

# At most this many findings of one rule in one file; then one more says so.
MAX_PER_RULE = 100


@dataclass(frozen=True)
class Finding:
    rule: str
    file: str
    line: int
    column: int
    # A description from the shape or this module, never from the data.
    where: str = ''

    def __str__(self) -> str:
        text = f'{self.rule} {self.file}:{self.line}:{self.column}'
        return f'{text} ({self.where})' if self.where else text


def _record(out: list, finding: Finding) -> None:
    """Every finding passes through here."""
    out.append(finding)


# Bytes allowed anywhere: tab, line feed and printable ASCII.
_ALLOWED = frozenset([0x09, 0x0A, *range(0x20, 0x7F)])
_ALLOWED_BYTES = bytes(sorted(_ALLOWED))

# Sequences refused anywhere, with their names for the report. They are built
# from their code points so that this file does not hold them as text.
FORBIDDEN = (
    ('scheme separator', chr(0x3A) + chr(0x2F) * 2),
    ('double slash', chr(0x2F) * 2),
    ('at sign', chr(0x40)),
    ('less-than sign', chr(0x3C)),
    ('greater-than sign', chr(0x3E)),
    ('backtick', chr(0x60)),
    ('backslash', chr(0x5C)),
)
_FORBIDDEN_BYTES = tuple((name, seq.encode('ascii')) for name, seq in FORBIDDEN)

# Generic phrasing of an embedded instruction, looked for in free-text fields.
# The grammar is the guarantee: it keeps every field to letters, digits and a
# few marks. What it lets through is words, so this list is a tripwire for the
# planted controls and for the obvious cases, not a filter that can be relied
# on. Each entry is words in this order, at most three other words apart; a
# word ending in * matches any ending, one ending in (s) an optional s. Each
# word is split by | so that no phrase stands in this file as text.
PHRASES = (
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
)


def _phrase_pattern(entry: str) -> re.Pattern:
    words = []
    for word in entry.replace('|', '').split(' '):
        if word.endswith('*'):
            words.append(re.escape(word[:-1]) + '[a-z]*')
        elif word.endswith('(s)'):
            words.append(re.escape(word[:-3]) + 's?')
        else:
            words.append(re.escape(word))
    gap = r'[^a-z]+(?:[a-z]+[^a-z]+){0,3}'
    return re.compile(r'\b' + gap.join(words) + r'\b', re.ASCII)


_PHRASE_PATTERNS = tuple(_phrase_pattern(entry) for entry in PHRASES)


def has_phrase(field: str) -> bool:
    lower = field.lower()
    return any(p.search(lower) for p in _PHRASE_PATTERNS)


_PATTERNS: dict = {}


def _fullmatch(pattern: str, field: str) -> bool:
    compiled = _PATTERNS.get(pattern)
    if compiled is None:
        compiled = _PATTERNS[pattern] = re.compile(pattern, re.ASCII)
    return compiled.fullmatch(field) is not None


def _position(data: bytes, index: int) -> tuple:
    line = data.count(b'\n', 0, index) + 1
    column = index - (data.rfind(b'\n', 0, index) + 1) + 1
    return line, column


def _check_bytes(data: bytes, file: str, out: list) -> bool:
    if not data.translate(None, _ALLOWED_BYTES):
        return True
    line, column, listed, inside = 1, 1, 0, False
    for byte in data:
        if byte in _ALLOWED:
            inside = False
        elif not inside:
            # One finding per run of refused bytes (a character of several bytes is one run).
            inside = True
            if listed == MAX_PER_RULE:
                _record(out, Finding('bytes', file, 0, 0, 'more not listed'))
                break
            _record(out, Finding('bytes', file, line, column))
            listed += 1
        if byte == 0x0A:
            line, column = line + 1, 1
        else:
            column += 1
    return False


def _check_forbidden(data: bytes, file: str, out: list) -> bool:
    clean = True
    for name, seq in _FORBIDDEN_BYTES:
        listed = 0
        at = data.find(seq)
        while at != -1:
            clean = False
            if listed == MAX_PER_RULE:
                _record(out, Finding('forbidden', file, 0, 0, f'{name}, more not listed'))
                break
            line, column = _position(data, at)
            _record(out, Finding('forbidden', file, line, column, name))
            listed += 1
            at = data.find(seq, at + 1)
    return clean


def _check_lines(data: bytes, file: str, out: list) -> bool:
    if data == b'':
        _record(out, Finding('lines', file, 1, 1, 'empty file'))
        return False
    clean = True
    if not data.endswith(b'\n'):
        line, column = _position(data, len(data))
        _record(out, Finding('lines', file, line, column, 'no line feed at the end'))
        clean = False
    starts = [0] if data.startswith(b'\n') else []
    at = data.find(b'\n\n')
    while at != -1 and len(starts) <= MAX_PER_RULE:
        starts.append(at + 1)
        at = data.find(b'\n\n', at + 1)
    for listed, start in enumerate(starts):
        if listed == MAX_PER_RULE:
            _record(out, Finding('lines', file, 0, 0, 'empty line, more not listed'))
            break
        _record(out, Finding('lines', file, _position(data, start)[0], 1, 'empty line'))
        clean = False
    return clean


def _check_text(data: bytes, cap: int, file: str, out: list, forbidden: bool = True) -> bool:
    """The rules for every file: size, bytes, forbidden sequences, lines.
    True when the file can be read as ASCII lines."""
    if len(data) > cap:
        _record(out, Finding('file-size', file, 0, 0, f'more than {cap} bytes'))
        return False
    readable = _check_bytes(data, file, out)
    if forbidden:
        _check_forbidden(data, file, out)
    return _check_lines(data, file, out) and readable


@dataclass
class Table:
    findings: list
    # (line number, fields) of each data row that passed every field check.
    rows: list
    # Data rows in the file; None when the file could not be read as a table.
    count: int | None


def check_table(data: bytes, shape: shapes.TableShape, file: str) -> Table:
    out: list = []
    if not _check_text(data, shape.max_bytes, file, out):
        return Table(out, [], None)
    lines = data.decode('ascii')[:-1].split('\n')
    if len(lines) - 1 > shape.max_rows:
        _record(out, Finding('row-cap', file, shape.max_rows + 2, 1, f'more than {shape.max_rows} data rows'))
        return Table(out, [], None)
    if lines[0] != shape.header:
        _record(out, Finding('header', file, 1, 1, 'expected: ' + shape.header.replace('\t', ', ')))
        return Table(out, [], None)
    width = len(shape.columns)
    keys = [shape.index(name) for name in shape.key]
    scale_at = shape.index('scale') if any(c.scaled for c in shape.columns) else None
    seen: dict = {}
    rows = []
    for number, line in enumerate(lines[1:], start=2):
        fields = line.split('\t')
        if len(fields) != width:
            _record(out, Finding('columns', file, number, 1, f'expected {width} fields'))
            continue
        starts = []
        offset = 0
        for field in fields:
            starts.append(offset + 1)
            offset += len(field) + 1
        good = True
        for column, field, start in zip(shape.columns, fields, starts):
            where = f'column {column.name}'
            if len(field) > column.max_len:
                _record(out, Finding('field-length', file, number, start, f'{where}, at most {column.max_len}'))
                good = False
                continue
            if column.values is not None:
                fits = field in column.values
            else:
                fits = _fullmatch(column.pattern, field)
            if not fits:
                _record(out, Finding('field-shape', file, number, start, where))
                good = False
                continue
            if column.scaled and scale_at is not None and fields[scale_at] in shapes.SCALE_RANGES:
                low, high = shapes.SCALE_RANGES[fields[scale_at]]
                if not low <= int(field) <= high:
                    _record(out, Finding('range', file, number, start, f'{where}, {low} to {high}'))
                    good = False
            if column.free_text and has_phrase(field):
                _record(out, Finding('phrase', file, number, start, where))
                good = False
        if not good:
            continue
        key = tuple(fields[i] for i in keys)
        if key in seen:
            _record(out, Finding('duplicate-key', file, number, starts[keys[0]], f'same key as line {seen[key]}'))
            continue
        seen[key] = number
        rows.append((number, tuple(fields)))
    return Table(out, rows, len(lines) - 1)


def check_set(extract: bytes, professions: bytes, subjects: bytes, files: tuple = ('extract', 'professions', 'subjects')) -> list:
    """The extract and the two mappings, each on its own and against each other."""
    ext = check_table(extract, shapes.EXTRACT, files[0])
    pro = check_table(professions, shapes.PROFESSIONS, files[1])
    sub = check_table(subjects, shapes.SUBJECTS, files[2])
    out = ext.findings + pro.findings + sub.findings
    if pro.findings or sub.findings or pro.count is None or sub.count is None or ext.count is None:
        # Without both mappings intact there is nothing to compare against.
        return out
    soc_of = {fields[0]: fields[1] for _, fields in pro.rows}
    title_of: dict = {}
    for number, (profession, soc, title) in pro.rows:
        if title_of.setdefault(soc, (title, number))[0] != title:
            where = f'column title: not the title of line {title_of[soc][1]}, which has the same occupation code'
            _record(out, Finding('reference', files[1], number, len(profession) + len(soc) + 3, where))
    elements = {fields[0] for _, fields in sub.rows}
    for number, (profession, soc, element, _scale, _value) in ext.rows:
        if profession not in soc_of:
            _record(out, Finding('reference', files[0], number, 1, 'column profession: not in the professions mapping'))
        elif soc != soc_of[profession]:
            where = 'column soc: not the code that the professions mapping gives this profession'
            _record(out, Finding('reference', files[0], number, len(profession) + 2, where))
        if element not in elements:
            column = len(profession) + len(soc) + 3
            _record(out, Finding('reference', files[0], number, column, 'column element: not in the subjects mapping'))
    expected = len(soc_of) * len(elements) * len(shapes.SCALES)
    if ext.count != expected:
        where = f'{ext.count} data rows, expected {expected}: one per profession, element and scale'
        _record(out, Finding('rows', files[0], 0, 0, where))
    return out


# JSON files.

_BAD = object()


def _load(data: bytes, file: str, out: list):
    try:
        return canon.load_json(data)
    except json.JSONDecodeError as err:
        _record(out, Finding('json-syntax', file, err.lineno, err.colno))
    except canon.CanonError as err:
        _record(out, Finding('json-syntax', file, 0, 0, str(err)))
    return _BAD


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _text(value, pattern: str, cap: int, file: str, out: list, where: str) -> bool:
    if not isinstance(value, str):
        _record(out, Finding('json-shape', file, 0, 0, f'{where}: not text'))
        return False
    if len(value) > cap:
        _record(out, Finding('field-length', file, 0, 0, f'{where}, at most {cap}'))
        return False
    if not _fullmatch(pattern, value):
        _record(out, Finding('field-shape', file, 0, 0, where))
        return False
    return True


def _keys(value, keys: tuple, file: str, out: list, where: str) -> bool:
    if not isinstance(value, dict) or tuple(sorted(value)) != tuple(sorted(keys)):
        _record(out, Finding('json-shape', file, 0, 0, f'{where}: an object with the keys {", ".join(sorted(keys))}'))
        return False
    return True


def _sources(value, keys: tuple, file: str, out: list, where: str) -> None:
    if not isinstance(value, list) or not 1 <= len(value) <= shapes.MAX_SOURCES:
        _record(out, Finding('json-shape', file, 0, 0, f'{where}: a list of 1 to {shapes.MAX_SOURCES} sources'))
        return
    seen = set()
    for entry in value:
        if not _keys(entry, keys, file, out, f'{where}[]'):
            continue
        if _text(entry['id'], shapes.SOURCE_ID, shapes.SOURCE_ID_MAX, file, out, f'{where}[].id'):
            if entry['id'] in seen:
                _record(out, Finding('duplicate-key', file, 0, 0, f'{where}[].id'))
            seen.add(entry['id'])
        _text(entry['sha256'], shapes.SHA256, 64, file, out, f'{where}[].sha256')
        _text(entry['version'], shapes.VERSION, shapes.VERSION_MAX, file, out, f'{where}[].version')
        if 'licence' in keys:
            _text(entry['licence'], shapes.LICENCE, shapes.LICENCE_MAX, file, out, f'{where}[].licence')
        if 'size' in keys:
            if not _is_int(entry['size']):
                _record(out, Finding('json-shape', file, 0, 0, f'{where}[].size: not an integer'))
            elif not 0 <= entry['size'] <= shapes.MAX_SOURCE_SIZE:
                _record(out, Finding('range', file, 0, 0, f'{where}[].size, 0 to {shapes.MAX_SOURCE_SIZE}'))


EMITTED_KEYS = ('format', 'inputs', 'professions')
INPUT_KEYS = ('id', 'sha256', 'version')
LOCK_KEYS = ('format', 'sources')
SOURCE_KEYS = ('id', 'licence', 'sha256', 'size', 'version')


def _format(value, file: str, out: list) -> None:
    if not _is_int(value['format']) or value['format'] != shapes.FORMAT:
        _record(out, Finding('json-shape', file, 0, 0, f'format: {shapes.FORMAT}'))


def _emitted_shape(value, file: str, out: list) -> None:
    if not _keys(value, EMITTED_KEYS, file, out, 'top level'):
        return
    _format(value, file, out)
    _sources(value['inputs'], INPUT_KEYS, file, out, 'inputs')
    professions = value['professions']
    if not isinstance(professions, dict):
        _record(out, Finding('json-shape', file, 0, 0, 'professions: an object'))
        return
    if len(professions) > shapes.EMITTED_MAX_PROFESSIONS:
        _record(out, Finding('row-cap', file, 0, 0, f'professions: at most {shapes.EMITTED_MAX_PROFESSIONS}'))
        return
    for profession, weights in professions.items():
        if not _text(profession, shapes.PROFESSION_ID, 40, file, out, 'professions: key'):
            continue
        if not isinstance(weights, dict):
            _record(out, Finding('json-shape', file, 0, 0, 'professions: a value is not an object'))
            continue
        for subject, cell in weights.items():
            if subject not in shapes.SUBJECT_IDS:
                _record(out, Finding('field-shape', file, 0, 0, 'professions: a subject key'))
                continue
            if not _keys(cell, tuple(sorted(shapes.WEIGHT_NAMES.values())), file, out, 'professions: a subject'):
                continue
            for scale, name in sorted(shapes.WEIGHT_NAMES.items()):
                number = cell[name]
                if not _is_int(number):
                    _record(out, Finding('json-shape', file, 0, 0, f'professions: {name}: not an integer'))
                    continue
                low, high = shapes.SCALE_RANGES[scale]
                if not low <= number <= high:
                    _record(out, Finding('range', file, 0, 0, f'professions: {name}, {low} to {high}'))


def check_emitted(data: bytes, file: str = 'emitted') -> list:
    """The emitted JSON file: text rules, strict JSON, its shape, canonical form."""
    out: list = []
    if not _check_text(data, shapes.EMITTED_MAX_BYTES, file, out):
        return out
    value = _load(data, file, out)
    if value is _BAD:
        return out
    _emitted_shape(value, file, out)
    try:
        canonical = canon.json_bytes(value)
    except canon.CanonError as err:
        _record(out, Finding('canonical', file, 0, 0, str(err)))
        return out
    if canonical != data:
        have, want = data.split(b'\n'), canonical.split(b'\n')
        line = next((i for i, (a, b) in enumerate(zip(have, want), start=1) if a != b), min(len(have), len(want)))
        _record(out, Finding('canonical', file, line, 1, 'differs from the canonical form from this line on'))
    return out


def check_lock(data: bytes, file: str = 'lock') -> list:
    """The lock: text rules except `forbidden`, strict JSON, its shape."""
    out: list = []
    if not _check_text(data, shapes.LOCK_MAX_BYTES, file, out, forbidden=False):
        return out
    value = _load(data, file, out)
    if value is _BAD:
        return out
    if _keys(value, LOCK_KEYS, file, out, 'top level'):
        _format(value, file, out)
        _sources(value['sources'], SOURCE_KEYS, file, out, 'sources')
    return out
