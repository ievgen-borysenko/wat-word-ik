"""The declared shape of every file the collector lets into the repository.

A shape is a closed grammar: the exact header, the columns, a pattern or a
closed list of values for each column, integer ranges, a length cap per field
and caps on rows and bytes. The gate (gate.py) refuses anything outside it.
This module holds no data from any source, only the grammar.

Three tables, tab-separated, one header line, LF line ends:

  extract              profession, soc, element, scale, value
                       one row per profession, knowledge element and scale;
                       value in hundredths (4.12 is 412)
  professions mapping  profession, soc, title
                       the site's profession id, its occupation code and the
                       occupation title as a person typed it
  subjects mapping     element, title, subject
                       a knowledge element, its title as a person typed it,
                       and the school subject it counts for (NOT_MAPPED: none)

Two JSON files: the emitted file (emit.py) and the lock (sources and their
pinned hashes). Their shapes are checked in gate.py with the patterns below.
"""

from dataclasses import dataclass

# The site's school subjects, in the order of SUBJECT_IDS in
# src/engine/types.ts; tests/test_layout.py reads that file and compares.
SUBJECT_IDS = (
    'wiskunde',
    'natuurkunde',
    'scheikunde',
    'biologie',
    'nederlands',
    'engels',
    'geschiedenis',
    'aardrijkskunde',
    'techniek',
    'kunst',
)

# A knowledge element that counts for no school subject.
NOT_MAPPED = '-'

# Importance (1.00 to 5.00) and level (0.00 to 7.00), in hundredths.
SCALE_RANGES = {'IM': (100, 500), 'LV': (0, 700)}
SCALES = tuple(sorted(SCALE_RANGES))

# Patterns, matched against the whole field.
PROFESSION_ID = r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*'
# An occupation code: two digits, a hyphen, four digits, a full stop, two digits.
SOC = r'[0-9]{2}-[0-9]{4}\.[0-9]{2}'
# A knowledge element of the occupation content model: 2.C, then a number
# from 1 to 99 and an optional lower-case letter.
ELEMENT = r'2\.C\.[1-9][0-9]?(?:\.[a-z])?'
# A non-negative integer without leading zeros.
INTEGER = r'0|[1-9][0-9]*'
# A title: words of letters, digits and the marks , ' ( ) - separated by
# single spaces, starting with a capital letter.
TITLE = r"[A-Z][A-Za-z0-9,'()-]*(?: [A-Za-z0-9,'()-]+)*"
SOURCE_ID = PROFESSION_ID
VERSION = r'[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*'
SHA256 = r'[0-9a-f]{64}'
LICENCE = r'[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*'

# Length caps of the JSON values that are not table fields.
SOURCE_ID_MAX = 40
VERSION_MAX = 20
LICENCE_MAX = 40


@dataclass(frozen=True)
class Column:
    """One column: its header name, a length cap and exactly one of a
    pattern or a closed list of values."""

    name: str
    max_len: int
    pattern: str | None = None
    values: tuple[str, ...] | None = None
    # Free text a person typed: also checked for embedded instructions.
    free_text: bool = False
    # An integer whose range is SCALE_RANGES of the row's `scale` field.
    scaled: bool = False


@dataclass(frozen=True)
class TableShape:
    """A table: its columns in order, the columns that make a row's key
    (unique), and caps on data rows and on bytes."""

    role: str
    columns: tuple[Column, ...]
    key: tuple[str, ...]
    max_rows: int
    max_bytes: int

    @property
    def header(self) -> str:
        return '\t'.join(c.name for c in self.columns)

    def index(self, name: str) -> int:
        return [c.name for c in self.columns].index(name)


EXTRACT = TableShape(
    role='extract',
    columns=(
        Column('profession', 40, pattern=PROFESSION_ID),
        Column('soc', 10, pattern=SOC),
        Column('element', 8, pattern=ELEMENT),
        Column('scale', 2, values=SCALES),
        Column('value', 3, pattern=INTEGER, scaled=True),
    ),
    key=('profession', 'element', 'scale'),
    # 150 professions x 33 knowledge elements x 2 scales is 9,900 rows.
    max_rows=12_000,
    max_bytes=1_000_000,
)

PROFESSIONS = TableShape(
    role='professions',
    columns=(
        Column('profession', 40, pattern=PROFESSION_ID),
        Column('soc', 10, pattern=SOC),
        Column('title', 100, pattern=TITLE, free_text=True),
    ),
    key=('profession',),
    max_rows=200,
    max_bytes=40_000,
)

SUBJECTS = TableShape(
    role='subjects',
    columns=(
        Column('element', 8, pattern=ELEMENT),
        Column('title', 100, pattern=TITLE, free_text=True),
        Column('subject', 14, values=SUBJECT_IDS + (NOT_MAPPED,)),
    ),
    key=('element',),
    max_rows=64,
    max_bytes=10_000,
)

# The emitted JSON file and the lock.
EMITTED_MAX_BYTES = 300_000
EMITTED_MAX_PROFESSIONS = PROFESSIONS.max_rows
LOCK_MAX_BYTES = 20_000
MAX_SOURCES = 16
# The largest raw file a lock may pin, in bytes.
MAX_SOURCE_SIZE = 2_000_000_000
FORMAT = 1

# The name of each scale's weight in the emitted file.
WEIGHT_NAMES = {'IM': 'importance', 'LV': 'level'}
