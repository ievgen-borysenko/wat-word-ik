"""The canonical writer and the strict JSON reader.

Everything the collector writes is a function of its inputs alone: the same
inputs give the same bytes on every machine and every run.

  - Tables: one header line, then the rows sorted, fields joined by a tab,
    every line ended by LF, the file by a final LF. Fields are printable
    ASCII, never empty, without tab or LF.
  - JSON: keys sorted, two spaces of indent, ASCII only (anything else as an
    escape), integers only (no fractions, no NaN or infinity), a final LF.
  - No timestamps, no paths, no host names: nothing about where or when it ran.

The reader is as strict as the writer: a duplicate key, a number with a
fraction or exponent, NaN or infinity, or an integer of more than
MAX_INT_DIGITS digits is refused.
"""

import json

MAX_INT_DIGITS = 12


class CanonError(ValueError):
    """The value cannot be written canonically, or the JSON is not strict.
    The message never quotes the data."""


def _printable(field: str) -> bool:
    return field != '' and all(0x20 <= ord(ch) <= 0x7E for ch in field)


def tsv_bytes(header: tuple[str, ...], rows) -> bytes:
    """A table in canonical form: the header, then the rows sorted."""
    width = len(header)
    lines = []
    for row in rows:
        row = tuple(row)
        if len(row) != width:
            raise CanonError(f'a row has {len(row)} fields, the header {width}')
        lines.append(row)
    for field in header + tuple(f for row in lines for f in row):
        if not isinstance(field, str) or not _printable(field):
            raise CanonError('a field is empty, not text, or not printable ASCII without tab and line feed')
    lines.sort()
    for before, after in zip(lines, lines[1:]):
        if before == after:
            raise CanonError('two rows are the same')
    text = ''.join('\t'.join(row) + '\n' for row in [header, *lines])
    return text.encode('ascii')


def _check_value(value, depth: int = 0) -> None:
    if depth > 32:
        raise CanonError('the value is nested too deeply')
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return
    if isinstance(value, int):
        if abs(value) >= 10**MAX_INT_DIGITS:
            raise CanonError('an integer has too many digits')
        return
    if isinstance(value, float):
        raise CanonError('a number is not an integer')
    if isinstance(value, list):
        for item in value:
            _check_value(item, depth + 1)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise CanonError('an object key is not text')
            _check_value(item, depth + 1)
        return
    raise CanonError(f'a value of type {type(value).__name__} has no JSON form')


def json_bytes(value) -> bytes:
    """A JSON value in canonical form."""
    _check_value(value)
    text = json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2, separators=(',', ': '), allow_nan=False)
    return (text + '\n').encode('ascii')


def _refuse_float(_text: str):
    raise CanonError('a number has a fraction or an exponent')


def _refuse_constant(_text: str):
    raise CanonError('NaN or infinity')


def _int(text: str) -> int:
    if len(text.lstrip('-')) > MAX_INT_DIGITS:
        raise CanonError('an integer has too many digits')
    return int(text)


def _object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise CanonError('an object has the same key twice')
        out[key] = value
    return out


def load_json(data: bytes):
    """Strict JSON from ASCII bytes. Raises CanonError, or json.JSONDecodeError
    with the line and column of a syntax error."""
    try:
        text = data.decode('ascii')
    except UnicodeDecodeError:
        raise CanonError('the file is not ASCII') from None
    try:
        return json.loads(
            text,
            object_pairs_hook=_object,
            parse_float=_refuse_float,
            parse_int=_int,
            parse_constant=_refuse_constant,
        )
    except RecursionError:
        raise CanonError('the value is nested too deeply') from None
