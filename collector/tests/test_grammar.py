"""The grammar of the fields that can carry words, and the phrase list.

The patterns in shapes.py are the gate's guarantee, so each one is pinned here
character by character: every printable ASCII character is tried at each
place in a field (first, inside, after a separator, last), and the characters
it accepts are written out below, not derived from the pattern. The phrase
list is pinned by its length and by one sample per entry, built at run time
from the entry's own fragments with other words put between its words.
"""

import re

import gate
import selftest
import shapes
from tests import FIXTURE, REPO, GuardedCase

PRINTABLE = [chr(code) for code in range(0x20, 0x7F)]
UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
LOWER = 'abcdefghijklmnopqrstuvwxyz'
DIGITS = '0123456789'
ALNUM = DIGITS + UPPER + LOWER

# The characters each pattern accepts at each place, in code point order.
EXPECTED = {
    'TITLE': [
        ('first', lambda c: c + 'ab', UPPER),
        ('inside', lambda c: 'Ab' + c + 'cd', " '(),-" + ALNUM),
        ('after a space', lambda c: 'Ab ' + c + 'd', "'(),-" + ALNUM),
        ('last', lambda c: 'Ab' + c, "'(),-" + ALNUM),
    ],
    'PROFESSION_ID': [
        ('first', lambda c: c + 'ab', LOWER),
        ('inside', lambda c: 'ab' + c + 'cd', '-' + DIGITS + LOWER),
        ('after a hyphen', lambda c: 'ab-' + c + 'd', DIGITS + LOWER),
        ('last', lambda c: 'ab' + c, DIGITS + LOWER),
    ],
    'VERSION': [
        ('first', lambda c: c + '1', ALNUM),
        ('inside', lambda c: '1' + c + '2', '.' + ALNUM),
        ('after a full stop', lambda c: '1.' + c + '2', ALNUM),
        ('last', lambda c: '1' + c, ALNUM),
    ],
    'LICENCE': [
        ('first', lambda c: c + 'A', ALNUM),
        ('inside', lambda c: 'A' + c + 'B', '-.' + ALNUM),
        ('after a hyphen', lambda c: 'A-' + c + 'B', ALNUM),
        ('after a full stop', lambda c: 'A.' + c + 'B', ALNUM),
        ('last', lambda c: 'A' + c, ALNUM),
    ],
}
EXPECTED['SOURCE_ID'] = EXPECTED['PROFESSION_ID']

# The phrase list has this many entries; removing one must be a deliberate change here too.
PHRASE_COUNT = 22


def accepted(pattern: str, make) -> str:
    return ''.join(c for c in PRINTABLE if gate._fullmatch(pattern, make(c)))


def professions_table(rows) -> bytes:
    return selftest.table(shapes.PROFESSIONS, rows)


class Grammar(GuardedCase):
    def test_each_pattern_accepts_exactly_the_written_characters_at_each_place(self):
        for name, places in EXPECTED.items():
            pattern = getattr(shapes, name)
            for place, make, expected in places:
                with self.subTest(pattern=name, place=place):
                    self.assertEqual(accepted(pattern, make), expected)

    def test_the_gate_applies_these_patterns_to_these_columns(self):
        columns = {(shape.role, c.name): c for shape in (shapes.EXTRACT, shapes.PROFESSIONS, shapes.SUBJECTS) for c in shape.columns}
        self.assertEqual(columns[('professions', 'title')].pattern, shapes.TITLE)
        self.assertEqual(columns[('subjects', 'title')].pattern, shapes.TITLE)
        self.assertEqual(columns[('professions', 'profession')].pattern, shapes.PROFESSION_ID)
        self.assertEqual(columns[('extract', 'profession')].pattern, shapes.PROFESSION_ID)
        # Every column that can carry words gets the phrase rule; no other does.
        self.assertEqual(
            sorted(key for key, column in columns.items() if column.words),
            [('extract', 'profession'), ('professions', 'profession'), ('professions', 'title'), ('subjects', 'title')],
        )


class Phrases(GuardedCase):
    def test_the_list_has_its_entries(self):
        self.assertEqual(len(gate.PHRASES), PHRASE_COUNT)
        self.assertEqual(len(set(gate.PHRASES)), PHRASE_COUNT)

    def test_each_entry_is_refused_with_up_to_three_words_between_its_words(self):
        for entry in gate.PHRASES:
            words = selftest.phrase_words(entry)
            for between in (0, 1, 3):
                spread = selftest.spread(words, between)
                title = ' '.join(word.capitalize() for word in spread)
                identifier = '-'.join(spread)
                with self.subTest(entry=entry.replace('|', ' '), between=between):
                    self.assertTrue(gate.has_phrase(title))
                    self.assertTrue(gate.has_phrase(identifier))
                    rows = [('fixture-alpha', '99-0001.00', title)]
                    found = gate.check_table(professions_table(rows), shapes.PROFESSIONS, 'professions').findings
                    self.assertEqual([(f.rule, f.line, f.column) for f in found], [('phrase', 2, 26)])
                    if len(identifier) <= 40:
                        found = gate.check_table(professions_table([(identifier, '99-0001.00', 'Test')]), shapes.PROFESSIONS, 'professions').findings
                        self.assertEqual([(f.rule, f.line, f.column) for f in found], [('phrase', 2, 1)])

    def test_four_words_between_are_too_many(self):
        for entry in gate.PHRASES:
            words = selftest.phrase_words(entry)
            if len(words) < 2:
                continue
            with self.subTest(entry=entry.replace('|', ' ')):
                self.assertFalse(gate.has_phrase(' '.join(selftest.spread(words, 4))))

    def test_the_sites_profession_ids_pass(self):
        professions = (REPO / 'src' / 'data' / 'professions.ts').read_text(encoding='utf-8')
        ids = re.findall(r"^\s+id: '([a-z0-9-]+)',$", professions, re.M)
        self.assertEqual(len(ids), 36)
        rows = [(profession, '99-0001.00', 'Test') for profession in ids]
        self.assertEqual(gate.check_table(professions_table(rows), shapes.PROFESSIONS, 'professions').findings, [])

    def test_ids_versions_and_licences_with_words_near_the_phrases_pass(self):
        # In this order the file itself trips no entry: the test of the layout reads it whole.
        ids = ['prompt-book-editor', 'dental-assistant', 'new-media-designer', 'instructional-designer', 'software-developer',
               'break-dancer', 'model-maker', 'you-and-now', 'language-teacher', 'system-analyst']  # fmt: skip
        rows = [(profession, '99-0001.00', 'Test') for profession in ids]
        self.assertEqual(gate.check_table(professions_table(rows), shapes.PROFESSIONS, 'professions').findings, [])
        lock = (FIXTURE / 'lock.json').read_bytes()
        for version, licence in (('30.0', 'CC-BY-4.0'), ('1.2.1', 'EUPL-1.2'), ('2024.11', 'OGL-UK-3.0'), ('v1', 'CC0-1.0')):
            with self.subTest(version=version, licence=licence):
                changed = lock.replace(b'"version": "1"', f'"version": "{version}"'.encode('ascii'))
                changed = changed.replace(b'"licence": "MIT"', f'"licence": "{licence}"'.encode('ascii'))
                self.assertNotEqual(changed, lock)
                self.assertEqual(gate.check_lock(changed), [])
