"""Test support for the collector: every test case derives from GuardedCase.

Run the tests from anywhere with the standard library only:

  python3.14 -I -S -B -m unittest discover -s collector/tests -t collector

GuardedCase keeps the tests out of the repository. While a test runs, the
functions that create, change or remove files refuse every path outside the
temporary folders the test made itself (make_temp), and the test fails; the
folders are removed after it. A subprocess is not covered by that, so each test
class also lists the repository's files (path, size, modification time) before
its first test and after its last, and fails when anything changed.
test_layout.py checks that every test case derives from GuardedCase.
"""

import builtins
import io
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

COLLECTOR = Path(__file__).resolve().parent.parent
REPO = COLLECTOR.parent
FIXTURE = COLLECTOR / 'fixtures' / 'synthetic'
RUN = COLLECTOR / 'run.py'

if str(COLLECTOR) not in sys.path:
    sys.path.append(str(COLLECTOR))

# Found before any guard is in place: the first call tries a file in the folder.
TEMP_ROOT = os.path.realpath(tempfile.gettempdir())

# Folders the listing skips: other tools write there, and none of them is tracked.
NOT_LISTED = {'.git', 'node_modules', 'dist', '__pycache__', 'playwright-report', 'test-results', 'blob-report', 'coverage', '.vite'}

_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND


class WriteRefused(AssertionError):
    """A test tried to write outside the temporary folders it made."""


def listing(root: Path = REPO) -> dict:
    files = {}
    for folder, dirs, names in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in NOT_LISTED)
        for name in names:
            path = os.path.join(folder, name)
            info = os.lstat(path)
            files[os.path.relpath(path, root)] = (info.st_size, info.st_mtime_ns)
    return files


class GuardedCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._repo_before = listing()

    @classmethod
    def tearDownClass(cls):
        after = listing()
        before = cls._repo_before
        changed = sorted(p for p in set(before) | set(after) if before.get(p) != after.get(p))
        super().tearDownClass()
        if changed:
            raise AssertionError(f'{cls.__name__} changed files in the repository: {changed[:10]}')

    def setUp(self):
        super().setUp()
        self._temps: list = []
        self._making_temp = False
        # Registered first, so it runs last: after the guard is gone.
        self.addCleanup(self._remove_temps)
        self._guard()

    def make_temp(self) -> Path:
        """A new temporary folder that this test may write into."""
        self._making_temp = True
        try:
            path = tempfile.mkdtemp(prefix='collector-test-')
        finally:
            self._making_temp = False
        real = os.path.realpath(path)
        self._temps.append(real)
        return Path(real)

    def _remove_temps(self):
        for path in self._temps:
            shutil.rmtree(path, ignore_errors=True)

    def _allowed(self, path, dir_fd=None) -> None:
        if isinstance(path, int):
            return  # an open descriptor: refused or allowed when it was opened
        name = os.fsdecode(os.fspath(path))
        if name == os.devnull:
            return
        if dir_fd is not None and not os.path.isabs(name):
            raise WriteRefused(f'a test may not write relative to a folder descriptor ({name})')
        real = os.path.realpath(name)
        if any(real == temp or real.startswith(temp + os.sep) for temp in self._temps):
            return
        if self._making_temp and os.path.dirname(real) == TEMP_ROOT:
            return
        raise WriteRefused(f'a test may write only into the temporary folders it made (make_temp), not to {real}')

    def _guard(self):
        allowed = self._allowed
        real_open, real_os_open = builtins.open, os.open

        def guarded_open(file, mode='r', *args, **kwargs):
            if any(flag in mode for flag in 'wax+'):
                allowed(file)
            return real_open(file, mode, *args, **kwargs)

        def guarded_os_open(path, flags, *args, dir_fd=None, **kwargs):
            if flags & _WRITE_FLAGS:
                allowed(path, dir_fd)
            return real_os_open(path, flags, *args, dir_fd=dir_fd, **kwargs)

        def one_path(real):
            def guarded(path, *args, dir_fd=None, **kwargs):
                allowed(path, dir_fd)
                return real(path, *args, dir_fd=dir_fd, **kwargs) if dir_fd is not None else real(path, *args, **kwargs)

            return guarded

        def two_paths(real):
            def guarded(src, dst, *args, **kwargs):
                allowed(src, kwargs.get('src_dir_fd'))
                allowed(dst, kwargs.get('dst_dir_fd'))
                return real(src, dst, *args, **kwargs)

            return guarded

        patches = [
            mock.patch.object(builtins, 'open', guarded_open),
            mock.patch.object(io, 'open', guarded_open),
            mock.patch.object(os, 'open', guarded_os_open),
        ]
        for name in ('mkdir', 'rmdir', 'remove', 'unlink', 'truncate', 'chmod', 'utime', 'mkfifo'):
            patches.append(mock.patch.object(os, name, one_path(getattr(os, name))))
        for name in ('rename', 'replace', 'link', 'symlink'):
            patches.append(mock.patch.object(os, name, two_paths(getattr(os, name))))
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
