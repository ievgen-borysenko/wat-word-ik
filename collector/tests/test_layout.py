"""The collector's files: what they import, what they hold, how its tests run."""

import ast
import importlib
import os
import re
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
TRACKED = sorted(p for p in COLLECTOR.rglob('*') if p.is_file() and '__pycache__' not in p.parts and (p.suffix in ('.py', '.tsv', '.json') or p.name == '.python-version'))
TEST_MODULES = sorted(p for p in (COLLECTOR / 'tests').glob('*.py'))
OWN = {p.stem for p in MODULES}

# What the collector's modules may import: the standard library modules they
# need, none of which opens a connection or starts a process.
ALLOWED_IMPORTS = {'argparse', 'dataclasses', 'json', 'os', 're', 'sys'}
# What no file of the collector, tests included, may import in this stage.
NETWORK = {'socket', 'ssl', 'http', 'urllib', 'ftplib', 'smtplib', 'poplib', 'imaplib', 'xmlrpc', 'asyncio', 'webbrowser', 'socketserver', 'ctypes'}


def imports(path) -> set:
    found = set()
    for node in ast.walk(ast.parse(path.read_text(encoding='ascii'))):
        if isinstance(node, ast.Import):
            found.update(alias.name.split('.')[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            found.add('.' if node.level else (node.module or '').split('.')[0])
        elif isinstance(node, ast.Call) and getattr(node.func, 'id', getattr(node.func, 'attr', None)) in ('__import__', 'import_module'):
            found.add('<dynamic import>')
    return found


class Layout(GuardedCase):
    def test_the_modules_import_only_the_standard_library_they_need(self):
        self.assertEqual([p.name for p in MODULES], ['canon.py', 'emit.py', 'gate.py', 'run.py', 'selftest.py', 'shapes.py'])
        for path in MODULES:
            with self.subTest(path.name):
                self.assertLessEqual(imports(path), ALLOWED_IMPORTS | OWN)

    def test_no_file_of_the_collector_imports_a_network_module(self):
        for path in MODULES + TEST_MODULES:
            with self.subTest(path.name):
                self.assertEqual(imports(path) & NETWORK, set())

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
    def test_a_write_into_the_repository_fails_the_test(self):
        target = COLLECTOR / 'guard-probe.txt'
        attempts = [
            lambda: open(target, 'w'),
            lambda: open(target, 'ab'),
            lambda: target.write_text('x'),
            lambda: os.open(target, os.O_CREAT | os.O_WRONLY),
            lambda: os.mkdir(COLLECTOR / 'guard-probe'),
            lambda: os.replace(COLLECTOR / 'run.py', COLLECTOR / 'guard-probe.txt'),
            lambda: os.remove(COLLECTOR / 'run.py'),
        ]
        for attempt in attempts:
            with self.assertRaises(WriteRefused):
                attempt()
        self.assertFalse(target.exists())
        self.assertTrue((COLLECTOR / 'run.py').exists())

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
