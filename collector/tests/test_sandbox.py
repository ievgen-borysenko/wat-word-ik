"""The launcher (sandboxed.py), the probe (probe.py) and the two profiles.

Most of these run everywhere: the check of the probe's observations, the
launcher's refusal to run a stage when one observation differs (with a made-up
probe result) or when sandbox-exec is missing, the empty environment and the
limits of a child, the command line, the reading of Mach-O load commands, the
quarantine's place and the parameters each profile names.

The class Sandboxed needs sandbox-exec, which only macOS has: it runs the real
probe under both profiles, a profile that does not hold, a file put into the
quarantine by hand and a fetch that reaches port 443 on the loopback
interface. CI runs on Linux and skips it, saying so.
"""

import contextlib
import hashlib
import io
import json
import os
import re
import struct
import subprocess
import sys
import time
import unittest
from unittest import mock

import run
import sandboxed
import shapes
from tests import COLLECTOR, REPO, GuardedCase

HAS_SANDBOX = sandboxed.sandbox_available()
needs_sandbox = unittest.skipUnless(HAS_SANDBOX, 'needs sandbox-exec, which only macOS has (CI runs on Linux)')
SCHEME = 'https' + chr(0x3A) + chr(0x2F) * 2
LOCAL = 'local' + 'host'

ALWAYS = {
    'fetch': {'PYTHON', 'PYTHON_HOME', 'COLLECTOR', 'QUARANTINE', 'LOCK', 'RESOLVER'},
    'offline': {'PYTHON', 'PYTHON_HOME', 'COLLECTOR', 'QUARANTINE', 'OUT'},
}
OPTIONAL = {
    'fetch': {'LIBRARIES', 'LIBRARIES_LINK', 'CA_FILE', 'CA_FILE_REAL', 'CA_DIR', 'CA_DIR_REAL'},
    'offline': {'LIBRARIES', 'LIBRARIES_LINK', 'LOCK'},
}


def params_for(profile: str) -> dict:
    keys = ALWAYS[profile] | ({'LOCK'} if profile == 'offline' else set())
    return {key: f'/made/up/{key.lower()}' for key in keys}


def holding(profile: str, params: dict, file_size: int = sandboxed.SMALL_FILE) -> dict:
    """A probe result in which the sandbox holds."""
    return {
        'profile': profile,
        'actions': {name: {'outcome': want, 'detail': 'EPERM' if want == 'refused' else ''} for name, want in sandboxed.expected(profile, params).items()},
        'environment': sorted(sandboxed.OWN_VARIABLES),
        'flags': {'isolated': 1, 'no_site': 1, 'dont_write_bytecode': 1},
        'limits': {'RLIMIT_CORE': 0, 'RLIMIT_CPU': sandboxed.CPU_SECONDS, 'RLIMIT_FSIZE': file_size, 'RLIMIT_NOFILE': sandboxed.OPEN_FILES},
    }


@contextlib.contextmanager
def captured():
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        yield out, err


def write_lock(folder, body: bytes, **changes):
    entry = {'id': 'by-hand', 'version': '1', 'licence': 'CC-BY-4.0', 'sha256': hashlib.sha256(body).hexdigest(),
             'size': len(body), 'kind': 'manual', 'file': 'data.tsv'}  # fmt: skip
    entry.update(changes)
    path = folder / 'lock.json'
    path.write_text(json.dumps({'format': 1, 'sources': [entry]}, indent=2) + '\n', encoding='ascii')
    return path, entry


class Check(GuardedCase):
    """check(): the probe's observations against what each profile promises."""

    def test_a_result_in_which_the_sandbox_holds_passes(self):
        for profile in sandboxed.PROFILES:
            with self.subTest(profile):
                params = params_for(profile)
                self.assertEqual(sandboxed.check(profile, params, holding(profile, params), sandboxed.SMALL_FILE), [])

    def test_every_refusal_that_does_not_happen_is_named(self):
        for profile in sandboxed.PROFILES:
            params = params_for(profile)
            for name, want in sandboxed.expected(profile, params).items():
                if want != 'refused':
                    continue
                with self.subTest(profile=profile, action=name):
                    result = holding(profile, params)
                    result['actions'][name] = {'outcome': 'allowed', 'detail': ''}
                    self.assertEqual(sandboxed.check(profile, params, result, sandboxed.SMALL_FILE), [f'{name}: the sandbox let it through; it must be refused'])

    def test_a_refusal_must_be_the_sandboxs_own(self):
        params = params_for('offline')
        result = holding('offline', params)
        result['actions']['read-outside'] = {'outcome': 'error', 'detail': 'EACCES'}
        self.assertEqual(sandboxed.check('offline', params, result, sandboxed.SMALL_FILE), ['read-outside: not refused by the sandbox (EPERM); it gave error EACCES'])

    def test_every_allowance_that_fails_is_named(self):
        for profile in sandboxed.PROFILES:
            params = params_for(profile)
            for name, want in sandboxed.expected(profile, params).items():
                if want != 'allowed':
                    continue
                with self.subTest(profile=profile, action=name):
                    result = holding(profile, params)
                    result['actions'][name] = {'outcome': 'refused', 'detail': 'EPERM'}
                    problems = sandboxed.check(profile, params, result, sandboxed.SMALL_FILE)
                    self.assertEqual(problems, [f'{name}: the profile blocks what the stage needs; it gave refused EPERM'])

    def test_a_missing_or_unknown_action_fails(self):
        params = params_for('fetch')
        result = holding('fetch', params)
        del result['actions']['tcp-9']
        result['actions']['other'] = {'outcome': 'allowed', 'detail': ''}
        problems = sandboxed.check('fetch', params, result, sandboxed.SMALL_FILE)
        self.assertIn('tcp-9: not refused by the sandbox (EPERM); it gave None None', problems)
        self.assertIn('the probe tried actions the launcher does not know: other', problems)

    def test_a_leaked_variable_the_flags_and_the_limits_are_checked(self):
        params = params_for('offline')
        cases = {
            'environment': (['HOME', 'LC_CTYPE'], 'the child sees variables that it did not set itself: HOME'),
            'flags': ({'isolated': 0, 'no_site': 1, 'dont_write_bytecode': 1}, 'the child does not run with -I -S -B'),
            'limits': ({'RLIMIT_CORE': 1}, 'the child does not run under the resource limits'),
        }
        for key, (value, problem) in cases.items():
            with self.subTest(key):
                result = holding('offline', params)
                result[key] = value
                self.assertEqual(sandboxed.check('offline', params, result, sandboxed.SMALL_FILE), [problem])

    def test_a_result_for_another_profile_or_none_fails(self):
        params = params_for('fetch')
        for result in (holding('offline', params_for('offline')), None, [], {'profile': 'fetch'}):
            with self.subTest(result=str(result)[:30]):
                self.assertEqual(sandboxed.check('fetch', params, result, sandboxed.SMALL_FILE), ['the probe gave no result for this profile'])


class Launcher(GuardedCase):
    """run_stage(), fetch() and probe(): nothing runs unless the probe holds."""

    def run_stage(self, profile: str, result=None, unavailable: str | None = None, child=None):
        """run_stage with a made-up probe; returns (code, stdout, stderr, the commands spawned)."""
        params = params_for(profile)
        spawned = []

        def fake_probe(*_args):
            if unavailable is not None:
                raise sandboxed.Unavailable(unavailable)
            return holding(profile, params) if result is None else result

        def fake_spawn(argv, **kwargs):
            spawned.append(argv)
            return child or subprocess.CompletedProcess(argv, 0, b'stage: done\n', b'')

        with mock.patch.object(sandboxed, 'sandbox_available', lambda: True), mock.patch.object(sandboxed, 'run_probe', fake_probe), \
                mock.patch.object(sandboxed, 'spawn', fake_spawn), captured() as (out, err):  # fmt: skip
            code = sandboxed.run_stage(profile, params, sandboxed.FETCH, ['--x'], scratch=str(self.make_temp()), file_size=sandboxed.SMALL_FILE, timeout=5)
        return code, out.getvalue(), err.getvalue(), spawned

    def test_the_stage_runs_after_a_probe_that_holds(self):
        code, out, _err, spawned = self.run_stage('offline')
        self.assertEqual(code, 0)
        self.assertIn('probe: offline.sb holds', out)
        self.assertIn('stage: done', out)
        self.assertEqual(len(spawned), 1)
        self.assertEqual(spawned[0][:3], [sandboxed.SANDBOX_EXEC, '-f', sandboxed.PROFILES['offline']])
        self.assertEqual(spawned[0][-5:], ['-I', '-S', '-B', sandboxed.FETCH, '--x'])

    def test_the_launcher_aborts_when_any_probe_action_succeeds_that_must_be_refused(self):
        for profile in sandboxed.PROFILES:
            for name, want in sandboxed.expected(profile, params_for(profile)).items():
                if want != 'refused':
                    continue
                with self.subTest(profile=profile, action=name):
                    result = holding(profile, params_for(profile))
                    result['actions'][name] = {'outcome': 'allowed', 'detail': ''}
                    code, out, err, spawned = self.run_stage(profile, result)
                    self.assertEqual(code, sandboxed.NO_SANDBOX)
                    self.assertEqual(spawned, [], 'the stage did not run')
                    self.assertIn('nothing ran', err)
                    self.assertIn(f'{name}: the sandbox let it through', err)
                    self.assertNotIn('holds', out)

    def test_the_launcher_aborts_when_the_probe_cannot_run(self):
        code, _out, err, spawned = self.run_stage('fetch', unavailable='the probe did not run under the fetch profile (exit 65)')
        self.assertEqual((code, spawned), (sandboxed.NO_SANDBOX, []))
        self.assertIn('no sandbox: the probe did not run under the fetch profile (exit 65); nothing ran', err)

    def test_the_stages_exit_code_is_passed_on_and_a_signal_is_a_refusal(self):
        self.assertEqual(self.run_stage('offline', child=subprocess.CompletedProcess([], 1, b'', b'refused\n'))[0], 1)
        code, _out, err, _spawned = self.run_stage('offline', child=subprocess.CompletedProcess([], -9, b'', b''))
        self.assertEqual(code, 1)
        self.assertIn('stopped by signal 9', err)

    def stand_in(self, code: str):
        """run_stage with a probe that holds and, as the stage, a real child
        that runs code without a sandbox: (exit code, stdout, stderr)."""
        params = params_for('offline')
        argv = [sandboxed.interpreter()[0], '-I', '-S', '-B', '-c', code]
        with mock.patch.object(sandboxed, 'sandbox_available', lambda: True), \
                mock.patch.object(sandboxed, 'run_probe', lambda *_args: holding('offline', params)), \
                mock.patch.object(sandboxed, 'command', lambda *_args: argv), captured() as (out, err):  # fmt: skip
            status = sandboxed.run_stage('offline', params, sandboxed.FETCH, [], scratch=str(self.make_temp()), file_size=sandboxed.SMALL_FILE, timeout=60)
        return status, out.getvalue(), err.getvalue()

    def assert_printable(self, text: str):
        self.assertTrue(set(text) <= set(map(chr, range(0x20, 0x7F))) | {'\n'}, ascii(text[:200]))

    def test_escape_sequences_and_other_bytes_reach_the_caller_only_as_question_marks(self):
        noisy_out = b'\x1b[31mred\x1b[0m caf\xc3\xa9\tok\r\n\x1b]0;title\x07\n'
        noisy_err = b'\x07bell \xe2\x80\xae\x00 \x9b2J\n'
        code = f'import os\nos.write(1, bytes.fromhex({noisy_out.hex()!r}))\nos.write(2, bytes.fromhex({noisy_err.hex()!r}))\n'
        status, out, err = self.stand_in(code)
        self.assertEqual(status, 0)
        self.assertEqual(out.split('\n', 1)[1], '?[31mred?[0m caf???ok?\n?]0;title?\n')
        self.assertEqual(err, '?bell ???? ?2J\n')
        self.assert_printable(out + err)

    def test_an_output_longer_than_the_cap_is_cut_and_says_so(self):
        status, out, err = self.stand_in('import os\nos.write(1, b"o" * 100000)\nos.write(2, b"e" * 100000 + b"\\n")\n')
        self.assertEqual(status, 0)
        cap = sandboxed.OUTPUT_MAX
        self.assertEqual(out.split('\n', 1)[1], 'o' * cap + f"\n[the stage's output was cut after {cap} bytes]\n")
        self.assertEqual(err, 'e' * cap + f"\n[the stage's error output was cut after {cap} bytes]\n")

    def test_the_one_line_of_the_probes_error_output_that_is_quoted_is_printable(self):
        params = params_for('fetch')
        noisy = subprocess.CompletedProcess([], 65, b'', b'first\n\x1b]0;title\x07 last \xe2\x80\xae\r\n')
        with mock.patch.object(sandboxed, 'spawn', lambda *_args, **_kwargs: noisy), \
                self.assertRaises(sandboxed.Unavailable) as stopped:  # fmt: skip
            sandboxed.run_probe('fetch', params, str(self.make_temp()), sandboxed.SMALL_FILE)
        self.assertEqual(str(stopped.exception), 'the probe did not run under the fetch profile (exit 65): ?]0;title? last ????')
        too_long = subprocess.CompletedProcess([], 0, b' ' * (sandboxed.PROBE_OUTPUT_MAX + 1), b'')
        with mock.patch.object(sandboxed, 'spawn', lambda *_args, **_kwargs: too_long), \
                self.assertRaisesRegex(sandboxed.Unavailable, 'more than the 65536 bytes the launcher reads'):  # fmt: skip
            sandboxed.run_probe('fetch', params, str(self.make_temp()), sandboxed.SMALL_FILE)

    def test_a_quarantine_folder_that_a_stage_replaced_by_a_link_stops_the_run(self):
        def must_not_run(*_args, **_kwargs):
            raise AssertionError('nothing may run')

        folder = self.make_temp()
        lock_path, entry = write_lock(folder, b'x\n')
        elsewhere = folder / 'elsewhere'
        elsewhere.mkdir()
        cases = {
            'the source folder': ('q1', lambda root: (root / 'by-hand').mkdir(parents=True) or os.symlink(elsewhere, root / 'by-hand' / entry['sha256'])),
            'the id folder': ('q2', lambda root: root.mkdir() or os.symlink(elsewhere, root / 'by-hand')),
        }
        for name, (root_name, plant) in cases.items():
            root = folder / root_name
            plant(root)
            with self.subTest(name), mock.patch.object(sandboxed, 'sandbox_available', lambda: True), \
                    mock.patch.object(sandboxed, 'parameters', must_not_run), mock.patch.object(sandboxed, 'run_stage', must_not_run), \
                    mock.patch.object(sandboxed, 'spawn', must_not_run), captured() as (_out, err):  # fmt: skip
                self.assertEqual(sandboxed.fetch('by-hand', str(lock_path), str(root), scratch=str(folder)), 2)
            self.assertIn('in the quarantine is a symbolic link; nothing ran', err.getvalue())
            self.assertEqual(os.listdir(elsewhere), [], 'nothing was made through the link')
        # A folder as the launcher made it goes on to the profile and the stage.
        seen = []
        with mock.patch.object(sandboxed, 'sandbox_available', lambda: True), \
                mock.patch.object(sandboxed, 'parameters', lambda profile, **kwargs: seen.append(kwargs['quarantine']) or {}), \
                mock.patch.object(sandboxed, 'run_stage', lambda *_args, **_kwargs: 0), captured():  # fmt: skip
            self.assertEqual(sandboxed.fetch('by-hand', str(lock_path), str(folder / 'q3'), scratch=str(folder)), 0)
        self.assertEqual(seen, [os.path.join(folder / 'q3', 'by-hand', entry['sha256'])])
        self.assertTrue(os.path.isdir(seen[0]) and not os.path.islink(seen[0]))

    def fetch_apart(self, lock_path, root, scratch) -> tuple:
        """sandboxed.fetch with the sandbox taken as there and nothing that
        starts: (exit code, error output, the quarantine folders handed on)."""
        def must_not_run(*_args, **_kwargs):
            raise AssertionError('nothing may run')

        seen = []
        with mock.patch.object(sandboxed, 'sandbox_available', lambda: True), \
                mock.patch.object(sandboxed, 'parameters', lambda profile, **kwargs: seen.append(kwargs['quarantine']) or {}), \
                mock.patch.object(sandboxed, 'run_stage', lambda *_args, **_kwargs: 0), mock.patch.object(sandboxed, 'spawn', must_not_run), \
                captured() as (_out, err):  # fmt: skip
            source_id = json.loads(lock_path.read_text(encoding='ascii'))['sources'][0]['id']
            code = sandboxed.fetch(source_id, str(lock_path), str(root), scratch=str(scratch))
        return code, err.getvalue(), seen

    @staticmethod
    def repository_name_as_id():
        """The name of the repository's folder when it is a valid source id, else None."""
        name = os.path.basename(sandboxed.REPO)
        return name if re.fullmatch(shapes.SOURCE_ID, name) and len(name) <= shapes.SOURCE_ID_MAX else None

    def test_a_root_around_the_real_repository_does_not_make_the_repository_a_source_folder(self):
        name = self.repository_name_as_id()
        if name is None:
            self.skipTest('the name of the folder that holds the repository is not a valid source id')
        folder = self.make_temp()
        lock_path, entry = write_lock(folder, b'x\n', id=name)
        before = sorted(os.listdir(sandboxed.REPO))
        code, err, seen = self.fetch_apart(lock_path, os.path.dirname(sandboxed.REPO), folder)
        self.assertEqual((code, seen), (2, []), err)
        self.assertIn('would be the repository, lie inside it or contain it; nothing ran', err)
        self.assertEqual(sorted(os.listdir(sandboxed.REPO)), before, 'nothing was made in the repository')
        self.assertFalse(os.path.lexists(os.path.join(sandboxed.REPO, entry['sha256'])))

    def test_a_case_alias_of_the_real_repository_is_the_repository(self):
        parent, name = os.path.split(sandboxed.REPO)
        alias = os.path.join(parent, name.swapcase())
        if not (os.path.exists(alias) and os.path.samefile(alias, sandboxed.REPO)):
            self.skipTest('the volume of the repository tells upper from lower case: no case alias of its path exists')
        folder = self.make_temp()
        before = sorted(os.listdir(sandboxed.REPO))
        lock_path, _entry = write_lock(folder, b'x\n')
        for root in (alias, os.path.join(alias, 'quarantine'), os.path.join(alias, 'collector', 'q')):
            with self.subTest(root='alias' + root[len(alias):]):
                code, err, seen = self.fetch_apart(lock_path, root, folder)
                self.assertEqual((code, seen), (2, []), err)
                self.assertIn('the quarantine must be outside the repository', err)
        # The parent spelt another way, with the repository's name as the id: only the
        # identity of the folders shows that the source's folder would be the repository's.
        grand, parent_name = os.path.split(parent)
        name = self.repository_name_as_id()
        if name is not None and parent_name.swapcase() != parent_name:
            lock_path, _entry = write_lock(folder, b'x\n', id=name)
            code, err, seen = self.fetch_apart(lock_path, os.path.join(grand, parent_name.swapcase()), folder)
            self.assertEqual((code, seen), (2, []), err)
            self.assertIn('would be the repository, lie inside it or contain it', err)
        self.assertEqual(sorted(os.listdir(sandboxed.REPO)), before, 'nothing was made in the repository')

    def test_a_source_folder_is_kept_apart_from_a_stand_in_repository_and_synced_folders(self):
        folder = self.make_temp()
        repo = folder / 'repo'
        repo.mkdir()
        (repo / 'README.md').write_text('x\n')
        home = folder / 'home'
        (home / 'Library' / 'Mobile Documents').mkdir(parents=True)
        with mock.patch.object(sandboxed, 'REPO', str(repo)), mock.patch.dict(os.environ, {'HOME': str(home)}):
            # The root holds the repository and the id is its name: refused, nothing made in it.
            lock_path, _entry = write_lock(folder, b'x\n', id='repo')
            os.symlink(folder, folder / 'link')
            for root in (folder, folder / 'link'):  # the second: the same root through a link
                with self.subTest(root=root.name):
                    code, err, seen = self.fetch_apart(lock_path, root, folder)
                    self.assertEqual((code, seen), (2, []), err)
                    self.assertIn('would be the repository, lie inside it or contain it', err)
                    self.assertEqual(os.listdir(repo), ['README.md'], 'nothing was made in the repository')
            # Another id under the same root is an ordinary source folder beside the repository.
            lock_path, entry = write_lock(folder, b'x\n', id='other')
            code, err, seen = self.fetch_apart(lock_path, folder, folder)
            self.assertEqual((code, seen), (0, [os.path.join(folder, 'other', entry['sha256'])]), err)
            # A source folder that would contain the repository.
            lock_path, entry = write_lock(folder, b'x\n', id='outer')
            inner = folder / 'outer' / entry['sha256'] / 'repo'
            inner.mkdir(parents=True)
            with mock.patch.object(sandboxed, 'REPO', str(inner)):
                code, err, seen = self.fetch_apart(lock_path, folder, folder)
            self.assertEqual((code, seen), (2, []))
            self.assertIn('would be the repository, lie inside it or contain it', err)
            # A source folder that would contain a folder that macOS syncs.
            lock_path, entry = write_lock(folder, b'x\n', id='around')
            synced = folder / 'around' / entry['sha256'] / 'home'
            (synced / 'Library' / 'Mobile Documents').mkdir(parents=True)
            with mock.patch.dict(os.environ, {'HOME': str(synced)}):
                code, err, seen = self.fetch_apart(lock_path, folder, folder)
            self.assertEqual((code, seen), (2, []))
            self.assertIn('would be a folder that macOS syncs, lie inside it or contain it', err)

    def without_sandbox_exec(self):
        return mock.patch.object(sandboxed, 'SANDBOX_EXEC', str(self.make_temp() / 'sandbox-exec'))

    def test_without_sandbox_exec_nothing_runs(self):
        def must_not_run(*_args, **_kwargs):
            raise AssertionError('nothing may run without the sandbox')

        folder = self.make_temp()
        lock_path, entry = write_lock(folder, b'x\n')
        quarantine = folder / 'quarantine'
        with self.without_sandbox_exec(), mock.patch.object(sandboxed, 'run_probe', must_not_run), mock.patch.object(sandboxed, 'spawn', must_not_run):
            for call in (
                lambda: sandboxed.run_stage('offline', params_for('offline'), sandboxed.FETCH, [], scratch=str(folder), file_size=1, timeout=1),
                lambda: sandboxed.fetch('by-hand', str(lock_path), str(quarantine), scratch=str(folder)),
                lambda: sandboxed.probe('fetch', scratch=str(folder)),
                lambda: run.main(['fetch', '--source', 'by-hand', '--lock', str(lock_path), '--quarantine', str(quarantine)]),
                lambda: run.main(['probe', '--profile', 'offline']),
            ):
                with self.subTest(call=call), captured() as (_out, err):
                    self.assertEqual(call(), sandboxed.NO_SANDBOX)
                self.assertIn('sandbox-exec is missing (it comes with macOS only)', err.getvalue())
        self.assertFalse(quarantine.exists(), 'not even the quarantine folder is made')
        self.assertEqual(run.NO_SANDBOX, 4)

    def test_fetch_refuses_a_lock_it_cannot_use_before_anything_else(self):
        folder = self.make_temp()
        lock_path, _entry = write_lock(folder, b'x\n')
        with captured() as (_out, err):
            self.assertEqual(sandboxed.fetch('other', str(lock_path), str(folder / 'q'), scratch=str(folder)), 1)
            self.assertEqual(sandboxed.fetch('by-hand', str(folder / 'missing.json'), str(folder / 'q'), scratch=str(folder)), 2)
            self.assertEqual(run.main(['fetch', '--source', 'by-hand']), 2)
        self.assertIn('has no source other', err.getvalue())
        self.assertIn('cannot read the lock', err.getvalue())
        self.assertFalse((folder / 'q').exists())

    def test_the_quarantine_stays_out_of_the_repository_and_the_synced_folders(self):
        home = self.make_temp()
        with mock.patch.dict(os.environ, {'HOME': str(home)}):
            for inside in (REPO, REPO / 'collector', REPO.parent / REPO.name / 'x'):
                with self.subTest(inside=str(inside)), self.assertRaisesRegex(sandboxed.Failed, 'outside the repository'):
                    sandboxed.quarantine_root(str(inside))
            for synced in (home / 'Library' / 'Mobile Documents' / 'q', home / 'Library' / 'CloudStorage' / 'Provider' / 'q'):
                with self.subTest(synced=synced.name), self.assertRaisesRegex(sandboxed.Failed, 'outside the folders that macOS syncs'):
                    sandboxed.quarantine_root(str(synced))
            self.assertEqual(sandboxed.quarantine_root(str(home / 'q')), os.path.realpath(home / 'q'))
            self.assertEqual(sandboxed.quarantine_root(None), os.path.join(os.path.realpath(home), 'dev', '_quarantine', 'wat-word-ik'))


class Child(GuardedCase):
    """spawn(): the environment, folder, input and limits of every child."""

    def run_child(self, code: str, file_size: int = sandboxed.SMALL_FILE):
        binary, _home = sandboxed.interpreter()
        result = sandboxed.spawn([binary, '-I', '-S', '-B', '-c', code], file_size=file_size, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_the_child_environment_is_empty(self):
        with mock.patch.dict(os.environ, {'COLLECTOR_CANARY': 'x', 'PYTHONPATH': str(COLLECTOR)}):
            seen = self.run_child('import json, os; print(json.dumps(sorted(os.environ)))')
        self.assertLessEqual(set(seen), sandboxed.OWN_VARIABLES, 'only what the interpreter and the system set themselves')
        for name in ('COLLECTOR_CANARY', 'PYTHONPATH', 'HOME', 'PATH', 'TMPDIR', 'USER'):
            self.assertNotIn(name, seen)

    def test_spawn_passes_no_variable_at_all(self):
        calls = []

        class Stop(Exception):
            pass

        def popen(argv, **kwargs):
            calls.append(kwargs)
            raise Stop

        with mock.patch.object(sandboxed.subprocess, 'Popen', popen), self.assertRaises(Stop):
            sandboxed.spawn(['x'], file_size=1, timeout=1)
        self.assertEqual(calls[0]['env'], {})
        self.assertEqual((calls[0]['cwd'], calls[0]['stdin']), ('/', subprocess.DEVNULL))
        self.assertEqual((calls[0]['stdout'], calls[0]['stderr']), (subprocess.PIPE, subprocess.PIPE))

    def test_the_launcher_keeps_only_the_start_of_a_long_output(self):
        binary, _home = sandboxed.interpreter()
        code = 'import os\nfor _ in range(64):\n    os.write(1, b"o" * 65536)\n    os.write(2, b"e" * 65536)\n'
        result = sandboxed.spawn([binary, '-I', '-S', '-B', '-c', code], file_size=sandboxed.SMALL_FILE, timeout=60)
        self.assertEqual(result.returncode, 0, 'the child wrote 4 MiB to each stream and was not blocked')
        self.assertEqual((result.stdout, result.stderr), (b'o' * (sandboxed.OUTPUT_MAX + 1), b'e' * (sandboxed.OUTPUT_MAX + 1)))

    def test_a_child_that_runs_too_long_is_stopped_while_its_output_is_dropped(self):
        binary, _home = sandboxed.interpreter()
        code = 'import os\nwhile True:\n    os.write(1, b"x" * 65536)\n'
        started = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            sandboxed.spawn([binary, '-I', '-S', '-B', '-c', code], file_size=sandboxed.SMALL_FILE, timeout=1)
        self.assertLess(time.monotonic() - started, 30)

    def test_the_child_runs_in_the_root_folder_without_input_under_the_limits(self):
        code = ('import json, os, resource, sys; '
                'print(json.dumps({"cwd": os.getcwd(), "stdin": sys.stdin.read(), '
                '"limits": [resource.getrlimit(getattr(resource, n)) for n in ("RLIMIT_CORE", "RLIMIT_CPU", "RLIMIT_FSIZE", "RLIMIT_NOFILE")]}))')  # fmt: skip
        seen = self.run_child(code, file_size=12345)
        self.assertEqual((seen['cwd'], seen['stdin']), ('/', ''))
        cpu, files = sandboxed.CPU_SECONDS, sandboxed.OPEN_FILES
        self.assertEqual(seen['limits'], [[0, 0], [cpu, cpu], [12345, 12345], [files, files]])

    def test_a_child_that_writes_more_than_its_file_size_limit_is_stopped(self):
        folder = self.make_temp()
        binary, _home = sandboxed.interpreter()
        code = f'with open({str(folder / "big")!r}, "wb") as out: out.write(b"x" * 5000)'
        result = sandboxed.spawn([binary, '-I', '-S', '-B', '-c', code], file_size=1000, timeout=60)
        self.assertNotEqual(result.returncode, 0)
        self.assertLessEqual((folder / 'big').stat().st_size, 1000)

    def test_the_command_puts_the_profile_its_parameters_and_the_flags_first(self):
        argv = sandboxed.command('fetch', {'PYTHON': '/p/python', 'B': '2', 'A': '1'}, '/c/fetch.py', ['--source', 'x'])
        self.assertEqual(argv, [sandboxed.SANDBOX_EXEC, '-f', sandboxed.PROFILES['fetch'], '-D', 'A=1', '-D', 'B=2', '-D', 'PYTHON=/p/python',
                                '/p/python', '-I', '-S', '-B', '/c/fetch.py', '--source', 'x'])  # fmt: skip


def dylib_command(command: int, name) -> bytes:
    raw = (name if isinstance(name, bytes) else name.encode('ascii')) + b'\0'
    raw += b'\0' * (-len(raw) % 8)
    if command == 0x8000001C:  # LC_RPATH: cmd, cmdsize, path offset
        return struct.pack('<III', command, 12 + len(raw), 12) + raw
    return struct.pack('<IIIIII', command, 24 + len(raw), 24, 2, 0x10000, 0x10000) + raw


def thin(*commands: bytes) -> bytes:
    body = b''.join(commands)
    return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 6, len(commands), len(body), 0, 0) + body


class MachO(GuardedCase):
    """linked_libraries() and the resolution of its names."""

    def write(self, data: bytes):
        path = self.make_temp() / 'library.dylib'
        path.write_bytes(data)
        return str(path)

    def test_the_libraries_and_run_paths_of_a_thin_file_are_read(self):
        data = thin(dylib_command(0xC, '/opt/x/lib/libssl.dylib'), dylib_command(0x80000018, '/usr/lib/libz.dylib'),
                    dylib_command(0x8000001C, '@loader_path/../lib'), struct.pack('<II', 0x19, 16) + b'\0' * 8)  # fmt: skip
        self.assertEqual(sandboxed.linked_libraries(self.write(data)), (['/opt/x/lib/libssl.dylib', '/usr/lib/libz.dylib'], ['@loader_path/../lib']))

    def test_every_architecture_of_a_universal_file_is_read(self):
        one, two = thin(dylib_command(0xC, '/a/liba.dylib')), thin(dylib_command(0xC, '/b/libb.dylib'), dylib_command(0xC, '/a/liba.dylib'))
        header = struct.pack('>II', 0xCAFEBABE, 2)
        offset_one = 64
        offset_two = offset_one + len(one) + (-len(one) % 16)
        header += struct.pack('>iiIII', 0x0100000C, 0, offset_one, len(one), 4) + struct.pack('>iiIII', 0x01000007, 3, offset_two, len(two), 4)
        data = header.ljust(offset_one, b'\0') + one.ljust(offset_two - offset_one, b'\0') + two
        self.assertEqual(sandboxed.linked_libraries(self.write(data)), (['/a/liba.dylib', '/b/libb.dylib'], []))

    def test_a_file_that_is_not_a_64_bit_mach_o_or_is_cut_short_is_refused(self):
        good = thin(dylib_command(0xC, '/a/liba.dylib'))
        for name, data in {
            'not Mach-O': b'#!/bin/sh\n' + b'\0' * 40,
            'empty': b'',
            'cut short': good[:-10],
            'a command shorter than its header': good[:32] + struct.pack('<II', 0xC, 4) + good[40:],
            'more commands than bytes': struct.pack('<IiiIIIII', 0xFEEDFACF, 0, 0, 6, 3, 8, 0, 0) + struct.pack('<II', 0x19, 8),
            'a library name that is not UTF-8': thin(dylib_command(0xC, b'/a/lib\xff.dylib')),
            'a universal header cut short': struct.pack('>I', 0xCAFEBABE) + b'\0\0',
            'a universal file with fewer entries than it says': struct.pack('>II', 0xCAFEBABE, 2) + struct.pack('>iiIII', 0x0100000C, 0, 64, 32, 4),
            'a 64-bit universal header cut short': struct.pack('>II', 0xCAFEBABF, 1) + b'\0' * 10,
        }.items():
            with self.subTest(name), self.assertRaises(sandboxed.Unavailable):
                sandboxed.linked_libraries(self.write(data))
        with self.assertRaisesRegex(sandboxed.Unavailable, 'cannot be read as a Mach-O file'):
            sandboxed.linked_libraries(str(self.make_temp() / 'missing.dylib'))

    def test_the_tls_paths_that_the_interpreter_does_not_give_stop_the_launcher(self):
        def timeout(argv, **_kwargs):
            raise subprocess.TimeoutExpired(argv, 1)

        def missing(_argv, **_kwargs):
            raise FileNotFoundError(2, 'No such file or directory')

        answers = {
            'a timeout': (timeout, 'within'),
            'no interpreter': (missing, 'could not be started'),
            'no JSON': (lambda argv, **_kwargs: subprocess.CompletedProcess(argv, 1, b'not json', b''), 'exit 1'),
            'too long': (lambda argv, **_kwargs: subprocess.CompletedProcess(argv, 0, b' ' * (sandboxed.PROBE_OUTPUT_MAX + 1), b''), 'exit 0'),
        }
        for name, (spawn, pattern) in answers.items():
            with self.subTest(name), mock.patch.object(sandboxed, 'spawn', spawn), self.assertRaisesRegex(sandboxed.Unavailable, pattern):
                sandboxed.tls_paths('/made/up/python')

    def test_loader_executable_and_run_path_names_are_resolved(self):
        folder = self.make_temp()
        (folder / 'lib').mkdir()
        (folder / 'bin').mkdir()
        (folder / 'lib' / 'libc.dylib').write_bytes(b'')
        loader = str(folder / 'bin' / 'module.so')
        resolve = sandboxed._resolve
        self.assertEqual(resolve('@loader_path/x.dylib', loader, [], '/e/python'), str(folder / 'bin' / 'x.dylib'))
        self.assertEqual(resolve('@executable_path/y.dylib', loader, [], '/e/python'), '/e/y.dylib')
        self.assertEqual(resolve('@rpath/libc.dylib', loader, ['/nowhere', '@loader_path/../lib'], '/e/python'), str(folder / 'bin' / '..' / 'lib' / 'libc.dylib'))
        self.assertEqual(resolve('/abs/libd.dylib', loader, [], '/e/python'), '/abs/libd.dylib')
        for name in ('@rpath/missing.dylib', '@other/z.dylib'):
            with self.subTest(name), self.assertRaises(sandboxed.Unavailable):
                resolve(name, loader, ['/nowhere'], '/e/python')

    @unittest.skipUnless(sys.platform == 'darwin', 'Mach-O files are macOS files')
    def test_the_interpreters_tls_libraries_are_found_where_it_loads_them(self):
        binary, home = sandboxed.interpreter()
        folder, link = sandboxed.library_folder(binary, home, sandboxed.MODULES['fetch'])
        if folder is None:
            self.skipTest('this interpreter loads its TLS library from its own home or has it built in')
        self.assertTrue(any(name.startswith(('libssl', 'libcrypto')) for name in os.listdir(folder)), folder)
        if link is not None:
            self.assertEqual(os.path.realpath(link), folder)


class Profiles(GuardedCase):
    """The two .sb files: deny by default, no paths of their own, and exactly
    the parameters the launcher gives."""

    def text(self, profile: str) -> str:
        with open(sandboxed.PROFILES[profile], encoding='ascii') as handle:
            lines = [line.split(';', 1)[0] for line in handle]
        return ' '.join(' '.join(lines).split())

    def test_each_profile_denies_by_default_and_names_no_path(self):
        for profile in sandboxed.PROFILES:
            with self.subTest(profile):
                text = self.text(profile)
                self.assertTrue(text.startswith('(version 1) (deny default) (import "system.sb") '), text[:80])
                strings = set(re.findall(r'"([^"]*)"', text))
                self.assertLessEqual(strings - {'system.sb', '*:443'}, ALWAYS[profile] | OPTIONAL[profile])
                self.assertNotIn('(allow default', text)
                for operation in ('process-fork', 'network-inbound', 'network-bind', 'file-write* (subpath (param "COLLECTOR"', 'mach-register'):
                    self.assertNotIn(operation, text)
                self.assertEqual(re.findall(r'\(allow process-exec[^)]*\)+', text), ['(allow process-exec (literal (param "PYTHON")))'])

    def test_only_the_fetch_profile_has_network_rules(self):
        self.assertEqual(re.findall(r'\(allow network-outbound [^)]*\)+', self.text('fetch')),
                         ['(allow network-outbound (remote tcp "*:443"))', '(allow network-outbound (literal (param "RESOLVER")))'])  # fmt: skip
        self.assertNotIn('network', self.text('offline').replace('No network rule', ''))

    def test_each_profile_names_exactly_the_parameters_the_launcher_gives(self):
        for profile in sandboxed.PROFILES:
            with self.subTest(profile):
                text = self.text(profile)
                named = set(re.findall(r'\(param "([A-Z_]+)"\)', text))
                optional = set(re.findall(r'\(when \(param "([A-Z_]+)"\)', text))
                self.assertEqual((named - optional, optional), (ALWAYS[profile], OPTIONAL[profile]))

    def test_the_launcher_gives_the_parameters_the_profiles_name(self):
        folder = self.make_temp()
        found = {'cafile': str(folder / 'cert.pem'), 'capath': str(folder)}
        (folder / 'cert.pem').write_text('x\n')
        for libraries in ((None, None), (str(folder), str(folder / 'link'))):
            with mock.patch.object(sandboxed, 'library_folder', lambda *_a, lib=libraries: lib), mock.patch.object(sandboxed, 'tls_paths', lambda _b: found):
                fetch = sandboxed.parameters('fetch', quarantine=str(folder), lock_path=str(folder / 'cert.pem'))
                offline = sandboxed.parameters('offline', quarantine=str(folder), out=str(folder))
                offline_lock = sandboxed.parameters('offline', quarantine=str(folder), out=str(folder), lock_path=str(folder / 'cert.pem'))
            with self.subTest(libraries=libraries[0] is not None):
                self.assertLessEqual(ALWAYS['fetch'], set(fetch))
                self.assertLessEqual(set(fetch), ALWAYS['fetch'] | OPTIONAL['fetch'])
                self.assertEqual(set(offline) - ALWAYS['offline'], set() if libraries[0] is None else {'LIBRARIES', 'LIBRARIES_LINK'})
                self.assertIn('LOCK', offline_lock)
                self.assertEqual(fetch['CA_FILE_REAL'], os.path.realpath(folder / 'cert.pem'))
        self.assertTrue(all(os.path.isabs(value) for value in fetch.values()))


@needs_sandbox
class Sandboxed(GuardedCase):
    """The real sandbox: macOS only."""

    def test_the_probe_holds_under_both_profiles(self):
        for profile in sandboxed.PROFILES:
            with self.subTest(profile), captured() as (out, err):
                code = sandboxed.probe(profile, scratch=str(self.make_temp()))
            self.assertEqual(code, 0, err.getvalue())
            lines = dict(line.split(None, 1) for line in out.getvalue().splitlines() if line.startswith('  '))
            self.assertEqual(lines['tcp-9'], 'refused (EPERM), as promised')
            self.assertEqual(lines['udp-53'], 'refused (EPERM), as promised')
            self.assertEqual(lines['read-outside'], 'refused (EPERM), as promised')
            self.assertEqual(lines['read-home'], 'refused (EPERM), as promised')
            self.assertEqual(lines['write-outside'], 'refused (EPERM), as promised')
            self.assertEqual(lines['exec'], 'refused (EPERM), as promised')
            if profile == 'offline':
                self.assertEqual(lines['tcp-443'], 'refused (EPERM), as promised')
                self.assertEqual(lines['resolver'], 'refused (EPERM), as promised')
            else:
                self.assertEqual(lines['tcp-443'], 'allowed (ECONNREFUSED), as promised')
                self.assertRegex(lines['tls'], r'^allowed \([1-9][0-9]* certificates\), as promised$')

    def test_a_profile_that_does_not_hold_stops_the_launcher_and_the_stage_does_not_run(self):
        folder = self.make_temp()
        loose = folder / 'loose.sb'
        loose.write_text('(version 1)\n(allow default)\n', encoding='ascii')
        (folder / 'quarantine').mkdir()
        (folder / 'out').mkdir()
        params = sandboxed.parameters('offline', quarantine=str(folder / 'quarantine'), out=str(folder / 'out'))
        real_spawn, spawned = sandboxed.spawn, []

        def spawn(argv, **kwargs):
            spawned.append(argv)
            return real_spawn(argv, **kwargs)

        with mock.patch.dict(sandboxed.PROFILES, {'offline': str(loose)}), mock.patch.object(sandboxed, 'spawn', spawn), captured() as (_out, err):
            code = sandboxed.run_stage('offline', params, sandboxed.PROBE, ['paths'], scratch=str(folder), file_size=sandboxed.SMALL_FILE, timeout=60)
        self.assertEqual(code, sandboxed.NO_SANDBOX)
        self.assertEqual(len(spawned), 1, 'only the probe ran')
        for name in ('read-outside', 'read-repository', 'read-home', 'write-outside', 'write-quarantine', 'exec', 'tcp-443', 'tcp-9', 'udp-53', 'resolver'):
            self.assertIn(f'{name}: the sandbox let it through', err.getvalue())

    def test_a_file_put_into_the_quarantine_by_hand_is_checked_in_the_offline_sandbox(self):
        folder = self.make_temp()
        body = b'element\tvalue\n'
        lock_path, entry = write_lock(folder, body)
        root = folder / 'quarantine'
        fetch = lambda: sandboxed.fetch('by-hand', str(lock_path), str(root), scratch=str(folder))  # noqa: E731
        with captured() as (out, err):
            self.assertEqual(fetch(), 1)
        self.assertIn('probe: offline.sb holds', out.getvalue())
        self.assertIn('put the file there by hand', err.getvalue())
        target = root / 'by-hand' / entry['sha256'] / 'data.tsv'
        target.write_bytes(body)
        with captured() as (out, err):
            self.assertEqual(fetch(), 0, err.getvalue())
        self.assertIn('sha256 as the lock pins', out.getvalue())
        target.write_bytes(body + b'x\n')
        with captured() as (_out, err):
            self.assertEqual(fetch(), 1)
        self.assertIn('does not match the lock', err.getvalue())

    def test_an_https_source_reaches_port_443_in_the_fetch_sandbox(self):
        folder = self.make_temp()
        lock_path, entry = write_lock(folder, b'x\n', kind='https', url=SCHEME + LOCAL + '/data.tsv', type='text/plain')
        with captured() as (out, err):
            code = sandboxed.fetch('by-hand', str(lock_path), str(folder / 'quarantine'), scratch=str(folder))
        self.assertEqual(code, 1, err.getvalue())
        self.assertIn('probe: fetch.sb holds', out.getvalue())
        # The host name resolved and the connection reached the loopback interface's port 443,
        # where nothing listens: the sandbox let it through (it would say EPERM).
        self.assertIn('no connection to the server (ECONNREFUSED)', err.getvalue())
        self.assertEqual(os.listdir(folder / 'quarantine' / 'by-hand' / entry['sha256']), [])
