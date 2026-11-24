"""The fetch stage: one source of the lock, into its quarantine folder.

It runs in a child process that the launcher (sandboxed.py) starts in a
sandbox, with an empty environment:

  python3.14 -I -S -B collector/fetch.py --lock LOCK --source ID --folder FOLDER

FOLDER is the source's quarantine folder, QUARANTINE/<id>/<sha256>, outside
the repository; the launcher makes it. The stage writes nothing else.

An https source is downloaded into FOLDER/<file>:

  - HTTPS only, with the system's certificate check; port 443 only.
  - The first request goes to the lock's URL. A redirect is followed, at most
    MAX_REDIRECTS times, only to the same host and only over HTTPS: a
    redirect to a host the lock does not list is refused, and so is one to
    another host that the lock does list (cross-host redirects are refused).
  - A generic user agent (USER_AGENT): nothing about the person or the
    project. No cookies, no proxy, no compression.
  - Refused: a status other than 200 after the redirects, a content type
    other than the lock's, an HTML page, an encoded body, a body larger than
    the lock's size (refused while it arrives, so at most size + one chunk is
    read), and a body whose size or sha256 is not the lock's.
  - Nothing is parsed: the body is counted, hashed and written. It is
    written under a temporary name and renamed only once size and sha256
    match, and made read-only; a refused body is removed.

A manual source is put into FOLDER/<file> by a person (when the server only
gives a page that asks for a person, for example); the stage only checks its
size and sha256. A file that is already there is checked the same way and
left as it is.

Exit codes: 0 the file is in the quarantine and matches the lock; 1 refused
(the lock entry, a rule above, a size or hash that differs, no connection);
2 usage, or a file that cannot be read or written.

Messages never quote what a server sent: they name the rule, and at most
numbers and the lock's own values.
"""

import argparse
import errno
import hashlib
import http.client
import os
import socket
import ssl
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# After the standard library, so that no file here can stand in for one of its modules.
if HERE not in sys.path:
    sys.path.append(HERE)

import lock  # noqa: E402
import shapes  # noqa: E402

PASSED, REFUSED, USAGE = 0, 1, 2

PORT = 443
MAX_REDIRECTS = 5
REDIRECTS = (301, 302, 303, 307, 308)
TIMEOUT = 60
CHUNK = 1 << 16
# Generic: the interpreter and its version, as many clients send.
USER_AGENT = f'Python/{sys.version_info.major}.{sys.version_info.minor}'
LOCATION_MAX = 2000
# How a web page starts, after white space, in lower case.
HTML_STARTS = (b'<!doctype html', b'<html', b'<head', b'<body', b'<script', b'<meta', b'<title')
PARTIAL = '.partial'


class Refused(Exception):
    """The stage refuses; the message is safe to print."""


def _sha256_of(path: str, cap: int) -> tuple:
    """(bytes read, sha256) of a file, reading at most cap + 1 bytes."""
    digest = hashlib.sha256()
    count = 0
    with open(path, 'rb') as handle:
        while count <= cap:
            chunk = handle.read(min(CHUNK, cap + 1 - count))
            if not chunk:
                break
            digest.update(chunk)
            count += len(chunk)
    return count, digest.hexdigest()


def check_file(source: lock.Source, path: str) -> None:
    """The file has the lock's size and sha256; raises Refused."""
    size = os.stat(path).st_size
    if size != source.size:
        raise Refused(f'it has {size} bytes, the lock pins {source.size}')
    count, sha = _sha256_of(path, source.size)
    if count != source.size or sha != source.sha256:
        raise Refused("its sha256 is not the lock's")


def verify(source: lock.Source, folder: str) -> str:
    """A manual source, or a file already fetched: check it, change nothing."""
    path = os.path.join(folder, source.file)
    if os.path.islink(path):
        raise Refused(f'{source.file} in the quarantine folder is a symbolic link; put the file itself there')
    if not os.path.isfile(path):
        raise Refused(f'{source.file} is not in the quarantine folder; put the file there by hand: {folder}')
    try:
        check_file(source, path)
    except Refused as err:
        raise Refused(f'{source.file} in the quarantine folder does not match the lock: {err}. It was not changed; remove it by hand to fetch it again') from None
    return f'{source.id} {source.version}: {source.size} bytes, sha256 as the lock pins: {path}'


def _next_hop(location, host: str, listed: frozenset) -> tuple:
    """(host, target) of a redirect's Location; raises Refused."""
    if location is None or len(location) > LOCATION_MAX or not location.isascii() or not location.isprintable():
        raise Refused('a redirect without a usable address')
    if location.startswith('//'):
        location = 'https:' + location  # protocol-relative: the scheme of the request, https
    lowered = location.lower()
    if lowered.startswith('http://'):
        raise Refused('a redirect to http; the stage fetches over HTTPS only')
    if location.startswith('/'):
        parts = lock.split_url(f'https://{host}{location}')
    elif lowered.startswith('https://'):
        parts = lock.split_url(location)
    else:
        raise Refused('a redirect to an address that is not https and not a path on the same host')
    if parts is None:
        raise Refused("a redirect to an address outside the lock's grammar (a host name, a path, no port)")
    if parts[0] not in listed:
        raise Refused('a redirect to a host that the lock does not list')
    if parts[0] != host:
        raise Refused('a redirect to another host; cross-host redirects are refused, also to a host the lock lists')
    return parts


def _looks_like_html(head: bytes) -> bool:
    start = head.lstrip(b' \t\r\n\f').lower()
    if start.startswith(b'\xef\xbb\xbf'):
        start = start[3:].lstrip(b' \t\r\n\f')
    return start.startswith(HTML_STARTS)


def _check_headers(source: lock.Source, response) -> None:
    encoding = (response.getheader('Content-Encoding') or '').strip().lower()
    if encoding not in ('', 'identity'):
        raise Refused('the server encoded the body (Content-Encoding); the stage takes the bytes only as they are')
    media = (response.getheader('Content-Type') or '').split(';', 1)[0].strip().lower()
    if media in lock.HTML_TYPES:
        raise Refused('the server sent a web page (an HTML content type), not the data file')
    if media != source.type:
        raise Refused(f"the server sent another content type than the lock's ({source.type})")
    length = response.getheader('Content-Length')
    if length is not None:
        length = length.strip()
        if not length.isdigit() or len(length) > 15:
            raise Refused('the server sent a malformed Content-Length')
        if int(length) != source.size:
            raise Refused(f'the server announces {int(length)} bytes, the lock pins {source.size}')


def _receive(source: lock.Source, response, partial: str) -> None:
    digest = hashlib.sha256()
    count = 0
    head = b''
    fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as out:
        while True:
            chunk = response.read(CHUNK)
            if not chunk:
                break
            count += len(chunk)
            if count > source.size:
                raise Refused(f'the body is larger than the {source.size} bytes the lock pins')
            if len(head) < 512:
                head += chunk[: 512 - len(head)]
                if _looks_like_html(head):
                    raise Refused('the body is a web page (HTML), not the data file')
            digest.update(chunk)
            out.write(chunk)
    if count != source.size:
        raise Refused(f'the body has {count} bytes, the lock pins {source.size}')
    if digest.hexdigest() != source.sha256:
        raise Refused("the sha256 of the body is not the lock's")


def download(source: lock.Source, folder: str, listed: frozenset, context: ssl.SSLContext | None = None, port: int = PORT) -> str:
    """Fetch an https source into folder/<file>; raises Refused."""
    if source.kind != 'https':
        raise Refused(f'{source.id} is not an https source')
    if source.host not in listed:
        raise Refused('the source names a host that the lock does not list')
    final = os.path.join(folder, source.file)
    if os.path.exists(final):
        return verify(source, folder) + ' (it was already there; nothing was fetched)'
    if context is None:
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
    partial = os.path.join(folder, source.file + PARTIAL)
    host, target = source.host, source.target
    headers = {'User-Agent': USER_AGENT, 'Accept': source.type, 'Accept-Encoding': 'identity'}
    try:
        for _hop in range(MAX_REDIRECTS + 1):
            connection = http.client.HTTPSConnection(host, port, timeout=TIMEOUT, context=context)
            try:
                connection.request('GET', target, headers=headers)
                response = connection.getresponse()
                if response.status in REDIRECTS:
                    host, target = _next_hop(response.getheader('Location'), host, listed)
                    continue
                if response.status != 200:
                    raise Refused(f'the server answered with status {response.status}, not 200')
                _check_headers(source, response)
                _receive(source, response, partial)
            finally:
                connection.close()
            os.chmod(partial, 0o400)
            os.rename(partial, final)
            return f'{source.id} {source.version}: {source.size} bytes, sha256 as the lock pins: {final}'
        raise Refused(f'more than {MAX_REDIRECTS} redirects')
    except ssl.SSLCertVerificationError as err:
        raise Refused(f'the certificate check failed: {err.verify_message}') from None
    except ssl.SSLError as err:
        raise Refused(f'the TLS connection failed: {err.reason or "no reason given"}') from None
    except http.client.HTTPException:
        raise Refused('the server did not answer in valid HTTP') from None
    except TimeoutError:
        raise Refused(f'no answer within {TIMEOUT} s') from None
    except socket.gaierror:
        raise Refused('the host name does not resolve') from None
    except OSError as err:
        if err.filename is not None:
            raise  # a file in the quarantine folder: main reports it
        if err.errno == errno.EPERM:
            raise Refused('the sandbox refused the connection (EPERM)') from None
        raise Refused(f'no connection to the server ({errno.errorcode.get(err.errno or 0, "no error number")})') from None
    finally:
        if os.path.exists(partial):
            os.remove(partial)


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(prog='fetch.py', description="The fetch stage: one source of the lock into its quarantine folder.")
    parser.add_argument('--lock', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--folder', required=True, help='the quarantine folder of the source: QUARANTINE/<id>/<sha256>')
    try:
        args = parser.parse_args(argv)
    except SystemExit as stop:
        return stop.code if isinstance(stop.code, int) else USAGE
    try:
        with open(args.lock, 'rb') as handle:
            data = handle.read(shapes.LOCK_MAX_BYTES + 1)
    except OSError as err:
        print(f'fetch: cannot read the lock: {err.strerror}', file=sys.stderr)
        return USAGE
    try:
        sources = lock.read(data)
        source = lock.find(sources, args.source)
    except lock.LockError as err:
        print(f'fetch: refused: {err}', file=sys.stderr)
        return REFUSED
    folder = os.path.abspath(args.folder)
    if (os.path.basename(os.path.dirname(folder)), os.path.basename(folder)) != (source.id, source.sha256) or not os.path.isdir(folder):
        print('fetch: the folder must be an existing QUARANTINE/<id>/<sha256> folder of this source', file=sys.stderr)
        return USAGE
    try:
        if source.kind == 'manual':
            message = verify(source, folder)
        else:
            message = download(source, folder, lock.hosts(sources))
    except Refused as err:
        print(f'fetch: refused: {source.id}: {err}', file=sys.stderr)
        return REFUSED
    except OSError as err:
        print(f'fetch: cannot write into the quarantine folder: {err.strerror}', file=sys.stderr)
        return USAGE
    print(f'fetch: {message}')
    return PASSED


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
