"""The collector's command line.

Run it with the standard library only, without Python's own environment
variables (-I), site-packages (-S) or bytecode files (-B):

  python3.14 -I -S -B collector/run.py selftest
  python3.14 -I -S -B collector/run.py gate --set fixture
  python3.14 -I -S -B collector/run.py emit --set fixture --check
  python3.14 -I -S -B collector/run.py emit --set fixture

selftest  runs the gate on its planted samples (selftest.py).
gate      checks the extract, the two mappings, the lock and the emitted file.
emit      writes the emitted file from the extract, the mappings and the lock
          (emit.py); with --check it writes nothing and compares the file on
          disk with what its inputs give, byte for byte.

A named set (--set) gives every path, relative to the repository; instead,
each path can be given with its own option (--extract and so on). gate and
emit run the self-test first, and refuse everything when it fails. Two sets:
`fixture`, the synthetic fixture, and `site`, the file the site will read
(src/data/sourced.json). The site's set has no inputs until the first source
is collected: emit gives it the empty file (emit.empty), and gate checks the
emitted file alone.

Exit codes: 0 passed; 1 the gate refused a file, or the emitted file differs
from its inputs; 2 usage error or a file could not be read or written; 3 the
self-test failed.

This stage reads only tracked files and opens no network connection.
"""

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
# After the standard library, so that no file here can stand in for one of its
# modules (`-I` keeps the script's folder off the path).
if HERE not in sys.path:
    sys.path.append(HERE)

import emit  # noqa: E402
import gate  # noqa: E402
import selftest  # noqa: E402
import shapes  # noqa: E402

PASSED, REFUSED, USAGE, SELFTEST_FAILED = 0, 1, 2, 3

# Named sets of paths, relative to the repository.
SETS = {
    'fixture': {
        'extract': 'collector/fixtures/synthetic/extract.tsv',
        'professions': 'collector/fixtures/synthetic/professions.tsv',
        'subjects': 'collector/fixtures/synthetic/subjects.tsv',
        'lock': 'collector/fixtures/synthetic/lock.json',
        'source': 'synthetic',
        'out': 'collector/fixtures/synthetic/expected.json',
    },
    # No source has been collected yet: no inputs, so emit gives the empty file.
    'site': {
        'out': 'src/data/sourced.json',
    },
}

# The files emit reads. A named set has all of them and a source, or none.
INPUTS = ('extract', 'professions', 'subjects', 'lock')

# The most bytes read of each file: one more than its cap, so the gate sees an
# oversize file as such without reading all of it.
CAPS = {
    'extract': shapes.EXTRACT.max_bytes,
    'professions': shapes.PROFESSIONS.max_bytes,
    'subjects': shapes.SUBJECTS.max_bytes,
    'lock': shapes.LOCK_MAX_BYTES,
    'out': shapes.EMITTED_MAX_BYTES,
}

# Findings listed per rule and file; the rest are counted.
SHOWN = 20


class Failed(Exception):
    """A file could not be read or written (exit 2)."""


def _paths(args) -> dict:
    """role -> (path on disk, label in the report); the input roles only when the set has inputs."""
    roles = (*INPUTS, 'out')
    if args.set is not None:
        given = [role for role in roles if getattr(args, role) is not None] + (['source'] if args.source else [])
        if given:
            raise Failed(f'--set gives every path; do not also pass --{given[0]}')
        named = SETS[args.set]
        paths = {role: (os.path.join(REPO, *named[role].split('/')), named[role]) for role in roles if role in named}
        return dict(paths, source=named.get('source'))
    missing = [role for role in roles if getattr(args, role) is None]
    if missing:
        raise Failed(f'pass --set, or every one of --extract, --professions, --subjects, --lock, --out (missing: --{missing[0]})')
    paths = {role: (getattr(args, role), getattr(args, role)) for role in roles}
    return dict(paths, source=args.source)


def _read(path: str, label: str, cap: int) -> bytes:
    try:
        with open(path, 'rb') as handle:
            return handle.read(cap + 1)
    except OSError as err:
        raise Failed(f'cannot read {label}: {err.strerror}') from None


def _write(path: str, label: str, data: bytes) -> None:
    temporary = f'{path}.tmp-{os.getpid()}'
    try:
        with open(temporary, 'xb') as handle:
            handle.write(data)
        os.replace(temporary, path)
    except OSError as err:
        raise Failed(f'cannot write {label}: {err.strerror}') from None
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def _report(command: str, findings: list) -> None:
    print(f'{command}: refused, {len(findings)} finding(s): rule file:line:column (where)', file=sys.stderr)
    shown: dict = {}
    for finding in findings:
        key = (finding.file, finding.rule)
        shown[key] = shown.get(key, 0) + 1
        if shown[key] <= SHOWN:
            print(f'  {finding}', file=sys.stderr)
    for (file, rule), count in shown.items():
        if count > SHOWN:
            print(f'  ... and {count - SHOWN} more {rule} finding(s) in {file}', file=sys.stderr)


def _selftest_passes(command: str) -> bool:
    count, failures = selftest.run()
    if not failures:
        if command == 'selftest':
            print(f'selftest: {count} planted samples, each refused by its rule in its file; the clean sample passes')
        return True
    print(f'{command}: the self-test failed, so the gate refuses everything:', file=sys.stderr)
    for failure in failures:
        print(f'  {failure}', file=sys.stderr)
    return False


def _gate(paths: dict) -> int:
    roles = [role for role in CAPS if role in paths]
    read = {role: _read(*paths[role], CAPS[role]) for role in roles}
    labels = {role: paths[role][1] for role in roles}
    findings = []
    if 'extract' in read:
        findings += gate.check_set(read['extract'], read['professions'], read['subjects'], (labels['extract'], labels['professions'], labels['subjects']))
        findings += gate.check_lock(read['lock'], labels['lock'])
    findings += gate.check_emitted(read['out'], labels['out'])
    if findings:
        _report('gate', findings)
        return REFUSED
    print(f'gate: {len(read)} files pass every rule' if len(read) != 1 else 'gate: 1 file passes every rule')
    return PASSED


def _emit(paths: dict, check: bool) -> int:
    labels = {role: paths[role][1] for role in CAPS if role in paths}
    try:
        if 'extract' in paths:
            inputs = {role: _read(*paths[role], CAPS[role]) for role in INPUTS}
            data = emit.emit(inputs['extract'], inputs['professions'], inputs['subjects'], inputs['lock'], paths['source'], labels)
        else:
            data = emit.empty(labels['out'])
    except emit.Refused as refused:
        _report('emit', refused.findings)
        return REFUSED
    path, label = paths['out']
    if check:
        if not os.path.exists(path):
            print(f'emit --check: {label} does not exist; run emit to write it', file=sys.stderr)
            return REFUSED
        current = _read(path, label, CAPS['out'])
        if current == data:
            print(f'emit --check: {label} is what its inputs give ({len(data)} bytes)')
            return PASSED
        have, want = current.split(b'\n'), data.split(b'\n')
        line = next((i for i, (a, b) in enumerate(zip(have, want), start=1) if a != b), min(len(have), len(want)))
        print(f'emit --check: {label} differs from what its inputs give, from line {line} on; run emit to write it', file=sys.stderr)
        return REFUSED
    print(f'emit: writing {label}')
    _write(path, label, data)
    print(f'emit: wrote {label} ({len(data)} bytes)')
    return PASSED


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='run.py', description='The collector: gate, emit and the self-test.')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('selftest', help='run the gate on its planted samples')
    for name in ('gate', 'emit'):
        command = commands.add_parser(name)
        command.add_argument('--set', choices=sorted(SETS))
        command.add_argument('--extract')
        command.add_argument('--professions')
        command.add_argument('--subjects')
        command.add_argument('--lock')
        command.add_argument('--out', help='the emitted file')
        command.add_argument('--source', help="the lock's id of the extract's source")
        if name == 'emit':
            command.add_argument('--check', action='store_true', help='compare instead of writing')
    return parser


def main(argv: list) -> int:
    try:
        args = _parser().parse_args(argv)
    except SystemExit as stop:
        return stop.code if isinstance(stop.code, int) else USAGE
    if not _selftest_passes(args.command):
        return SELFTEST_FAILED
    if args.command == 'selftest':
        return PASSED
    try:
        paths = _paths(args)
        if args.command == 'gate':
            return _gate(paths)
        if 'extract' in paths and paths['source'] is None:
            raise Failed('pass --source with the explicit paths')
        return _emit(paths, args.check)
    except Failed as err:
        print(f'{args.command}: {err}', file=sys.stderr)
        return USAGE


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
