# The collector

The collector will turn open data sources into numbers the site can use,
starting with the knowledge areas that occupations ask for (O*NET, see
[sources.md](sources.md)). It lives in `collector/`: Python, the standard
library only, no package to install. Its rule is that nothing from a source
reaches the repository unchecked. Only a small table of codes and whole
numbers, the extract, is ever committed; the raw downloads stay outside the
repository; and every file that enters passes the gate, a closed grammar.

This version is the skeleton: the gate, the canonical writer, `emit`, the
self-test, and a synthetic fixture that the tests run on. It has no network
code and no data from any source, and the site does not read anything it
writes.

## Stages

| Stage | What it does | In this version |
|-------|--------------|-----------------|
| lock | `collector/sources.lock.json`, written by a person: each source with its version, size, sha256 and licence | Only the fixture's lock (`collector/fixtures/synthetic/lock.json`) |
| fetch | Downloads the pinned files into a quarantine folder outside the repository, in a sandbox that allows only that | Planned |
| scan | Reads the raw files without network access and reports, by rule, row and count, anything that looks out of place; never their text | Planned |
| extract | Reduces a raw file to the extract, a table of codes and whole numbers, written by the canonical writer | Planned |
| gate | Checks the extract, the mappings, the lock and the emitted file against their shapes (below) | Yes: `collector/gate.py` |
| emit | Computes the emitted JSON file from the tracked extract, mappings and lock | Yes: `collector/emit.py`, on the fixture |

## Files

```text
collector/run.py        the command line: selftest, gate, emit
collector/shapes.py     the shapes: columns, patterns, lists of values, caps
collector/gate.py       the gate
collector/canon.py      the canonical writer and the strict JSON reader
collector/emit.py       emit, a pure function
collector/selftest.py   the planted samples of the self-test
collector/tests/        unit tests (unittest)
collector/fixtures/synthetic/
                        a made-up set: extract.tsv, professions.tsv,
                        subjects.tsv, lock.json and expected.json, the file
                        that emit must give for them
collector/.python-version   the Python version (3.14)
```

## Shapes

Three tables, tab-separated, with one header line and a line feed at the end
of every line:

| Table | Columns | Key |
|-------|---------|-----|
| extract | `profession`, `soc` (occupation code), `element` (knowledge element), `scale` (`IM` importance or `LV` level), `value` (hundredths: 4.12 is 412; importance 100 to 500, level 0 to 700) | profession, element, scale |
| professions mapping | `profession` (the site's id), `soc`, `title` (the occupation's title, typed by a person) | profession |
| subjects mapping | `element`, `title`, `subject` (one of the site's ten school subjects, or `-` for none) | element |

The extract must have exactly one row per profession of the professions
mapping, element of the subjects mapping and scale. Every column has a pattern
or a closed list of values and a length cap; every table has a cap on rows and
bytes. `collector/shapes.py` holds them all.

The emitted file is JSON: `format`, `inputs` (the source's id, version and
sha256, from the lock) and `professions`, which gives each profession an
`importance` and a `level` per school subject: the highest value among the
knowledge elements that count for that subject. This rule is the skeleton's;
the site does not read the file yet.

## The gate

The gate holds every file to its shape and refuses anything outside it. Each
finding names a rule, the file, the line and the column (the byte in the
line), and at most a description from the shape; it never quotes the file. The
rules:

| Rule | Refuses |
|------|---------|
| `file-size` | A file larger than its cap |
| `bytes` | Any byte that is not printable ASCII, tab or line feed. That keeps out zero-width and bidirectional characters, tag characters, variation selectors, a byte order mark, control characters, carriage returns and every letter outside ASCII, without listing them |
| `forbidden` | `://`, `//`, `@`, `<`, `>`, a backtick or a backslash, anywhere (not in the lock, which will name download addresses) |
| `lines` | An empty file, an empty line, no line feed at the end |
| `row-cap` | More rows than the cap |
| `header` | A first line other than the exact header |
| `columns` | A row with another number of fields |
| `field-length` | A field longer than its cap |
| `field-shape` | A field outside its pattern or list of values |
| `range` | A whole number outside its range |
| `phrase` | In a title: generic phrasing of an embedded instruction, such as asking the reader to set aside what it was told or to show its hidden setup |
| `duplicate-key` | Two rows with the same key |
| `reference` | An extract row naming a profession or element that the mappings lack, or another occupation code than the professions mapping gives; two professions with one occupation code and different titles |
| `rows` | An extract without exactly one row per profession, element and scale |
| `json-syntax` | JSON that is not strict: a syntax error, a duplicate key, a fraction or exponent, NaN or infinity |
| `json-shape` | JSON without the declared keys and types |
| `canonical` | An emitted file that is not in canonical form |

What the gate guarantees: a file that passes holds only what its shape
allows. In the extract that is codes and whole numbers, so nothing in it can
be read as an instruction, an address or markup. Titles are the one place for
words, and there the grammar allows letters, digits, single spaces and the
marks `, ' ( ) -` only.

What it does not guarantee:

- That the numbers are right. A plausible but wrong value passes; pinned
  hashes, range checks and review of the mappings address that, not the gate.
- That a title holds no instruction. The phrase list is a tripwire for the
  obvious cases and for the self-test, not a filter to rely on; the titles are
  typed by a person and reviewed.
- Anything about the raw files: those are the scan stage's (planned).

## Self-test

`run.py gate` and `run.py emit` run the self-test first. It builds a small
clean set, which must pass, and from it planted samples of every rule (an
invisible character, an address, markup, a phrase, a value out of range, a
missing row, JSON with a fraction, and so on), each of which must be refused
by its rule in its file. If the clean set is refused, or one sample is not,
the gate refuses everything and the command exits 3.

The samples are put together at run time from fragments and code points, as
the tests of the check scripts do: no tracked file holds an injection phrase,
an address, markup or one of the invisible characters as text, and a unit
test checks that.

## Determinism

The canonical writer sorts table rows, joins fields with a tab, ends every
line with a line feed; JSON gets sorted keys, two spaces of indent, ASCII only
and a final line feed. There are no fractions, timestamps, paths or host names
in what it writes. `emit` reads nothing but the files it is given, so the same
inputs give the same bytes: the tests run it on shuffled copies of the fixture,
and in child processes with two hash seeds, and compare with the tracked
expected file byte for byte.

## Run it

Python 3.14, the standard library only, isolated from the environment (`-I`:
no environment variables, no user or script folder on the path; `-S`: no
site-packages; `-B`: no bytecode files):

```sh
python3.14 -I -S -B -m unittest discover -s collector/tests -t collector
python3.14 -I -S -B collector/run.py selftest
python3.14 -I -S -B collector/run.py emit --check --set fixture
python3.14 -I -S -B collector/run.py gate --set fixture
```

`emit --check` writes nothing: it compares the file on disk with what its
inputs give and exits 1 when they differ. `emit` without `--check` writes the
file and says where. Exit codes: 0 passed, 1 refused or different, 2 usage or
a file that cannot be read or written, 3 the self-test failed.

The tests write only into temporary folders they make themselves and remove
afterwards. A guard in `collector/tests/__init__.py` makes any other write
fail the test, and each test class compares a listing of the repository before
and after its tests, which also covers child processes.

## In CI

The job **Collector (offline)** runs the unit tests, the self-test and
`emit --check` on Python 3.14 set up by the pinned `actions/setup-python`,
with read access to the repository only and no package installed. No step
fetches a source; setup-python itself may download the Python build from
GitHub when the runner image does not have it. The deploy job needs this job
to pass. What the other jobs check is in [ci.md](ci.md).
