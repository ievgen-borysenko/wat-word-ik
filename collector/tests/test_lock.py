"""The lock as the fetch stage reads it (lock.py): every key in its shape, the
gate's rules on the keys it shares with the gate, and errors that never quote
the lock."""

import json

import lock
import selftest
from tests import GuardedCase

SHA = 'a' * 64
# Put together at run time, like every address in the collector's tests.
SCHEME = 'https' + selftest.COLON + selftest.SLASH * 2
HOST = 'data' + '.' + selftest.HOST


def https(**changes) -> dict:
    entry = {'id': 'web-source', 'version': '30.0', 'licence': 'CC-BY-4.0', 'sha256': SHA, 'size': 12,
             'kind': 'https', 'file': 'db_30_0_text.zip', 'url': SCHEME + HOST + '/dl/db_30_0_text.zip',
             'type': 'application/zip'}  # fmt: skip
    entry.update(changes)
    return {k: v for k, v in entry.items() if v is not None}


def manual(**changes) -> dict:
    entry = {'id': 'by-hand', 'version': '1', 'licence': 'CC-BY-4.0', 'sha256': SHA, 'size': 3, 'kind': 'manual', 'file': 'table.xml'}
    entry.update(changes)
    return {k: v for k, v in entry.items() if v is not None}


def data(*sources, **top) -> bytes:
    document = {'format': 1, 'sources': list(sources)}
    document.update(top)
    return (json.dumps(document, indent=2, sort_keys=True) + '\n').encode('ascii')


class Lock(GuardedCase):
    def test_an_https_and_a_manual_source_are_read(self):
        sources = lock.read(data(https(), manual()))
        self.assertEqual([s.id for s in sources], ['web-source', 'by-hand'])
        web = lock.find(sources, 'web-source')
        self.assertEqual((web.kind, web.host, web.target, web.type, web.size), ('https', HOST, '/dl/db_30_0_text.zip', 'application/zip', 12))
        hand = lock.find(sources, 'by-hand')
        self.assertEqual((hand.kind, hand.url, hand.host, hand.file), ('manual', '', '', 'table.xml'))
        self.assertEqual(lock.hosts(sources), frozenset({HOST}))

    def test_a_url_without_a_path_or_with_a_query_is_read(self):
        self.assertEqual(lock.find(lock.read(data(https(url=SCHEME + HOST))), 'web-source').target, '/')
        self.assertEqual(lock.find(lock.read(data(https(url=SCHEME + HOST + '/get?id=7&v=2'))), 'web-source').target, '/get?id=7&v=2')

    def test_a_url_outside_the_grammar_is_refused(self):
        refused = {
            'http': 'http' + selftest.COLON + selftest.SLASH * 2 + HOST + '/x',
            'a port': SCHEME + HOST + selftest.COLON + '8443/x',
            'a user name': SCHEME + 'user' + selftest.AT + HOST + '/x',
            'a fragment': SCHEME + HOST + '/x#part',
            'an address literal': SCHEME + '[' + selftest.COLON * 2 + '1]/x',
            'an upper-case host': SCHEME + HOST.upper() + '/x',
            'a space': SCHEME + HOST + '/a b',
            'a backslash': SCHEME + HOST + '/a' + selftest.BACKSLASH + 'b',
            'no host': SCHEME + '/x',
            'too long': SCHEME + HOST + '/' + 'a' * lock.URL_MAX,
        }
        for name, url in refused.items():
            with self.subTest(name), self.assertRaisesRegex(lock.LockError, r'sources\[1\]\.url'):
                lock.read(data(https(url=url)))

    def test_every_key_is_held_to_its_shape(self):
        cases = {
            'unknown kind': https(kind='ftp'),
            'no kind': https(kind=None),
            'a manual source with a url': manual(url=SCHEME + HOST + '/x'),
            'an https source without a type': https(type=None),
            'an https source without a url': https(url=None),
            'an extra key': https(mirror='x'),
            'a web page type': https(type='text/html'),
            'another web page type': https(type='application/xhtml+xml'),
            'a malformed type': https(type='application'),
            'a file name with a slash': https(file='a/b.zip'),
            'a file name that starts with a full stop': https(file='.hidden'),
            'the parent folder as a file name': https(file='..'),
            'a file name that is too long': https(file='a' * (lock.FILE_MAX + 1)),
            'a file name that is a number': https(file=7),
        }
        for name, entry in cases.items():
            with self.subTest(name), self.assertRaises(lock.LockError):
                lock.read(data(entry))

    def test_the_gate_checks_the_keys_it_shares_with_the_lock(self):
        cases = {
            'malformed sha256': (https(sha256='A' * 64), 'field-shape'),
            'negative size': (https(size=-1), 'range'),
            'an instruction as a version': (https(version='ign' + 'ore.pre' + 'vious'), 'phrase'),
            'the same id twice': (None, 'duplicate-key'),
            'no size': (https(size=None), 'json-shape'),
        }
        for name, (entry, rule) in cases.items():
            sources = [https(), https()] if entry is None else [entry]
            with self.subTest(name), self.assertRaisesRegex(lock.LockError, rf'the gate refuses the lock .*\b{rule}\b'):
                lock.read(data(*sources))

    def test_the_file_itself_is_held_to_strict_ascii_json(self):
        good = data(https())
        cases = {
            'no line feed at the end': good[:-1],
            'a carriage return': good.replace(b'\n', b'\r\n'),
            'a byte outside ASCII': good.replace(b'30.0', '30.0'.encode('ascii') + chr(0xE9).encode('utf-8')),
            'a key twice': good.replace(b'"format": 1', b'"format": 1,\n  "format": 1'),
            'a fraction': good.replace(b'"size": 12', b'"size": 12.0'),
            'a syntax error': good.replace(b'"format"', b'format'),
            'another format': data(https(), format=2),
            'another top-level key': data(https(), note='x'),
            'sources that are not a list': b'{"format": 1, "sources": {}}\n',
            'a source that is not an object': b'{"format": 1, "sources": [1]}\n',
            'larger than the cap': good + b' ' * 20_000,
        }
        for name, text in cases.items():
            with self.subTest(name), self.assertRaises(lock.LockError):
                lock.read(text)

    def test_find_refuses_an_unknown_or_malformed_id(self):
        sources = lock.read(data(https()))
        with self.assertRaisesRegex(lock.LockError, 'has no source other-source'):
            lock.find(sources, 'other-source')
        for bad in ('Web-Source', 'web source', '', 'a' * 41, '../x'):
            with self.subTest(bad), self.assertRaisesRegex(lock.LockError, 'not in its shape'):
                lock.find(sources, bad)

    def test_errors_never_quote_the_lock(self):
        marker = 'zqxmarker'
        for entry in (https(url=SCHEME + HOST + '/' + marker + ' x'), https(type=marker), https(file=marker + '/x'), https(kind=marker)):
            with self.subTest(entry=sorted(entry.items())[3:5]), self.assertRaises(lock.LockError) as refused:
                lock.read(data(entry))
            self.assertNotIn(marker, str(refused.exception))
