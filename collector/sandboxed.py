"""The launcher: runs a stage of the collector in a sandbox, after a probe.

run.py calls it (`run.py fetch`, `run.py probe`); it is not a stage itself
and opens no connection. A stage runs as a child process:

  - under a sandbox-exec profile (collector/sandbox/*.sb, deny by default),
    whose paths come in as -D parameters, worked out here at run time;
  - with an empty environment (no variable of the caller reaches it);
  - as python3.14 -I -S -B (no PYTHON* variables, no site-packages, no
    bytecode files), the same interpreter that runs the launcher;
  - in the folder /, with no standard input, under resource limits: no core
    files, a cap on CPU seconds, on the size of any file it writes and on
    open files, and a cap on its running time;
  - with its output read through pipes, of which the launcher keeps at most
    OUTPUT_MAX bytes per stream (it reads and drops the rest), and passes on
    only printable ASCII and line feeds, any other byte as '?', saying where
    a stream was cut.

Before every run, the probe (probe.py) runs under the same profile, with the
same parameters and limits, and must observe the refusals the profile
promises (EPERM): any network connection from the offline profile, and from
the fetch profile a TCP port other than 443 and UDP; a read outside the
allowed folders; a write outside them; starting a program. It must also
observe what the stage needs to work (reading its code, writing its folder,
for the fetch profile reaching port 443, the name resolver and TLS with its
certificates), an environment with nothing from the caller, the interpreter
flags and the limits. If sandbox-exec is missing, the profile does not load,
or one observation differs, the launcher stops with NO_SANDBOX (exit 4) and
the stage does not run.

What the profile reads of the interpreter is worked out here: its binary and
home folder, and the libraries outside that folder that the extension modules
a stage needs (TLS, hashes) load, read from the load commands of the
extension modules' Mach-O files (linked_libraries).
"""

import contextlib
import json
import os
import resource
import selectors
import struct
import subprocess
import sys
import sysconfig
import tempfile
import time

import lock
import shapes

COLLECTOR = os.path.dirname(os.path.realpath(__file__))
REPO = os.path.dirname(COLLECTOR)
SANDBOX_EXEC = '/usr/bin/sandbox-exec'
PROFILES = {name: os.path.join(COLLECTOR, 'sandbox', f'{name}.sb') for name in ('fetch', 'offline')}
FETCH = os.path.join(COLLECTOR, 'fetch.py')
PROBE = os.path.join(COLLECTOR, 'probe.py')
# The system's name resolver; the fetch profile may connect to it.
RESOLVER = '/var/run/mDNSResponder'
# Where the quarantine is unless --quarantine says otherwise: outside the
# repository, and outside the folders that macOS syncs (SYNCED).
DEFAULT_QUARANTINE = os.path.join('~', 'dev', '_quarantine', 'wat-word-ik')
SYNCED = (('Library', 'Mobile Documents'), ('Library', 'CloudStorage'))
# A file of the repository outside the collector, which no profile may read.
REPOSITORY_FILE = os.path.join(REPO, 'README.md')

PASSED, REFUSED, USAGE = 0, 1, 2
# The sandbox is missing or does not hold: nothing ran.
NO_SANDBOX = 4

# The extension modules a profile's stages need, whose libraries it must read.
MODULES = {'fetch': ('_ssl', '_hashlib'), 'offline': ('_hashlib',)}
# Libraries in these folders come with the system, which the profiles let
# every process read (system.sb).
SYSTEM_FOLDERS = ('/usr/lib/', '/System/')

# Resource limits of a child; FILE_SIZE is the stage's own.
CPU_SECONDS = 600
OPEN_FILES = 64
PROBE_TIMEOUT = 60
FETCH_TIMEOUT = 1800
VERIFY_TIMEOUT = 600
SMALL_FILE = 1 << 20
# What the launcher keeps of each output stream of a child, and passes on of
# a stage's; the probe's result may be longer. The rest is read and dropped.
OUTPUT_MAX = 8 << 10
PROBE_OUTPUT_MAX = 64 << 10
READ_CHUNK = 1 << 16
# Printable ASCII and the line feed pass on as they are; any other byte
# (escape sequences, carriage returns, tabs, anything outside ASCII) as '?'.
PASSED_ON = bytes(byte if 0x20 <= byte < 0x7F or byte == 0x0A else 0x3F for byte in range(256))

# What the probe must observe under each profile.
EXPECTED = {
    'fetch': {
        'read-collector': 'allowed',
        'read-lock': 'allowed',
        'read-quarantine': 'allowed',
        'write-quarantine': 'allowed',
        'tcp-443': 'allowed',
        'resolver': 'allowed',
        'tls': 'allowed',
        'read-outside': 'refused',
        'read-repository': 'refused',
        'write-outside': 'refused',
        'exec': 'refused',
        'tcp-9': 'refused',
        'udp-53': 'refused',
    },
    'offline': {
        'read-collector': 'allowed',
        'read-quarantine': 'allowed',
        'write-out': 'allowed',
        'read-outside': 'refused',
        'read-repository': 'refused',
        'write-outside': 'refused',
        'write-quarantine': 'refused',
        'exec': 'refused',
        'tcp-443': 'refused',
        'tcp-9': 'refused',
        'udp-53': 'refused',
        'resolver': 'refused',
    },
}
# Variables a process gets from the interpreter or the system itself, not
# from its caller: Python sets LC_CTYPE when it coerces the C locale (PEP 538),
# and macOS sets __CF_USER_TEXT_ENCODING when the interpreter's framework
# loads. Any other variable in the child means the environment leaked.
OWN_VARIABLES = frozenset({'LC_CTYPE', '__CF_USER_TEXT_ENCODING'})


class Unavailable(Exception):
    """The sandbox cannot be used, or the probe saw it not hold; nothing ran."""


class Failed(Exception):
    """A path or file the launcher needs is not usable (exit 2)."""


def sandbox_available() -> bool:
    return os.path.isfile(SANDBOX_EXEC) and os.access(SANDBOX_EXEC, os.X_OK)


def interpreter() -> tuple:
    """(binary, home) of the interpreter that runs the launcher, as real paths.
    For a macOS framework build the binary is the one inside the framework:
    the one on the path only starts that one, which the profile would have to
    allow as a second program."""
    home = os.path.realpath(sys.base_prefix)
    framework = os.path.join(home, 'Resources', 'Python.app', 'Contents', 'MacOS', 'Python')
    if sys.platform == 'darwin' and os.path.isfile(framework):
        return framework, home
    return os.path.realpath(sys.executable), home


# Mach-O load commands that name a library (LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB,
# LC_REEXPORT_DYLIB, LC_LOAD_UPWARD_DYLIB) and a run path (LC_RPATH).
_DYLIB_COMMANDS = frozenset({0xC, 0x80000018, 0x8000001F, 0x80000023})
_RPATH_COMMAND = 0x8000001C
_MAGIC_64 = 0xFEEDFACF
_FAT, _FAT_64 = 0xCAFEBABE, 0xCAFEBABF
_MAX_COMMANDS_BYTES = 1 << 22


def _thin(handle, offset: int, path: str) -> tuple:
    handle.seek(offset)
    header = handle.read(32)
    if len(header) != 32 or struct.unpack_from('<I', header)[0] != _MAGIC_64:
        raise Unavailable(f'{path} is not a 64-bit Mach-O file')
    count, size = struct.unpack_from('<II', header, 16)
    if size > _MAX_COMMANDS_BYTES:
        raise Unavailable(f'{path} has more load commands than the launcher reads')
    data = handle.read(size)
    libraries, rpaths, at = [], [], 0
    for _ in range(count):
        if at + 12 > len(data):
            raise Unavailable(f'{path} has a truncated load command')
        command, length = struct.unpack_from('<II', data, at)
        if length < 12 or at + length > len(data):
            raise Unavailable(f'{path} has a malformed load command')
        if command in _DYLIB_COMMANDS or command == _RPATH_COMMAND:
            start = struct.unpack_from('<I', data, at + 8)[0]
            name = data[at + start : at + length].split(b'\0', 1)[0].decode('utf-8')
            (libraries if command in _DYLIB_COMMANDS else rpaths).append(name)
        at += length
    return libraries, rpaths


def linked_libraries(path: str) -> tuple:
    """(libraries, run paths) that a Mach-O file names in its load commands,
    over every architecture it holds, each sorted and without repeats.
    Raises Unavailable for a file it cannot read or parse."""
    try:
        return _linked_libraries(path)
    except (OSError, struct.error, UnicodeDecodeError):
        raise Unavailable(f'{path} cannot be read as a Mach-O file (missing, cut short, or a library name that is not UTF-8)') from None


def _linked_libraries(path: str) -> tuple:
    with open(path, 'rb') as handle:
        magic = struct.unpack('>I', handle.read(4).rjust(4, b'\0'))[0]
        if magic in (_FAT, _FAT_64):
            count = struct.unpack('>I', handle.read(4))[0]
            if count > 16:
                raise Unavailable(f'{path} holds more architectures than the launcher reads')
            entry = '>iiIII' if magic == _FAT else '>iiQQII'
            offsets = [struct.unpack(entry, handle.read(struct.calcsize(entry)))[2] for _ in range(count)]
        else:
            offsets = [0]
        libraries, rpaths = set(), set()
        for offset in offsets:
            found, paths = _thin(handle, offset, path)
            libraries.update(found)
            rpaths.update(paths)
    return sorted(libraries), sorted(rpaths)


def _resolve(name: str, loader: str, rpaths: list, binary: str) -> str:
    def substitute(text: str) -> str:
        for token, folder in (('@loader_path', os.path.dirname(loader)), ('@executable_path', os.path.dirname(binary))):
            if text.startswith(token + '/'):
                return os.path.join(folder, text[len(token) + 1 :])
        return text

    if name.startswith('@rpath/'):
        for rpath in rpaths:
            candidate = os.path.join(substitute(rpath), name[len('@rpath/') :])
            if os.path.exists(candidate):
                return candidate
        raise Unavailable(f'{loader} loads {name}, which none of its run paths holds')
    name = substitute(name)
    if name.startswith('@'):
        raise Unavailable(f'{loader} loads {name}, which the launcher cannot place')
    return name


def library_folder(binary: str, home: str, modules: tuple) -> tuple:
    """(folder, link) for the libraries outside the interpreter's home and
    the system's that these extension modules load: the real folder, and the
    folder as the load commands name it when that path goes through a
    symbolic link (else None). (None, None) when there are none. Only one
    such folder is supported."""
    lib_dynload = os.path.join(sysconfig.get_paths()['platstdlib'], 'lib-dynload')
    suffix = sysconfig.get_config_var('EXT_SUFFIX') or ''
    todo = [os.path.join(lib_dynload, name + suffix) for name in modules]
    todo = [path for path in todo if os.path.isfile(path)]  # a module built into the interpreter has no file
    seen, outside = set(todo), {}
    while todo:
        loader = todo.pop()
        names, rpaths = linked_libraries(loader)
        for name in names:
            path = _resolve(name, loader, rpaths, binary)
            if path.startswith(SYSTEM_FOLDERS):
                continue
            real = os.path.realpath(path)
            if real.startswith(home + os.sep):
                continue
            outside.setdefault(os.path.dirname(real), set()).add(os.path.dirname(path))
            if real not in seen:
                seen.add(real)
                todo.append(real)
    if not outside:
        return None, None
    if len(outside) > 1:
        raise Unavailable(f'the interpreter loads libraries from {len(outside)} folders outside its home; the profiles allow one')
    folder, named = next(iter(outside.items()))
    links = sorted(named - {folder})
    if len(links) > 1:
        raise Unavailable('the interpreter names its library folder by more than one path; the profiles allow one')
    return folder, (links[0] if links else None)


def spawn(argv: list, *, file_size: int, timeout: int, keep: int = OUTPUT_MAX) -> subprocess.CompletedProcess:
    """Run a child with an empty environment, in /, without standard input,
    under the resource limits. Of each output stream the result holds the
    first keep + 1 bytes (one more than a caller passes on, to tell that
    there was more); the rest is read and dropped, so the child never waits
    on a full pipe and the launcher holds no more than that. A child that
    runs longer than timeout is stopped, and subprocess.TimeoutExpired raised.

    Pipes read with a cap, rather than files that the child writes: such a
    file would grow on disk up to the child's file-size limit (for a
    download, the source's size and 1 MiB)."""

    def limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_size, file_size))
        resource.setrlimit(resource.RLIMIT_NOFILE, (OPEN_FILES, OPEN_FILES))

    child = subprocess.Popen(argv, env={}, cwd='/', stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=limits)
    out, err = child.stdout.fileno(), child.stderr.fileno()
    kept = {out: bytearray(), err: bytearray()}
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            for fd in kept:
                selector.register(fd, selectors.EVENT_READ)
            while selector.get_map():
                left = deadline - time.monotonic()
                if left <= 0:
                    raise subprocess.TimeoutExpired(argv, timeout)
                for key, _events in selector.select(left):
                    chunk = os.read(key.fd, READ_CHUNK)
                    if not chunk:
                        selector.unregister(key.fd)
                    elif len(kept[key.fd]) <= keep:
                        kept[key.fd] += chunk[: keep + 1 - len(kept[key.fd])]
        code = child.wait(max(deadline - time.monotonic(), 0))
    except BaseException:
        child.kill()
        child.wait()
        raise
    finally:
        child.stdout.close()
        child.stderr.close()
    return subprocess.CompletedProcess(argv, code, bytes(kept[out]), bytes(kept[err]))


def printable(data: bytes) -> str:
    """The bytes as the launcher shows them: printable ASCII and line feeds,
    any other byte as '?'."""
    return data.translate(PASSED_ON).decode('ascii')


def passed_on(data: bytes, stream: str) -> str:
    """A stage's output stream as the launcher passes it on: its first
    OUTPUT_MAX bytes, printable, and a line that says when it was cut."""
    text = printable(data[:OUTPUT_MAX])
    if len(data) > OUTPUT_MAX:
        text += ('\n' if text and not text.endswith('\n') else '') + f'[the stage\'s {stream} was cut after {OUTPUT_MAX} bytes]\n'
    return text


def tls_paths(binary: str) -> dict:
    """Where the interpreter's TLS looks for certificates (probe.py paths),
    asked of the interpreter itself with an empty environment."""
    try:
        result = spawn([binary, '-I', '-S', '-B', PROBE, 'paths'], file_size=SMALL_FILE, timeout=PROBE_TIMEOUT, keep=PROBE_OUTPUT_MAX)
    except subprocess.TimeoutExpired:
        raise Unavailable(f'the interpreter did not say where its TLS certificates are within {PROBE_TIMEOUT} s') from None
    except OSError as err:
        raise Unavailable(f'the interpreter could not be started to ask where its TLS certificates are: {err.strerror}') from None
    try:
        if len(result.stdout) > PROBE_OUTPUT_MAX:
            raise ValueError('cut')
        found = json.loads(result.stdout)
        return {'cafile': found['cafile'], 'capath': found['capath']}
    except (ValueError, KeyError, TypeError):
        raise Unavailable(f'the interpreter did not say where its TLS certificates are (exit {result.returncode})') from None


def parameters(profile: str, *, quarantine: str, lock_path: str | None = None, out: str | None = None) -> dict:
    """The -D parameters of a profile: real paths, worked out at run time."""
    binary, home = interpreter()
    params = {'PYTHON': binary, 'PYTHON_HOME': home, 'COLLECTOR': COLLECTOR, 'QUARANTINE': os.path.realpath(quarantine)}
    folder, link = library_folder(binary, home, MODULES[profile])
    if folder is not None:
        params['LIBRARIES'] = folder
    if link is not None:
        params['LIBRARIES_LINK'] = link
    if lock_path is not None:
        params['LOCK'] = os.path.realpath(lock_path)
    if profile == 'fetch':
        params['RESOLVER'] = os.path.realpath(RESOLVER)
        found = tls_paths(binary)
        if found['cafile'] and os.path.isfile(found['cafile']):
            params['CA_FILE'] = found['cafile']
            params['CA_FILE_REAL'] = os.path.realpath(found['cafile'])
        if found['capath'] and os.path.isdir(found['capath']):
            params['CA_DIR'] = found['capath']
            params['CA_DIR_REAL'] = os.path.realpath(found['capath'])
    else:
        params['OUT'] = os.path.realpath(out)
    return params


def command(profile: str, params: dict, script: str, args: list) -> list:
    argv = [SANDBOX_EXEC, '-f', PROFILES[profile]]
    for key in sorted(params):
        argv += ['-D', f'{key}={params[key]}']
    return argv + [params['PYTHON'], '-I', '-S', '-B', script, *args]


def _remove(folder: str) -> None:
    """Remove a temporary folder the launcher made, with what is in it, by
    path (best effort: what cannot be removed stays)."""
    for parent, folders, files in os.walk(folder, topdown=False):
        for name in files + [f for f in folders if os.path.islink(os.path.join(parent, f))]:
            with contextlib.suppress(OSError):
                os.unlink(os.path.join(parent, name))
        for name in folders:
            with contextlib.suppress(OSError):
                os.rmdir(os.path.join(parent, name))
    with contextlib.suppress(OSError):
        os.rmdir(folder)


def _inside(path: str, folder: str) -> bool:
    return path == folder or path.startswith(folder + os.sep)


def run_probe(profile: str, params: dict, scratch: str, file_size: int) -> dict:
    """Run the probe under the profile and return what it observed."""
    outside = os.path.realpath(tempfile.mkdtemp(prefix='probe-outside-', dir=scratch))
    try:
        allowed = [params[key] for key in ('COLLECTOR', 'QUARANTINE', 'OUT', 'LOCK') if key in params]
        if any(_inside(outside, path) or _inside(path, outside) for path in allowed):
            raise Unavailable('the scratch folder of the probe is inside a folder the profile allows')
        outside_file = os.path.join(outside, 'canary')
        with open(outside_file, 'wb') as handle:
            handle.write(b'canary\n')
        args = ['probe', '--profile', profile, '--quarantine', params['QUARANTINE'], '--outside', outside,
                '--outside-file', outside_file, '--repository-file', REPOSITORY_FILE, '--resolver', os.path.realpath(RESOLVER)]  # fmt: skip
        if 'LOCK' in params:
            args += ['--lock', params['LOCK']]
        if 'OUT' in params:
            args += ['--out', params['OUT']]
        try:
            result = spawn(command(profile, params, PROBE, args), file_size=file_size, timeout=PROBE_TIMEOUT, keep=PROBE_OUTPUT_MAX)
        except subprocess.TimeoutExpired:
            raise Unavailable(f'the probe did not finish within {PROBE_TIMEOUT} s') from None
    finally:
        _remove(outside)
    if result.returncode != 0:
        # The one line of the probe's error output that the launcher quotes, made printable.
        last = (printable(result.stderr[:OUTPUT_MAX]).strip().splitlines() or ['no message'])[-1][:300]
        raise Unavailable(f'the probe did not run under the {profile} profile (exit {result.returncode}): {last}')
    if len(result.stdout) > PROBE_OUTPUT_MAX:
        raise Unavailable(f'the probe gave more than the {PROBE_OUTPUT_MAX} bytes the launcher reads')
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise Unavailable('the probe gave no result that can be read') from None


def expected(profile: str, params: dict) -> dict:
    want = dict(EXPECTED[profile])
    if 'LOCK' in params:
        want['read-lock'] = 'allowed'
    return want


def check(profile: str, params: dict, result, file_size: int) -> list:
    """What differs between the probe's observations and what the profile
    promises; empty when the sandbox holds."""
    if not isinstance(result, dict) or result.get('profile') != profile or not isinstance(result.get('actions'), dict):
        return ['the probe gave no result for this profile']
    problems = []
    actions = result['actions']
    for name, want in sorted(expected(profile, params).items()):
        seen = actions.get(name)
        outcome, detail = (seen.get('outcome'), seen.get('detail')) if isinstance(seen, dict) else (None, None)
        if outcome == want:
            continue
        if want == 'refused' and outcome == 'allowed':
            problems.append(f'{name}: the sandbox let it through; it must be refused')
        elif want == 'refused':
            problems.append(f'{name}: not refused by the sandbox (EPERM); it gave {outcome} {detail}')
        else:
            problems.append(f'{name}: the profile blocks what the stage needs; it gave {outcome} {detail}')
    unknown = sorted(set(actions) - set(expected(profile, params)))
    if unknown:
        problems.append(f'the probe tried actions the launcher does not know: {", ".join(unknown)}')
    environment = result.get('environment')
    if not isinstance(environment, list) or not set(environment) <= OWN_VARIABLES:
        leaked = sorted(set(environment) - OWN_VARIABLES) if isinstance(environment, list) else ['(unreadable)']
        problems.append(f'the child sees variables that it did not set itself: {", ".join(map(str, leaked))}')
    if result.get('flags') != {'isolated': 1, 'no_site': 1, 'dont_write_bytecode': 1}:
        problems.append('the child does not run with -I -S -B')
    limits = {'RLIMIT_CORE': 0, 'RLIMIT_CPU': CPU_SECONDS, 'RLIMIT_FSIZE': file_size, 'RLIMIT_NOFILE': OPEN_FILES}
    if result.get('limits') != limits:
        problems.append('the child does not run under the resource limits')
    return problems


def run_stage(profile: str, params: dict, script: str, args: list, *, scratch: str, file_size: int, timeout: int) -> int:
    """Probe the profile, then run the stage under it; the stage's exit code,
    or NO_SANDBOX when the probe fails (the stage does not run)."""
    name = os.path.basename(PROFILES[profile])
    try:
        if not sandbox_available():
            raise Unavailable(f'{SANDBOX_EXEC} is missing (it comes with macOS only)')
        problems = check(profile, params, run_probe(profile, params, scratch, file_size), file_size)
    except Unavailable as err:
        print(f'no sandbox: {err}; nothing ran', file=sys.stderr)
        return NO_SANDBOX
    if problems:
        print(f'no sandbox: the probe under {name} did not observe what the profile promises; nothing ran:', file=sys.stderr)
        for problem in problems:
            print(f'  {problem}', file=sys.stderr)
        return NO_SANDBOX
    print(f'probe: {name} holds: {len(expected(profile, params))} actions refused or allowed as it promises', flush=True)
    try:
        result = spawn(command(profile, params, script, args), file_size=file_size, timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f'the stage did not finish within {timeout} s and was stopped', file=sys.stderr)
        return REFUSED
    sys.stdout.write(passed_on(result.stdout, 'output'))
    sys.stdout.flush()
    sys.stderr.write(passed_on(result.stderr, 'error output'))
    if result.returncode < 0:
        print(f'the stage was stopped by signal {-result.returncode}', file=sys.stderr)
        return REFUSED
    return result.returncode


def quarantine_root(given: str | None) -> str:
    """The quarantine's root as a real path; refused inside the repository
    or a folder that macOS syncs (iCloud Drive, cloud storage providers)."""
    root = os.path.realpath(os.path.expanduser(given or DEFAULT_QUARANTINE))
    if _inside(root, os.path.realpath(REPO)):
        raise Failed('the quarantine must be outside the repository')
    home = os.path.realpath(os.path.expanduser('~'))
    if any(_inside(root, os.path.join(home, *parts)) for parts in SYNCED):
        raise Failed('the quarantine must be outside the folders that macOS syncs')
    return root


def source_folder(root: str, source: lock.Source) -> str:
    """Make QUARANTINE/<id>/<sha256> where it is missing, under the root (a
    real path), and return it; raises Failed when a part of it is a symbolic
    link, or its real path is not that path. The fetch profile lets the stage
    write in that folder, and so remove it and put a link to another place
    in its stead: the next run would hand that place to the probe and the
    stage. A part is checked before it is made, so that nothing is made
    through a link."""
    os.makedirs(root, mode=0o700, exist_ok=True)
    folder = root
    for part in (source.id, source.sha256):
        folder = os.path.join(folder, part)
        if os.path.islink(folder):
            raise Failed(f'{folder} in the quarantine is a symbolic link; nothing ran. Look at where it points, then remove it by hand')
        if not os.path.isdir(folder):
            os.mkdir(folder, 0o700)
    if os.path.realpath(folder) != os.path.join(root, source.id, source.sha256):
        raise Failed(f'{folder} in the quarantine is not where its path says; nothing ran')
    return folder


def fetch(source_id: str, lock_path: str, quarantine: str | None, scratch: str | None = None) -> int:
    """run.py fetch: one source of the lock into QUARANTINE/<id>/<sha256>.
    An https source is fetched under the fetch profile; a manual one is only
    checked, under the offline profile, since checking needs no network."""
    try:
        with open(lock_path, 'rb') as handle:
            data = handle.read(shapes.LOCK_MAX_BYTES + 1)
    except OSError as err:
        print(f'fetch: cannot read the lock {lock_path}: {err.strerror}', file=sys.stderr)
        return USAGE
    try:
        source = lock.find(lock.read(data), source_id)
    except lock.LockError as err:
        print(f'fetch: refused: {err}', file=sys.stderr)
        return REFUSED
    if not sandbox_available():
        print(f'no sandbox: {SANDBOX_EXEC} is missing (it comes with macOS only); nothing ran', file=sys.stderr)
        return NO_SANDBOX
    try:
        folder = source_folder(quarantine_root(quarantine), source)
    except Failed as err:
        print(f'fetch: {err}', file=sys.stderr)
        return USAGE
    except OSError as err:
        print(f'fetch: cannot make the quarantine folder: {err.strerror}', file=sys.stderr)
        return USAGE
    scratch = scratch or tempfile.gettempdir()
    args = ['--lock', os.path.realpath(lock_path), '--source', source.id, '--folder', folder]
    try:
        if source.kind == 'https':
            params = parameters('fetch', quarantine=folder, lock_path=lock_path)
            return run_stage('fetch', params, FETCH, args, scratch=scratch, file_size=source.size + SMALL_FILE, timeout=FETCH_TIMEOUT)
        out = tempfile.mkdtemp(prefix='verify-', dir=scratch)
        try:
            params = parameters('offline', quarantine=folder, lock_path=lock_path, out=out)
            return run_stage('offline', params, FETCH, args, scratch=scratch, file_size=SMALL_FILE, timeout=VERIFY_TIMEOUT)
        finally:
            _remove(out)
    except Unavailable as err:
        print(f'no sandbox: {err}; nothing ran', file=sys.stderr)
        return NO_SANDBOX


def probe(profile: str, scratch: str | None = None) -> int:
    """run.py probe: the probe alone, in temporary folders, with its observations."""
    if not sandbox_available():
        print(f'no sandbox: {SANDBOX_EXEC} is missing (it comes with macOS only)', file=sys.stderr)
        return NO_SANDBOX
    work = tempfile.mkdtemp(prefix='probe-', dir=scratch or tempfile.gettempdir())
    try:
        quarantine, out = os.path.join(work, 'quarantine'), os.path.join(work, 'out')
        os.mkdir(quarantine)
        os.mkdir(out)
        lock_path = os.path.join(work, 'lock.json')
        with open(lock_path, 'wb') as handle:
            handle.write(b'{}\n')
        params = parameters(profile, quarantine=quarantine, lock_path=lock_path if profile == 'fetch' else None, out=out)
        result = run_probe(profile, params, work, SMALL_FILE)
    except Unavailable as err:
        print(f'no sandbox: {err}', file=sys.stderr)
        return NO_SANDBOX
    finally:
        _remove(work)
    name = os.path.basename(PROFILES[profile])
    problems = check(profile, params, result, SMALL_FILE)
    actions = result.get('actions') if isinstance(result, dict) else None
    for action, want in sorted(expected(profile, params).items()):
        seen = actions.get(action) if isinstance(actions, dict) else None
        seen = seen if isinstance(seen, dict) else {}
        detail = f" ({seen.get('detail')})" if seen.get('detail') else ''
        mark = 'as promised' if seen.get('outcome') == want else f'PROMISED {want}'
        print(f'  {action:<17} {seen.get("outcome")}{detail}, {mark}')
    environment = result.get('environment') if isinstance(result, dict) else None
    if isinstance(environment, list):
        print(f'  environment       {", ".join(map(str, environment)) or "(empty)"}')
    if problems:
        print(f'probe: {name} does not hold:', file=sys.stderr)
        for problem in problems:
            print(f'  {problem}', file=sys.stderr)
        return NO_SANDBOX
    print(f'probe: {name} holds')
    return PASSED
