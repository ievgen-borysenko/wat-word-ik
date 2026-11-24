"""The collector's files: what they import, what they hold, how its tests run."""

import _io
import ast
import importlib
import io
import os
import re
import shutil
import stat
import sys
import unittest

import gate
import selftest
import shapes
import tests
from tests import COLLECTOR, REPO, GuardedCase, WriteRefused

MODULES = sorted(p for p in COLLECTOR.glob('*.py'))
# The kinds of file the tree check lets into collector/ (scripts/check-tree.mjs).
TRACKED = sorted(
    p for p in COLLECTOR.rglob('*') if p.is_file() and '__pycache__' not in p.parts and (p.suffix in ('.py', '.tsv', '.json', '.sb') or p.name == '.python-version')
)
TEST_MODULES = sorted(p for p in (COLLECTOR / 'tests').glob('*.py'))
OWN = {p.stem for p in MODULES}

# What every module of the collector may import: the standard library modules
# it needs, none of which opens a connection or starts a process.
ALLOWED_IMPORTS = {'argparse', 'dataclasses', 'json', 'os', 're', 'sys'}
# And what a module needs on top, by name: the fetch stage its network and
# hashes, the probe what it tries and reports, the launcher what it takes to
# start a child and read the interpreter's files. No other module may import
# more.
EXTRA_IMPORTS = {
    'fetch.py': {'errno', 'hashlib', 'http', 'socket', 'ssl'},
    'probe.py': {'errno', 'resource', 'socket', 'ssl'},
    'sandboxed.py': {'contextlib', 'resource', 'selectors', 'struct', 'subprocess', 'sysconfig', 'tempfile', 'time'},
}
# Modules that open connections or reach the system around the sandbox's rules.
NETWORK = {'socket', 'ssl', 'http', 'urllib', 'ftplib', 'smtplib', 'poplib', 'imaplib', 'xmlrpc', 'asyncio', 'webbrowser', 'socketserver', 'ctypes'}
# The only files of the collector that may import them: the fetch stage, the
# probe that must try a connection, and the test that starts the loopback
# server the fetch stage is tested against. ctypes stays forbidden in all.
NETWORK_ALLOWED = {'fetch.py': {'http', 'socket', 'ssl'}, 'probe.py': {'socket', 'ssl'}, 'tests/test_fetch.py': {'http', 'ssl'}}


def network_violations(name: str, source: str) -> set:
    """The network modules a file imports that the rule does not allow it."""
    return imports_in(source) & NETWORK - NETWORK_ALLOWED.get(name, set())


def imports(path) -> set:
    return imports_in(path.read_text(encoding='ascii'))


def imports_in(source: str) -> set:
    found = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            found.update(alias.name.split('.')[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            found.add('.' if node.level else (node.module or '').split('.')[0])
        elif isinstance(node, ast.Call) and getattr(node.func, 'id', getattr(node.func, 'attr', None)) in ('__import__', 'import_module'):
            found.add('<dynamic import>')
    return found


class Layout(GuardedCase):
    def test_the_modules_import_only_the_standard_library_they_need(self):
        names = ['canon.py', 'emit.py', 'fetch.py', 'gate.py', 'lock.py', 'probe.py', 'run.py', 'sandboxed.py', 'selftest.py', 'shapes.py']
        self.assertEqual([p.name for p in MODULES], names)
        for path in MODULES:
            with self.subTest(path.name):
                self.assertLessEqual(imports(path), ALLOWED_IMPORTS | EXTRA_IMPORTS.get(path.name, set()) | OWN)

    def test_only_the_fetch_stage_the_probe_and_the_fetch_test_import_network_modules(self):
        for path in MODULES + TEST_MODULES:
            name = str(path.relative_to(COLLECTOR))
            with self.subTest(name):
                self.assertEqual(network_violations(name, path.read_text(encoding='ascii')), set())
                # Each exception is used, and only as far as it goes.
                self.assertEqual(imports(path) & NETWORK, NETWORK_ALLOWED.get(name, set()))

    def test_the_network_rule_refuses_a_network_import_in_every_other_file(self):
        planted = ['import socket', 'from http import client', 'import urllib.request', 'import ssl as tls', 'from asyncio import open_connection',
                   'import ctypes', 'def f():\n    import socketserver\n']  # fmt: skip
        others = [str(p.relative_to(COLLECTOR)) for p in MODULES + TEST_MODULES if str(p.relative_to(COLLECTOR)) not in NETWORK_ALLOWED]
        self.assertIn('gate.py', others)
        self.assertIn('tests/test_gate.py', others)
        for name in others:
            for source in planted:
                with self.subTest(file=name, source=source):
                    self.assertNotEqual(network_violations(name, source), set())
        # In the files the rule allows, only their own modules pass; ctypes never does.
        self.assertEqual(network_violations('fetch.py', 'import ssl\nimport http.client\nimport socket\n'), set())
        self.assertEqual(network_violations('probe.py', 'import socket\nimport ssl\n'), set())
        self.assertEqual(network_violations('probe.py', 'import urllib.request\n'), {'urllib'})
        for name in NETWORK_ALLOWED:
            self.assertEqual(network_violations(name, 'import ctypes\n'), {'ctypes'})

    def test_only_the_launcher_starts_processes(self):
        for path in MODULES:
            with self.subTest(path.name):
                self.assertEqual('subprocess' in imports(path), path.name == 'sandboxed.py')

    def test_no_module_here_shares_a_name_with_the_standard_library(self):
        for name in OWN | {'tests'}:
            with self.subTest(name):
                self.assertNotIn(name, sys.stdlib_module_names)

    def test_the_subjects_are_the_sites_subjects_in_the_same_order(self):
        types = (REPO / 'src' / 'engine' / 'types.ts').read_text(encoding='utf-8')
        block = re.search(r'export const SUBJECT_IDS = \[(.*?)\] as const;', types, re.S)
        self.assertIsNotNone(block)
        self.assertEqual(tuple(re.findall(r"'([a-z]+)'", block.group(1))), shapes.SUBJECT_IDS)

    def test_the_tests_run_on_the_python_version_of_the_collector(self):
        pinned = (COLLECTOR / '.python-version').read_text(encoding='ascii')
        self.assertRegex(pinned, r'^3\.[0-9]+\n$')
        self.assertEqual(f'{sys.version_info.major}.{sys.version_info.minor}', pinned.strip())

    def test_every_file_is_ascii_text_without_the_executable_bit(self):
        self.assertIn(COLLECTOR / '.python-version', TRACKED)
        for path in TRACKED:
            with self.subTest(str(path.relative_to(COLLECTOR))):
                data = path.read_bytes()
                allowed = set(range(0x20, 0x7F)) | {0x0A} | ({0x09} if path.suffix == '.tsv' else set())
                self.assertTrue(set(data) <= allowed, 'printable ASCII and line feeds only (tabs in .tsv)')
                self.assertTrue(data.endswith(b'\n'))
                self.assertEqual(os.stat(path).st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH), 0)

    def test_no_file_holds_a_planted_text(self):
        """The samples are put together at run time, never stored as text."""
        planted = [
            selftest._url(),
            selftest._address(),
            selftest.HOST,
            selftest.LESS + 'b' + selftest.GREATER,
            selftest._phrase(('ign', 'ore'), ('all',), ('pre', 'vious'), ('instruc', 'tions')).lower(),
        ]
        files = TRACKED + [REPO / 'docs' / 'collector.md']
        for path in files:
            text = path.read_text(encoding='utf-8').lower()
            with self.subTest(str(path.relative_to(REPO))):
                for sample in planted:
                    self.assertNotIn(sample.lower(), text)
                self.assertFalse(gate.has_phrase(text), 'the text trips the phrase list')

    def test_every_test_case_is_guarded(self):
        cases = []
        for path in TEST_MODULES:
            if path.stem == '__init__':
                continue
            module = importlib.import_module(f'tests.{path.stem}')
            cases += [v for v in vars(module).values() if isinstance(v, type) and issubclass(v, unittest.TestCase) and v.__module__ == module.__name__]
        self.assertGreater(len(cases), 5)
        for case in cases:
            with self.subTest(case.__name__):
                self.assertTrue(issubclass(case, tests.GuardedCase))


class Guard(GuardedCase):
    # Every way to write that the guard names (tests/__init__.py). The targets
    # sit in folders that do not exist, so a guard that let one through would
    # fail on the missing folder instead of writing anything, with one
    # exception: os.makedirs would create the missing folders (and dist/ and
    # node_modules/ themselves where they do not exist). The test then fails,
    # on that way and on the check after the loop, but the empty folders stay
    # behind and must be removed by hand.
    WAYS = [
        ('open, write', lambda t: open(t, 'w')),
        ('open, append', lambda t: open(t, 'ab')),
        ('io.open', lambda t: io.open(t, 'x')),
        ('_io.open', lambda t: _io.open(t, 'w')),
        ('io.FileIO', lambda t: io.FileIO(t, 'w')),
        ('_io.FileIO', lambda t: _io.FileIO(t, 'a')),
        ('io.FileIO, read and write', lambda t: io.FileIO(t, 'r+')),
        ('pathlib', lambda t: t.write_bytes(b'x')),
        ('shutil.copyfile', lambda t: shutil.copyfile(COLLECTOR / 'run.py', t)),
        ('os.open', lambda t: os.open(t, os.O_CREAT | os.O_WRONLY)),
        ('os.open, append', lambda t: os.open(t, os.O_APPEND)),
        ('os.mkdir', lambda t: os.mkdir(t)),
        ('os.makedirs', lambda t: os.makedirs(t)),
        ('os.rmdir', lambda t: os.rmdir(t)),
        ('os.remove', lambda t: os.remove(t)),
        ('os.unlink', lambda t: os.unlink(t)),
        ('os.truncate', lambda t: os.truncate(t, 0)),
        ('os.chmod', lambda t: os.chmod(t, 0o600)),
        ('os.chown', lambda t: os.chown(t, -1, -1)),
        ('os.utime', lambda t: os.utime(t)),
        ('os.mkfifo', lambda t: os.mkfifo(t)),
        ('os.mknod', lambda t: os.mknod(t)),
        ('os.rename', lambda t: os.rename(t, t.with_name('other'))),
        ('os.replace', lambda t: os.replace(t, t.with_name('other'))),
        ('os.link', lambda t: os.link(t, t.with_name('other'))),
        ('os.symlink', lambda t: os.symlink('other', t)),
    ] + [
        (f'os.{name}', way)
        for name, way in (
            ('chflags', lambda t: os.chflags(t, 0)),
            ('lchflags', lambda t: os.lchflags(t, 0)),
            ('lchmod', lambda t: os.lchmod(t, 0o600)),
            ('lchown', lambda t: os.lchown(t, -1, -1)),
        )
        if hasattr(os, name)
    ]

    def test_every_way_to_write_into_the_repository_fails_the_test(self):
        # dist/ and node_modules/ are ignored folders that the listing skips: only this guard covers them.
        targets = [REPO / folder / 'guard-probe-missing' / 'probe' for folder in ('collector', 'dist', 'node_modules')]
        for name, way in self.WAYS:
            for target in targets:
                with self.subTest(way=name, target=str(target.relative_to(REPO))), self.assertRaises(WriteRefused):
                    way(target)
        for target in targets:
            self.assertFalse(target.parent.exists())

    def test_the_replaced_file_object_still_reads_and_writes_where_allowed(self):
        folder = self.make_temp()
        with io.FileIO(folder / 'a.bin', 'w') as handle:
            handle.write(b'x')
        with _io.FileIO(folder / 'a.bin', 'r') as handle:
            self.assertEqual(handle.read(), b'x')
        with io.FileIO(COLLECTOR / 'run.py', 'r') as handle:
            self.assertTrue(handle.read(1))

    def test_a_write_outside_the_tests_own_folders_fails_too(self):
        other = self.make_temp().parent / 'collector-guard-probe'
        with self.assertRaises(WriteRefused):
            os.mkdir(other)
        self.assertFalse(other.exists())

    def test_the_listing_sees_a_new_or_changed_file(self):
        folder = self.make_temp()
        (folder / 'a.txt').write_text('x\n')
        before = tests.listing(folder)
        (folder / 'b.txt').write_text('y\n')
        self.assertEqual(set(tests.listing(folder)) - set(before), {'b.txt'})
        (folder / 'a.txt').write_text('longer\n')
        self.assertNotEqual(tests.listing(folder)['a.txt'], before['a.txt'])

    def test_a_write_into_its_own_folder_passes_and_reading_is_free(self):
        folder = self.make_temp()
        (folder / 'a.txt').write_text('x\n')
        os.replace(folder / 'a.txt', folder / 'b.txt')
        self.assertEqual((folder / 'b.txt').read_text(), 'x\n')
        self.assertTrue((COLLECTOR / 'run.py').read_bytes())
