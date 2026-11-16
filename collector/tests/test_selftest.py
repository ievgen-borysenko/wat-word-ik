"""The self-test: it passes as shipped, fails when any rule is switched off,
and then the gate refuses everything, even the clean fixture."""

import contextlib
import io
import subprocess
import sys
from unittest import mock

import gate
import run
import selftest
from tests import RUN, GuardedCase


def without(rule: str):
    """The gate with one rule switched off: its findings are dropped."""
    record = gate._record

    def dropping(out, finding):
        if finding.rule != rule:
            record(out, finding)

    return mock.patch.object(gate, '_record', dropping)


def quiet(argv: list) -> tuple:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = run.main(argv)
    return code, out.getvalue(), err.getvalue()


class Selftest(GuardedCase):
    def test_the_command_passes_and_exits_0(self):
        result = subprocess.run(
            [sys.executable, '-I', '-S', '-B', str(RUN), 'selftest'],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r'^selftest: \d+ planted samples, each refused by its rule in its file; the clean sample passes\n$')

    def test_every_rule_has_a_planted_sample_and_every_sample_a_rule(self):
        planted = selftest.samples()
        self.assertEqual({rule for _name, rule, _file, _data in planted}, set(gate.RULES))
        self.assertEqual(len({name for name, *_ in planted}), len(planted), 'sample names are unique')

    def test_switching_off_any_rule_fails_the_selftest(self):
        for rule in gate.RULES:
            with self.subTest(rule), without(rule):
                code, out, err = quiet(['selftest'])
                self.assertEqual(code, 3)
                self.assertEqual(out, '')
                self.assertIn(f'by the rule {rule} in', err)

    def test_after_a_failed_selftest_the_gate_refuses_everything(self):
        self.assertEqual(quiet(['gate', '--set', 'fixture'])[0], 0)
        for rule in ('bytes', 'phrase', 'canonical'):
            with self.subTest(rule), without(rule):
                for argv in (['gate', '--set', 'fixture'], ['emit', '--check', '--set', 'fixture']):
                    code, _out, err = quiet(argv)
                    self.assertEqual(code, 3, argv)
                    self.assertIn('the self-test failed, so the gate refuses everything', err)

    def test_a_clean_sample_that_is_refused_fails_the_selftest(self):
        refuse_all = mock.patch.object(gate, 'check_lock', lambda data, file='lock': [gate.Finding('json-shape', file, 0, 0)])
        with refuse_all:
            count, failures = selftest.run()
        self.assertGreater(count, 0)
        self.assertIn('the clean sample is refused: json-shape lock:0:0', failures)
