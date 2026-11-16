"""emit: the emitted JSON file as a pure function of tracked files.

Inputs: the extract, the professions mapping, the subjects mapping and the
lock (all bytes), and the id of the lock's source that the extract comes from.
Output: the bytes of the emitted file. Nothing else is read: no clock, no
environment, no network, no file the caller did not pass. The same inputs give
the same bytes, whatever the order of their rows and whatever the hash seed.

The gate checks every input before, and the output after; emit refuses when
it finds anything (Refused carries the findings).

The emitted file:

  {
    "format": 1,
    "inputs": [{"id": ..., "sha256": ..., "version": ...}],
    "professions": {
      "<profession>": {"<subject>": {"importance": 100..500, "level": 0..700}}
    }
  }

`inputs` names the source and the sha256 of the raw file that the lock pins.
Every profession of the professions mapping has an entry. A subject appears
under a profession when at least one knowledge element maps to it; its
importance and level are the highest of those elements' values (hundredths).
Elements mapped to no subject count for nothing. This rule is the skeleton's;
the site does not read the file yet.
"""

import canon
import gate
import shapes


class Refused(Exception):
    def __init__(self, findings: list):
        super().__init__(f'{len(findings)} finding(s)')
        self.findings = findings


DEFAULT_FILES = {
    'extract': 'extract',
    'professions': 'professions',
    'subjects': 'subjects',
    'lock': 'lock',
    'out': 'emitted',
}


def _rows(data: bytes) -> list:
    """The data rows of a table that the gate has passed."""
    return [tuple(line.split('\t')) for line in data.decode('ascii')[:-1].split('\n')[1:]]


def emit(extract: bytes, professions: bytes, subjects: bytes, lock: bytes, source: str, files: dict | None = None) -> bytes:
    names = dict(DEFAULT_FILES, **(files or {}))
    findings = gate.check_set(extract, professions, subjects, (names['extract'], names['professions'], names['subjects']))
    findings += gate.check_lock(lock, names['lock'])
    if findings:
        raise Refused(findings)
    entry = next((s for s in canon.load_json(lock)['sources'] if s['id'] == source), None)
    if entry is None:
        raise Refused([gate.Finding('reference', names['lock'], 0, 0, 'the source of the extract is not in the lock')])

    subject_of = {element: subject for element, _title, subject in _rows(subjects) if subject != shapes.NOT_MAPPED}
    weights: dict = {profession: {} for profession, _soc, _title in _rows(professions)}
    for profession, _soc, element, scale, value in _rows(extract):
        subject = subject_of.get(element)
        if subject is None:
            continue
        cell = weights[profession].setdefault(subject, {})
        name = shapes.WEIGHT_NAMES[scale]
        cell[name] = max(cell.get(name, 0), int(value))

    document = {
        'format': shapes.FORMAT,
        'inputs': [{'id': entry['id'], 'sha256': entry['sha256'], 'version': entry['version']}],
        'professions': weights,
    }
    data = canon.json_bytes(document)
    findings = gate.check_emitted(data, names['out'])
    if findings:
        raise Refused(findings)
    return data
