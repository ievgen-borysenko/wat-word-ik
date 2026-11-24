"""The sandbox probe: before every stage, the launcher (sandboxed.py) runs this
in the same sandbox profile, with the same parameters and limits, and
compares what it reports with what the profile must refuse and allow.

  python3.14 -I -S -B collector/probe.py probe --profile fetch|offline ...
  python3.14 -I -S -B collector/probe.py paths

`probe` tries each action once and prints one JSON object: for each action
its outcome, `allowed` (it worked, or for a connection: the system's network
stack answered, so the sandbox let it through), `refused` (EPERM, the
sandbox's answer) or `error` (anything else), with the error name; and what
the process sees of
its environment (only the names of the variables), its interpreter flags and
its resource limits. The launcher decides; this module only reports.

The actions: read a file of the collector, the lock, the quarantine folder;
read a file outside every allowed folder and one of the repository outside
the collector; list the home folder, as the user database names it (not the
environment, which is empty); write into the folder the stage may write,
into the quarantine (from the offline profile) and outside every allowed
folder;
start a program (a shell); connect over TCP to port 443 and port 9 on the
loopback interface, send UDP to port 53 there, connect to the system's name
resolver; and load TLS with its certificates. Nothing leaves the machine: the
connections go to the loopback interface and the resolver's local socket.
A write that succeeds is removed at once.

`paths` prints where this interpreter's TLS finds its certificates (the
launcher must allow them); it starts no connection.
"""

import argparse
import errno
import json
import os
import pwd
import resource
import socket
import sys

# Built at run time: the loopback interface, which no connection here leaves.
LOOPBACK = '.'.join(('127', '0', '0', '1'))
SHELL = '/bin/sh'
LIMITS = ('RLIMIT_CORE', 'RLIMIT_CPU', 'RLIMIT_FSIZE', 'RLIMIT_NOFILE')


def _error(err: OSError) -> dict:
    name = errno.errorcode.get(err.errno or 0, 'none')
    # The sandbox refuses with EPERM; EACCES would be the file's own permissions.
    if err.errno == errno.EPERM:
        return {'outcome': 'refused', 'detail': name}
    return {'outcome': 'error', 'detail': name}


def _try(action) -> dict:
    try:
        detail = action()
    except OSError as err:
        return _error(err)
    except Exception as err:  # noqa: BLE001 - every failure is a result here
        return {'outcome': 'error', 'detail': type(err).__name__}
    return {'outcome': 'allowed', 'detail': detail or ''}


def _read(path: str):
    def action():
        with open(path, 'rb') as handle:
            handle.read(1)

    return action


def _list(path: str):
    def action():
        os.listdir(path)

    return action


def _list_home():
    os.listdir(pwd.getpwuid(os.getuid()).pw_dir)


def _write(folder: str):
    def action():
        path = os.path.join(folder, f'probe-{os.getpid()}')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(fd, b'x')
        finally:
            os.close(fd)
            os.unlink(path)

    return action


def _exec():
    pid = os.posix_spawn(SHELL, [SHELL, '-c', 'exit 0'], {})
    os.waitpid(pid, 0)


def _tcp(port: int):
    def action():
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(5)
            try:
                sock.connect((LOOPBACK, port))
            except ConnectionRefusedError:
                return 'ECONNREFUSED'  # the network stack answered: the sandbox let it through
            return 'connected'

    return action


def _udp(port: int):
    def action():
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.sendto(b'\0', (LOOPBACK, port))

    return action


def _resolver(path: str):
    def action():
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(5)
            sock.connect(path)
        return 'connected'

    return action


def _tls():
    import ssl  # here, so that the offline profile does not need it to start

    context = ssl.create_default_context()
    count = context.cert_store_stats()['x509_ca']
    if count == 0:
        raise RuntimeError('no certificates')
    return f'{count} certificates'


def probe(args) -> dict:
    actions = {
        'read-collector': _read(os.path.abspath(__file__)),
        'read-outside': _read(args.outside_file),
        'read-repository': _read(args.repository_file),
        'read-home': _list_home,
        'write-outside': _write(args.outside),
        'exec': _exec,
        'tcp-443': _tcp(443),
        'tcp-9': _tcp(9),
        'udp-53': _udp(53),
        'resolver': _resolver(args.resolver),
        'read-quarantine': _list(args.quarantine),
        'write-quarantine': _write(args.quarantine),
    }
    if args.lock is not None:
        actions['read-lock'] = _read(args.lock)
    if args.profile == 'fetch':
        actions['tls'] = _tls
    else:
        actions['write-out'] = _write(args.out)
    results = {name: _try(action) for name, action in sorted(actions.items())}
    return {
        'profile': args.profile,
        'actions': results,
        'environment': sorted(os.environ),
        'flags': {'isolated': sys.flags.isolated, 'no_site': sys.flags.no_site, 'dont_write_bytecode': sys.flags.dont_write_bytecode},
        'limits': {name: resource.getrlimit(getattr(resource, name))[0] for name in LIMITS},
    }


def paths() -> dict:
    import ssl

    found = ssl.get_default_verify_paths()
    return {'cafile': found.openssl_cafile, 'capath': found.openssl_capath}


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(prog='probe.py')
    commands = parser.add_subparsers(dest='command', required=True)
    run = commands.add_parser('probe')
    run.add_argument('--profile', choices=('fetch', 'offline'), required=True)
    for name in ('quarantine', 'outside', 'outside-file', 'repository-file', 'resolver'):
        run.add_argument(f'--{name}', required=True)
    run.add_argument('--lock')
    run.add_argument('--out')
    commands.add_parser('paths')
    args = parser.parse_args(argv)
    if args.command == 'probe' and (args.lock if args.profile == 'fetch' else args.out) is None:
        parser.error('the fetch profile needs --lock, the offline profile --out')
    result = probe(args) if args.command == 'probe' else paths()
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
