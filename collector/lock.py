"""The lock as the fetch stage reads it: which sources may be fetched, from
where, and the size and sha256 each must have.

A lock is JSON, written by a person and reviewed: {"format": 1, "sources":
[...]}. Every source has the five keys of the gate's lock shape (gate.py,
check_lock: id, version, licence, sha256, size) and these, which only the
fetch stage reads:

  kind   https: the stage downloads the file from `url`;
         manual: a person puts the file into the quarantine folder by hand,
         and the stage only checks its size and sha256
  file   the name the file gets in the quarantine folder (letters, digits,
         full stops, hyphens and underscores; it starts with a letter or digit)
  url    (https only) where the file is: https, a host name, a path and an
         optional query; no port, no user name, no fragment
  type   (https only) the media type the server must give for it, such as
         application/zip; never an HTML type

The five shared keys are checked by the gate itself, on a copy of the lock
that holds only them. The rest is checked here. Errors never quote the lock.
This module opens no connection and starts no process.
"""

import re
from dataclasses import dataclass

import canon
import gate
import shapes

KINDS = ('https', 'manual')
# The keys of a source, by kind; GATE_KEYS are those of the gate's lock shape.
GATE_KEYS = gate.SOURCE_KEYS
KEYS = {
    'https': tuple(sorted(GATE_KEYS + ('kind', 'file', 'url', 'type'))),
    'manual': tuple(sorted(GATE_KEYS + ('kind', 'file'))),
}

FILE = r'[A-Za-z0-9][A-Za-z0-9._-]*'
FILE_MAX = 100
# A host name: labels of lower-case letters, digits and inner hyphens, joined
# by full stops. No port and no user name can follow it in a URL here.
HOST = r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*'
HOST_MAX = 253
# A path and an optional query, in the characters a plain address needs.
TARGET = r'/[A-Za-z0-9._~%/-]*(?:\?[A-Za-z0-9._~%=&+-]*)?'
URL = r'https://(' + HOST + ')(' + TARGET + ')?'
URL_MAX = 500
TYPE = r'[a-z]+/[a-z0-9][a-z0-9.+-]*'
TYPE_MAX = 80
# Media types of web pages: a data file is never one of them.
HTML_TYPES = ('text/html', 'application/xhtml+xml')

_PRINTABLE = frozenset([0x0A, *range(0x20, 0x7F)])


class LockError(ValueError):
    """The lock cannot be used. The message never quotes the lock."""


@dataclass(frozen=True)
class Source:
    id: str
    version: str
    licence: str
    sha256: str
    size: int
    kind: str
    file: str
    # https only; empty for a manual source.
    url: str = ''
    host: str = ''
    # The path and query of the URL ('/' when the URL has none).
    target: str = ''
    type: str = ''


def split_url(url: str):
    """(host, target) of a URL in the lock's grammar, or None."""
    if len(url) > URL_MAX:
        return None
    match = re.fullmatch(URL, url, re.ASCII)
    if match is None or len(match.group(1)) > HOST_MAX:
        return None
    return match.group(1), match.group(2) or '/'


def _text(entry: dict, key: str, pattern: str, cap: int, where: str) -> str:
    value = entry[key]
    if not isinstance(value, str) or len(value) > cap or not re.fullmatch(pattern, value, re.ASCII):
        raise LockError(f'{where}.{key}: not in its shape (at most {cap} characters)')
    return value


def read(data: bytes) -> list:
    """Every source of a lock, checked; raises LockError."""
    if len(data) > shapes.LOCK_MAX_BYTES:
        raise LockError(f'the lock is larger than {shapes.LOCK_MAX_BYTES} bytes')
    if not data.endswith(b'\n') or not set(data) <= _PRINTABLE:
        raise LockError('the lock must be printable ASCII in lines that each end with a line feed')
    try:
        value = canon.load_json(data)
    except canon.CanonError as err:
        raise LockError(f'the lock is not strict JSON: {err}') from None
    except ValueError as err:
        line, column = getattr(err, 'lineno', 0), getattr(err, 'colno', 0)
        raise LockError(f'the lock is not strict JSON (line {line}, column {column})') from None
    if not isinstance(value, dict) or sorted(value) != sorted(gate.LOCK_KEYS) or not isinstance(value['sources'], list):
        raise LockError('the lock must be an object with the keys format and sources, a list')
    entries = value['sources']
    if not all(isinstance(entry, dict) for entry in entries):
        raise LockError('every source of the lock must be an object')
    # The gate checks the keys it knows, with its own rules, on a copy that holds only them.
    shared = {'format': value['format'], 'sources': [{k: e[k] for k in GATE_KEYS if k in e} for e in entries]}
    try:
        findings = gate.check_lock(canon.json_bytes(shared), 'lock')
    except canon.CanonError as err:
        raise LockError(f'the lock holds a value that has no canonical form: {err}') from None
    if findings:
        shown = '; '.join(str(f) for f in findings[:5])
        raise LockError(f'the gate refuses the lock ({len(findings)} finding(s)): {shown}')
    sources = []
    for number, entry in enumerate(entries, start=1):
        where = f'sources[{number}]'
        kind = entry.get('kind')
        if kind not in KINDS:
            raise LockError(f'{where}.kind: one of {", ".join(KINDS)}')
        if tuple(sorted(entry)) != KEYS[kind]:
            raise LockError(f'{where}: a {kind} source has exactly the keys {", ".join(KEYS[kind])}')
        fields = {k: entry[k] for k in GATE_KEYS}
        fields['kind'] = kind
        fields['file'] = _text(entry, 'file', FILE, FILE_MAX, where)
        if kind == 'https':
            url = entry['url']
            parts = split_url(url) if isinstance(url, str) else None
            if parts is None:
                raise LockError(f'{where}.url: not an https address in the lock grammar (a host name, a path, no port)')
            media = _text(entry, 'type', TYPE, TYPE_MAX, where)
            if media in HTML_TYPES:
                raise LockError(f'{where}.type: a web page type; the stage fetches data files only')
            fields.update(url=url, host=parts[0], target=parts[1], type=media)
        sources.append(Source(**fields))
    return sources


def find(sources: list, source_id: str) -> Source:
    """The source with this id; raises LockError."""
    if not isinstance(source_id, str) or not re.fullmatch(shapes.SOURCE_ID, source_id, re.ASCII) or len(source_id) > shapes.SOURCE_ID_MAX:
        raise LockError('the source id is not in its shape (lower-case letters and digits, joined by hyphens)')
    for source in sources:
        if source.id == source_id:
            return source
    raise LockError(f'the lock has no source {source_id}')


def hosts(sources: list) -> frozenset:
    """The hosts the lock names: those of its https sources."""
    return frozenset(source.host for source in sources if source.kind == 'https')
