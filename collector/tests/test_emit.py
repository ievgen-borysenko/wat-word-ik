"""emit and the canonical writer: the same inputs give the same bytes.

The emitted file must not depend on the order of the input rows or on the
hash seed: emit runs here on shuffled copies of the fixture, in this process
and in child processes with different hash seeds, and every run must give the
tracked expected file byte for byte.
"""

import contextlib
import hashlib
import io
import json
import os
import random
import subprocess
import sys
from unittest import mock

import canon
import emit
import gate
import run
from tests import FIXTURE, REPO, RUN, GuardedCase

EXPECTED = FIXTURE / 'expected.json'
SITE = REPO / 'src' / 'data' / 'sourced.json'
TABLES = ('extract.tsv', 'professions.tsv', 'subjects.tsv')


def fixture(name: str) -> bytes:
    return (FIXTURE / name).read_bytes()


def shuffled(data: bytes, seed: int) -> bytes:
    """The table with its data rows in another order (the header stays first)."""
    lines = data.decode('ascii')[:-1].split('\n')
    rows = lines[1:]
    random.Random(seed).shuffle(rows)
    return '\n'.join([lines[0], *rows, '']).encode('ascii')


def emit_fixture(**replace) -> bytes:
    files = {name: replace.get(name, fixture(name)) for name in (*TABLES, 'lock.json')}
    return emit.emit(files['extract.tsv'], files['professions.tsv'], files['subjects.tsv'], files['lock.json'], 'synthetic')


def child(args: list, seed: str) -> subprocess.CompletedProcess:
    """run.py in a child process with only PYTHONHASHSEED in its environment.
    -I would ignore that variable, so the child gets -S -B -s -P instead: no
    site-packages, no bytecode files, no user folder, no script folder on the
    path; an environment with nothing else in it does the rest of -I."""
    return subprocess.run(
        [sys.executable, '-S', '-B', '-s', '-P', *args],
        env={'PYTHONHASHSEED': seed},
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


class Emit(GuardedCase):
    def test_the_fixture_gives_the_expected_file(self):
        self.assertEqual(emit_fixture(), EXPECTED.read_bytes())

    def test_a_weight_is_the_highest_value_of_the_elements_of_its_subject(self):
        professions = json.loads(EXPECTED.read_bytes())['professions']
        # fixture-alpha: two elements count for wiskunde, importance 412 and 288,
        # level 523 and 610; 2.C.93.a counts for no subject, so its 500 and 700 do not count.
        self.assertEqual(professions['fixture-alpha']['wiskunde'], {'importance': 412, 'level': 610})
        self.assertEqual(professions['fixture-alpha']['biologie'], {'importance': 100, 'level': 0})
        self.assertEqual(sorted(professions), ['fixture-alpha', 'fixture-beta', 'fixture-gamma'])
        self.assertTrue(all(sorted(weights) == ['biologie', 'wiskunde'] for weights in professions.values()))

    def test_the_source_and_its_hash_come_from_the_lock(self):
        inputs = json.loads(EXPECTED.read_bytes())['inputs']
        # The synthetic source has no raw file: size 0, the sha256 of zero bytes.
        self.assertEqual(inputs, [{'id': 'synthetic', 'sha256': hashlib.sha256(b'').hexdigest(), 'version': '1'}])

    def test_shuffled_rows_give_the_same_bytes(self):
        for seed in range(8):
            with self.subTest(seed=seed):
                replace = {name: shuffled(fixture(name), seed) for name in TABLES}
                self.assertNotEqual(replace['extract.tsv'], fixture('extract.tsv'))
                self.assertEqual(emit_fixture(**replace), EXPECTED.read_bytes())

    def test_two_hash_seeds_give_the_same_bytes_also_on_shuffled_rows(self):
        probe = [child(['-c', 'print(hash("wat-word-ik"))'], seed).stdout for seed in ('1', '2')]
        self.assertNotEqual(probe[0], probe[1], 'the two seeds must give different string hashes')
        folder = self.make_temp()
        for name in TABLES:
            (folder / name).write_bytes(shuffled(fixture(name), 99))
        explicit = [
            '--extract', str(folder / 'extract.tsv'),
            '--professions', str(folder / 'professions.tsv'),
            '--subjects', str(folder / 'subjects.tsv'),
            '--lock', str(FIXTURE / 'lock.json'),
            '--source', 'synthetic',
            '--out', str(EXPECTED),
        ]  # fmt: skip
        for seed in ('1', '2'):
            for args in (['--set', 'fixture'], explicit):
                with self.subTest(seed=seed, args=args[:2]):
                    result = child([str(RUN), 'emit', '--check', *args], seed)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn('is what its inputs give', result.stdout)

    def test_the_check_fails_when_one_byte_of_the_emitted_file_changes(self):
        folder = self.make_temp()
        out = folder / 'expected.json'
        out.write_bytes(EXPECTED.read_bytes().replace(b'"importance": 412', b'"importance": 413', 1))
        args = ['emit', '--check', '--extract', str(FIXTURE / 'extract.tsv'), '--professions', str(FIXTURE / 'professions.tsv'),
                '--subjects', str(FIXTURE / 'subjects.tsv'), '--lock', str(FIXTURE / 'lock.json'), '--source', 'synthetic', '--out', str(out)]  # fmt: skip
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            self.assertEqual(run.main(args), 1)
        self.assertIn('differs from what its inputs give, from line 17 on', err.getvalue())
        out.unlink()
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            self.assertEqual(run.main(args), 1)
        self.assertIn('does not exist', err.getvalue())

    def test_emit_writes_its_file_and_nothing_else(self):
        folder = self.make_temp()
        out = folder / 'emitted.json'
        args = ['emit', '--extract', str(FIXTURE / 'extract.tsv'), '--professions', str(FIXTURE / 'professions.tsv'),
                '--subjects', str(FIXTURE / 'subjects.tsv'), '--lock', str(FIXTURE / 'lock.json'), '--source', 'synthetic', '--out', str(out)]  # fmt: skip
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            self.assertEqual(run.main(args), 0)
        self.assertEqual(os.listdir(folder), ['emitted.json'])
        self.assertEqual(out.read_bytes(), EXPECTED.read_bytes())
        self.assertIn(f'emit: writing {out}', stdout.getvalue())

    def test_emit_refuses_a_poisoned_input_and_writes_nothing(self):
        folder = self.make_temp()
        extract = folder / 'extract.tsv'
        extract.write_bytes(fixture('extract.tsv').replace(b'\t412\n', b'\t4120\n', 1))
        out = folder / 'emitted.json'
        args = ['emit', '--extract', str(extract), '--professions', str(FIXTURE / 'professions.tsv'),
                '--subjects', str(FIXTURE / 'subjects.tsv'), '--lock', str(FIXTURE / 'lock.json'), '--source', 'synthetic', '--out', str(out)]  # fmt: skip
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            self.assertEqual(run.main(args), 1)
        self.assertIn(f'field-length {extract}:2:38 (column value, at most 3)', err.getvalue())
        self.assertFalse(out.exists())

    def test_emit_refuses_a_source_that_the_lock_does_not_have(self):
        with self.assertRaises(emit.Refused) as refused:
            emit.emit(fixture('extract.tsv'), fixture('professions.tsv'), fixture('subjects.tsv'), fixture('lock.json'), 'other')
        self.assertEqual([f.rule for f in refused.exception.findings], ['reference'])

    def test_every_named_set_has_all_inputs_and_a_source_or_none(self):
        for name, named in run.SETS.items():
            with self.subTest(name):
                self.assertIn('out', named)
                have = [role for role in (*run.INPUTS, 'source') if role in named]
                self.assertIn(have, ([], [*run.INPUTS, 'source']))

    def test_the_sites_set_has_no_inputs_yet_and_gives_the_tracked_empty_file(self):
        self.assertEqual(run.SETS['site'], {'out': 'src/data/sourced.json'})
        self.assertEqual(emit.empty(), SITE.read_bytes())
        self.assertEqual(json.loads(SITE.read_bytes()), {'format': 1, 'inputs': [], 'professions': {}})
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(run.main(['emit', '--check', '--set', 'site']), 0)
        self.assertEqual(out.getvalue(), f'emit --check: src/data/sourced.json is what its inputs give ({len(SITE.read_bytes())} bytes)\n')

    def site_in(self, data: bytes | None):
        """The site's set, with the repository moved to a temporary folder that holds `data` as its file."""
        folder = self.make_temp()
        if data is not None:
            (folder / 'src' / 'data').mkdir(parents=True)
            (folder / 'src' / 'data' / 'sourced.json').write_bytes(data)
        return folder, mock.patch.object(run, 'REPO', str(folder))

    def test_the_check_fails_when_any_one_byte_of_the_sites_file_changes(self):
        tracked = SITE.read_bytes()
        changes = [tracked[:i] + (b'x' if tracked[i:i + 1] != b'x' else b'y') + tracked[i + 1:] for i in range(len(tracked))]
        changes += [tracked + b'\n', tracked[:-1], b' ' + tracked]
        for number, changed in enumerate(changes):
            with self.subTest(change=number):
                _folder, moved = self.site_in(changed)
                err = io.StringIO()
                with moved, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
                    self.assertEqual(run.main(['emit', '--check', '--set', 'site']), 1)
                self.assertIn('emit --check: src/data/sourced.json differs from what its inputs give', err.getvalue())
        _folder, moved = self.site_in(None)
        err = io.StringIO()
        with moved, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            self.assertEqual(run.main(['emit', '--check', '--set', 'site']), 1)
        self.assertIn('does not exist', err.getvalue())

    def test_emit_writes_the_sites_empty_file(self):
        folder, moved = self.site_in(b'{}\n')
        with moved, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(run.main(['emit', '--set', 'site']), 0)
        self.assertEqual((folder / 'src' / 'data' / 'sourced.json').read_bytes(), SITE.read_bytes())
        self.assertEqual(os.listdir(folder / 'src' / 'data'), ['sourced.json'])

    def test_explicit_paths_and_a_set_do_not_mix(self):
        err = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
            self.assertEqual(run.main(['emit', '--set', 'fixture', '--out', 'x.json']), 2)
            self.assertEqual(run.main(['emit', '--extract', 'x.tsv']), 2)
            self.assertEqual(run.main(['emit', '--set', 'nothing']), 2)
        self.assertIn('--set gives every path', err.getvalue())


class Canon(GuardedCase):
    def test_a_table_is_written_sorted_with_a_final_line_feed(self):
        data = canon.tsv_bytes(('a', 'b'), [('y', '2'), ('x', '9'), ('x', '10')])
        self.assertEqual(data, b'a\tb\nx\t10\nx\t9\ny\t2\n')

    def test_the_table_writer_refuses_what_has_no_canonical_form(self):
        for rows in ([('x', 'a\tb')], [('x', 'a\nb')], [('x', '')], [('x', chr(0xE9))], [('x', 'y'), ('x', 'y')], [('x',)]):
            with self.subTest(rows=ascii(rows)), self.assertRaises(canon.CanonError):
                canon.tsv_bytes(('a', 'b'), rows)

    def test_json_is_written_with_sorted_keys_two_spaces_ascii_and_a_final_line_feed(self):
        self.assertEqual(canon.json_bytes({'b': [1, 2], 'a': chr(0xE9)}), b'{\n  "a": "\\u00e9",\n  "b": [\n    1,\n    2\n  ]\n}\n')

    def test_the_json_writer_refuses_fractions_and_unknown_types(self):
        for value in (1.5, float('nan'), {'a': 0.1}, {1: 2}, {'a': {1, 2}}, 10**20):
            with self.subTest(value=repr(value)), self.assertRaises(canon.CanonError):
                canon.json_bytes(value)

    def test_the_json_reader_is_strict(self):
        for text in (b'{"a": 1, "a": 2}\n', b'{"a": 1.0}\n', b'{"a": 1e3}\n', b'{"a": NaN}\n', b'{"a": -Infinity}\n', b'{"a": 1234567890123}\n'):
            with self.subTest(text=text), self.assertRaises(canon.CanonError):
                canon.load_json(text)
        self.assertEqual(canon.load_json(b'{"a": [1, -2, true, null, "x"]}'), {'a': [1, -2, True, None, 'x']})

    def test_the_fixture_files_are_in_canonical_form(self):
        for name in TABLES:
            with self.subTest(name):
                lines = fixture(name).decode('ascii')[:-1].split('\n')
                rows = [tuple(line.split('\t')) for line in lines[1:]]
                self.assertEqual(canon.tsv_bytes(tuple(lines[0].split('\t')), rows), fixture(name))
        for name in ('lock.json', 'expected.json'):
            with self.subTest(name):
                self.assertEqual(canon.json_bytes(canon.load_json(fixture(name))), fixture(name))

    def test_the_gate_passes_what_emit_writes(self):
        self.assertEqual(gate.check_emitted(EXPECTED.read_bytes()), [])
