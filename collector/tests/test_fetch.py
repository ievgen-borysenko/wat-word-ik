"""The fetch stage (fetch.py) against an HTTPS server on the loopback
interface that these tests start, with a certificate authority they make in
a temporary folder. Nothing leaves the machine.

The server answers each path as the test tells it and records every request.
The stage runs in this process, with a TLS context that trusts the test's
authority and the server's port in place of 443; the lock names the hosts
without a port, as a real lock does. Two names reach the server: the
loopback host name and the loopback address, so a redirect from one to the
other is a redirect to another host that the stage could reach.

This is the only test module that may import network modules
(test_layout.py); it needs them for the server. Where no openssl command
makes the certificates, the tests with the server are skipped, except in CI
(the variable CI set): there they fail, since a skipped class would leave the
job green while it proves nothing.
"""

import contextlib
import hashlib
import http.server
import io
import json
import os
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest import mock

import fetch
import lock
from tests import GuardedCase

# Built at run time: the loopback interface, by name and by address.
LOCAL = 'local' + 'host'
LOOPBACK = '.'.join(('127', '0', '0', '1'))
SCHEME = 'https' + chr(0x3A) + chr(0x2F) * 2
PLAIN = 'http' + chr(0x3A) + chr(0x2F) * 2
OPENSSL = shutil.which('openssl')
TYPE = 'text/tab-separated-values'
BODY = b'element\tvalue\n2.C.1\t412\n'
NO_OPENSSL = 'no openssl command to make the test certificates'


def skip_without_openssl(openssl, environ) -> bool:
    """Skip the tests with the server where openssl is missing, but not in CI."""
    return openssl is None and not environ.get('CI')


def make_authority(folder: str) -> None:
    """A certificate authority and a server certificate for both loopback names."""
    with open(os.path.join(folder, 'ca.cnf'), 'w', encoding='ascii') as handle:
        handle.write('basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n')
    with open(os.path.join(folder, 'server.cnf'), 'w', encoding='ascii') as handle:
        handle.write(f'subjectAltName=DNS:{LOCAL},IP:{LOOPBACK}\nbasicConstraints=critical,CA:FALSE\n'
                     'keyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n'
                     'subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n')  # fmt: skip
    steps = [
        ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.csr', '-subj', '/CN=collector test authority'],
        ['x509', '-req', '-in', 'ca.csr', '-signkey', 'ca.key', '-out', 'ca.pem', '-days', '2', '-extfile', 'ca.cnf'],
        ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', f'/CN={LOCAL}'],
        ['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', '2', '-out', 'server.pem', '-days', '2', '-extfile', 'server.cnf'],
    ]
    for step in steps:
        subprocess.run([OPENSSL, *step], cwd=folder, env={}, stdin=subprocess.DEVNULL, capture_output=True, timeout=60, check=True)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):  # noqa: N802 - the name http.server calls
        self.server.requests.append({'host': self.headers.get('Host', ''), 'path': self.path, 'headers': dict(self.headers)})
        answer = self.server.routes.get(self.path, (404, {'Content-Type': 'text/plain'}, b'not here\n'))
        status, headers, body = answer
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        if isinstance(body, list):
            self.send_header('Transfer-Encoding', 'chunked')
            self.end_headers()
            for chunk in body:
                self.wfile.write(f'{len(chunk):x}\r\n'.encode('ascii') + chunk + b'\r\n')
            self.wfile.write(b'0\r\n\r\n')
            return
        if 'Content-Length' not in headers:
            self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        pass  # a client that refuses the certificate ends its handshake; nothing to report


@contextlib.contextmanager
def quiet():
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as err:
        yield err


@unittest.skipIf(skip_without_openssl(OPENSSL, os.environ), NO_OPENSSL)
class Fetch(GuardedCase):
    @classmethod
    def setUpClass(cls):
        if OPENSSL is None:
            raise RuntimeError(f'{NO_OPENSSL}; in CI these tests must run')
        super().setUpClass()
        cls.keys = tempfile.mkdtemp(prefix='collector-test-tls-')
        make_authority(cls.keys)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(os.path.join(cls.keys, 'server.pem'), os.path.join(cls.keys, 'server.key'))
        cls.server = Server((LOOPBACK, 0), Handler)
        cls.server.socket = context.wrap_socket(cls.server.socket, server_side=True)
        cls.server.routes, cls.server.requests = {}, []
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.keys, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        self.server.routes.clear()
        self.server.requests.clear()
        self.trusting = ssl.create_default_context(cafile=os.path.join(self.keys, 'ca.pem'))

    def source(self, body: bytes = BODY, *, path: str = '/data.tsv', host: str = LOCAL, others: tuple = (), **changes):
        """The lock's source for `path` on `host`, read through lock.read, and
        the hosts the lock lists: its own and those of `others`."""
        entry = {'id': 'test-source', 'version': '1', 'licence': 'CC-BY-4.0', 'sha256': hashlib.sha256(body).hexdigest(),
                 'size': len(body), 'kind': 'https', 'file': 'data.tsv', 'url': SCHEME + host + path, 'type': TYPE}  # fmt: skip
        entry.update(changes)
        entries = [entry] + [dict(entry, id=f'other-{n}', url=SCHEME + other + '/x') for n, other in enumerate(others)]
        sources = lock.read((json.dumps({'format': 1, 'sources': entries}, indent=2) + '\n').encode('ascii'))
        return sources[0], lock.hosts(sources)

    def serve(self, path: str, body=BODY, status: int = 200, **headers):
        self.server.routes[path] = (status, {'Content-Type': TYPE, **headers}, body)

    def redirect(self, path: str, location: str, status: int = 302):
        self.server.routes[path] = (status, {'Location': location}, b'')

    def get(self, source, listed, context=None):
        folder = self.make_temp()
        return folder, fetch.download(source, str(folder), listed, context=context or self.trusting, port=self.port)

    def refused(self, source, listed, pattern: str, context=None):
        folder = self.make_temp()
        with self.assertRaisesRegex(fetch.Refused, pattern):
            fetch.download(source, str(folder), listed, context=context or self.trusting, port=self.port)
        self.assertEqual(os.listdir(folder), [], 'a refused download leaves nothing behind')
        return folder

    # Accepted.

    def test_a_file_that_matches_the_lock_is_accepted(self):
        self.serve('/data.tsv')
        folder, message = self.get(*self.source())
        self.assertEqual(os.listdir(folder), ['data.tsv'])
        self.assertEqual((folder / 'data.tsv').read_bytes(), BODY)
        self.assertEqual(os.stat(folder / 'data.tsv').st_mode & 0o777, 0o400, 'made read-only')
        self.assertIn(f'{len(BODY)} bytes, sha256 as the lock pins', message)
        self.assertEqual(len(self.server.requests), 1)

    def test_the_request_carries_a_generic_user_agent_and_asks_for_the_bytes_as_they_are(self):
        self.serve('/data.tsv')
        self.get(*self.source())
        headers = {k.lower(): v for k, v in self.server.requests[0]['headers'].items()}
        self.assertEqual(headers['user-agent'], fetch.USER_AGENT)
        self.assertRegex(fetch.USER_AGENT, r'^Python/3\.[0-9]+$')
        self.assertEqual(headers['accept-encoding'], 'identity')
        self.assertEqual(headers['accept'], TYPE)
        self.assertEqual(set(headers), {'host', 'user-agent', 'accept', 'accept-encoding'})

    def test_a_redirect_on_the_same_host_is_followed(self):
        self.redirect('/data.tsv', '/files/data.tsv', status=301)
        self.redirect('/files/data.tsv', SCHEME + LOCAL + '/final.tsv', status=307)
        self.serve('/final.tsv')
        folder, _message = self.get(*self.source())
        self.assertEqual((folder / 'data.tsv').read_bytes(), BODY)
        self.assertEqual([r['path'] for r in self.server.requests], ['/data.tsv', '/files/data.tsv', '/final.tsv'])

    def test_a_body_in_chunks_is_accepted(self):
        self.serve('/data.tsv', body=[BODY[:5], BODY[5:]])
        folder, _message = self.get(*self.source())
        self.assertEqual((folder / 'data.tsv').read_bytes(), BODY)

    def test_a_partial_file_left_by_a_stopped_run_is_removed_first(self):
        self.serve('/data.tsv')
        source, listed = self.source()
        folder = self.make_temp()
        (folder / ('data.tsv' + fetch.PARTIAL)).write_bytes(b'cut off')
        fetch.download(source, str(folder), listed, context=self.trusting, port=self.port)
        self.assertEqual(os.listdir(folder), ['data.tsv'])
        self.assertEqual((folder / 'data.tsv').read_bytes(), BODY)

    def test_a_file_already_in_the_quarantine_is_checked_and_not_fetched_again(self):
        source, listed = self.source()
        folder = self.make_temp()
        (folder / 'data.tsv').write_bytes(BODY)
        message = fetch.download(source, str(folder), listed, context=self.trusting, port=self.port)
        self.assertIn('nothing was fetched', message)
        self.assertEqual(self.server.requests, [])
        (folder / 'data.tsv').write_bytes(BODY.replace(b'412', b'413'))
        with self.assertRaisesRegex(fetch.Refused, 'does not match the lock.*not changed'):
            fetch.download(source, str(folder), listed, context=self.trusting, port=self.port)
        self.assertEqual((folder / 'data.tsv').read_bytes(), BODY.replace(b'412', b'413'))
        self.assertEqual(self.server.requests, [])

    # Refused: the scheme, the host, redirects.

    def test_http_is_refused_in_the_lock_and_in_a_redirect(self):
        with self.assertRaisesRegex(lock.LockError, r'url: not an https address'):
            self.source(url=PLAIN + LOCAL + '/data.tsv')
        self.redirect('/data.tsv', PLAIN + LOCAL + '/data.tsv')
        self.refused(*self.source(), 'a redirect to http')
        self.assertEqual(len(self.server.requests), 1, 'no request after the refused redirect')

    def test_a_redirect_to_a_host_the_lock_does_not_list_is_refused(self):
        self.redirect('/data.tsv', SCHEME + LOOPBACK + '/data.tsv')
        self.refused(*self.source(), 'a host that the lock does not list')
        self.assertEqual([r['path'] for r in self.server.requests], ['/data.tsv'])

    def test_a_redirect_to_another_host_is_refused_even_when_the_lock_lists_it(self):
        self.redirect('/data.tsv', SCHEME + LOOPBACK + '/data.tsv')
        source, listed = self.source(others=(LOOPBACK,))
        self.assertIn(LOOPBACK, listed)
        self.refused(source, listed, 'cross-host redirects are refused')
        self.assertEqual(len(self.server.requests), 1)

    def test_a_protocol_relative_redirect_to_another_host_is_refused(self):
        self.redirect('/data.tsv', chr(0x2F) * 2 + LOOPBACK + '/data.tsv')
        self.refused(*self.source(others=(LOOPBACK,)), 'cross-host redirects are refused')

    def test_a_source_whose_host_the_listed_hosts_lack_is_refused_before_any_request(self):
        source, _listed = self.source()
        self.refused(source, frozenset({LOOPBACK}), 'a host that the lock does not list')
        self.assertEqual(self.server.requests, [])

    def test_a_redirect_with_a_port_or_outside_the_grammar_is_refused(self):
        for number, location in enumerate([SCHEME + LOCAL + chr(0x3A) + str(self.port) + '/x', 'relative/path', '', SCHEME + LOCAL + '/a b']):
            with self.subTest(location=location):
                self.redirect(f'/start{number}', location)
                self.refused(*self.source(path=f'/start{number}'), 'a redirect')

    def test_too_many_redirects_are_refused(self):
        for hop in range(fetch.MAX_REDIRECTS + 1):
            self.redirect(f'/hop{hop}', f'/hop{hop + 1}')
        self.refused(*self.source(path='/hop0'), f'more than {fetch.MAX_REDIRECTS} redirects')
        self.assertEqual(len(self.server.requests), fetch.MAX_REDIRECTS + 1)

    # Refused: what the server sends.

    def test_a_body_larger_than_the_lock_is_refused(self):
        self.serve('/data.tsv', body=BODY + b'extra\n')
        self.refused(*self.source(), r'announces \d+ bytes, the lock pins')
        # In chunks, without a length up front: refused while it arrives.
        self.serve('/data.tsv', body=[BODY, b'extra\n' * 4])
        self.refused(*self.source(), 'larger than the .* bytes the lock pins')

    def test_a_length_that_is_not_ascii_digits_is_refused(self):
        # The header goes out as Latin-1: a superscript digit is one byte that
        # the client reads back as a character which isdigit() takes and int() refuses.
        for length in (chr(0xB2), '2' + chr(0xB3), chr(0xB9) * 2, '+' + str(len(BODY)), '-1', '0x19', '1' * 16, ''):
            with self.subTest(length=ascii(length)):
                self.serve('/data.tsv', **{'Content-Length': length})
                folder = self.refused(*self.source(), 'the server sent a malformed Content-Length')
                self.assertEqual(os.listdir(folder), [])

    def test_a_body_shorter_than_the_lock_is_refused(self):
        self.serve('/data.tsv', body=[BODY[:-1]])
        self.refused(*self.source(), r'the body has \d+ bytes, the lock pins')

    def test_a_hash_mismatch_is_refused(self):
        self.serve('/data.tsv', body=BODY.replace(b'412', b'413'))
        self.refused(*self.source(), "sha256 of the body is not the lock's")

    def test_another_content_type_or_a_web_page_is_refused(self):
        cases = [
            ({'Content-Type': 'application/zip'}, BODY, 'another content type'),
            ({'Content-Type': 'text/html; charset=utf-8'}, BODY, 'a web page'),
            ({'Content-Type': ''}, BODY, 'another content type'),
            ({}, b'  <!DOCTYPE html><title>x</title>' + b' ' * (len(BODY) - 33), 'the body is a web page'),
        ]
        for headers, body, pattern in cases:
            with self.subTest(pattern=pattern, headers=headers):
                self.serve('/data.tsv', body=body, **headers)
                self.refused(*self.source(body=body), pattern)

    def test_an_encoded_body_is_refused(self):
        self.serve('/data.tsv', **{'Content-Encoding': 'gzip'})
        self.refused(*self.source(), 'Content-Encoding')

    def test_a_status_other_than_200_is_refused(self):
        for status in (403, 404, 503):
            with self.subTest(status):
                self.serve('/data.tsv', status=status, body=b'no\n', **{'Content-Type': 'text/plain'})
                self.refused(*self.source(), f'status {status}')

    def test_a_server_whose_certificate_the_system_does_not_trust_is_refused(self):
        self.serve('/data.tsv')
        source, listed = self.source()
        folder = self.make_temp()
        built, own = [], fetch.tls_context

        def spy():
            built.append(own())
            return built[-1]

        # No context given: the stage's own, with the system's certificates, which do not hold the test's authority.
        with mock.patch.object(fetch, 'tls_context', spy), self.assertRaisesRegex(fetch.Refused, 'the certificate check failed'):
            fetch.download(source, str(folder), listed, port=self.port)
        self.assertEqual(len(built), 1, 'download built its own context')
        self.assertEqual((built[0].verify_mode, built[0].check_hostname), (ssl.CERT_REQUIRED, True))
        self.assertEqual(os.listdir(folder), [])
        self.assertEqual(self.server.requests, [])

    def test_a_server_that_does_not_listen_is_refused(self):
        source, listed = self.source()
        folder = self.make_temp()
        closed = Server((LOOPBACK, 0), Handler)
        port = closed.server_address[1]
        closed.server_close()
        with self.assertRaisesRegex(fetch.Refused, r'no connection to the server \(ECONNREFUSED\)'):
            fetch.download(source, str(folder), listed, context=self.trusting, port=port)

    def test_messages_never_quote_what_the_server_sent(self):
        marker = 'zqxmarker'
        source, listed = self.source()
        folder = str(self.make_temp())
        answers = [
            lambda: self.serve('/data.tsv', **{'Content-Type': f'application/{marker}', 'X-Note': marker}),
            lambda: self.redirect('/data.tsv', SCHEME + marker + '.' + LOCAL + '/x'),
            lambda: self.redirect('/data.tsv', '/' + marker + ' x'),
        ]
        for number, answer in enumerate(answers):
            answer()
            with self.subTest(answer=number), self.assertRaises(fetch.Refused) as refused:
                fetch.download(source, folder, listed, context=self.trusting, port=self.port)
            self.assertNotIn(marker, str(refused.exception))


class Stage(GuardedCase):
    """fetch.py's command line, and the check of a file put there by hand."""

    def lock_with(self, folder, body: bytes, **changes) -> tuple:
        entry = {'id': 'by-hand', 'version': '1', 'licence': 'CC-BY-4.0', 'sha256': hashlib.sha256(body).hexdigest(),
                 'size': len(body), 'kind': 'manual', 'file': 'data.tsv'}  # fmt: skip
        entry.update(changes)
        path = folder / 'lock.json'
        path.write_text(json.dumps({'format': 1, 'sources': [entry]}, indent=2) + '\n', encoding='ascii')
        quarantine = folder / entry['id'] / entry['sha256']
        quarantine.mkdir(parents=True)
        return path, quarantine

    def run_stage(self, *args) -> tuple:
        with quiet() as err:
            code = fetch.main(list(map(str, args)))
        return code, err.getvalue()

    def test_a_file_put_there_by_hand_is_checked(self):
        folder = self.make_temp()
        path, quarantine = self.lock_with(folder, BODY)
        code, err = self.run_stage('--lock', path, '--source', 'by-hand', '--folder', quarantine)
        self.assertEqual(code, 1)
        self.assertIn('put the file there by hand', err)
        (quarantine / 'data.tsv').write_bytes(BODY)
        self.assertEqual(self.run_stage('--lock', path, '--source', 'by-hand', '--folder', quarantine)[0], 0)
        (quarantine / 'data.tsv').write_bytes(BODY + b'x\n')
        code, err = self.run_stage('--lock', path, '--source', 'by-hand', '--folder', quarantine)
        self.assertEqual(code, 1)
        self.assertIn('does not match the lock', err)
        self.assertEqual((quarantine / 'data.tsv').read_bytes(), BODY + b'x\n', 'left as it was')

    def test_a_symbolic_link_put_there_is_refused(self):
        folder = self.make_temp()
        path, quarantine = self.lock_with(folder, BODY)
        (folder / 'elsewhere.tsv').write_bytes(BODY)
        os.symlink(folder / 'elsewhere.tsv', quarantine / 'data.tsv')
        code, err = self.run_stage('--lock', path, '--source', 'by-hand', '--folder', quarantine)
        self.assertEqual(code, 1)
        self.assertIn('symbolic link', err)

    def test_the_folder_must_be_the_sources_own(self):
        folder = self.make_temp()
        path, quarantine = self.lock_with(folder, BODY)
        (quarantine / 'data.tsv').write_bytes(BODY)
        for other in (folder, quarantine.parent, quarantine / 'missing', folder / 'by-hand' / ('b' * 64)):
            with self.subTest(other=other.name):
                self.assertEqual(self.run_stage('--lock', path, '--source', 'by-hand', '--folder', other)[0], 2)

    def test_an_unknown_source_or_a_broken_lock_is_refused(self):
        folder = self.make_temp()
        path, quarantine = self.lock_with(folder, BODY)
        code, err = self.run_stage('--lock', path, '--source', 'other', '--folder', quarantine)
        self.assertEqual(code, 1)
        self.assertIn('has no source other', err)
        path.write_bytes(path.read_bytes()[:-2])
        self.assertEqual(self.run_stage('--lock', path, '--source', 'by-hand', '--folder', quarantine)[0], 1)
        self.assertEqual(self.run_stage('--lock', folder / 'missing.json', '--source', 'by-hand', '--folder', quarantine)[0], 2)
        self.assertEqual(self.run_stage('--source', 'by-hand')[0], 2)

    def test_an_unexpected_error_ends_the_stage_with_a_fixed_message(self):
        folder = self.make_temp()
        path, quarantine = self.lock_with(folder, BODY, kind='https', url=SCHEME + LOCAL + '/data.tsv', type=TYPE)
        marker = 'zqxmarker'

        def broken(*_args):
            raise ValueError(f'invalid literal: {marker}')

        with mock.patch.object(fetch, 'download', broken):
            code, err = self.run_stage('--lock', path, '--source', 'by-hand', '--folder', quarantine)
        self.assertEqual(code, 1)
        self.assertEqual(err, f'fetch: refused: {fetch.UNEXPECTED}\n')
        self.assertNotIn(marker, err)
        self.assertNotIn('Traceback', err)

    def test_the_stages_own_tls_context_checks_certificates_and_host_names(self):
        context = fetch.tls_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)

    def test_without_openssl_the_tests_with_the_server_are_skipped_except_in_ci(self):
        self.assertTrue(skip_without_openssl(None, {}))
        self.assertTrue(skip_without_openssl(None, {'CI': ''}))
        self.assertFalse(skip_without_openssl(None, {'CI': 'true'}), 'in CI the class runs, and fails in setUpClass')
        self.assertFalse(skip_without_openssl('/usr/bin/openssl', {}))

    def test_an_https_source_goes_to_download_with_the_hosts_of_the_lock(self):
        folder = self.make_temp()
        path, quarantine = self.lock_with(folder, BODY, kind='https', url=SCHEME + LOCAL + '/data.tsv', type=TYPE)
        calls = []
        with mock.patch.object(fetch, 'download', lambda source, where, listed: calls.append((source.id, where, listed)) or 'done'):
            code, _err = self.run_stage('--lock', path, '--source', 'by-hand', '--folder', quarantine)
        self.assertEqual(code, 0)
        self.assertEqual(calls, [('by-hand', str(quarantine), frozenset({LOCAL}))])
