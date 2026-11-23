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
code and no data from any source. `emit` also writes the file the site will
read, `src/data/sourced.json`; with no source collected yet that file is
empty (no source, no weights), and no page reads it.

## Stages

| Stage | What it does | In this version |
|-------|--------------|-----------------|
| lock | `collector/sources.lock.json`, written by a person: each source with its version, size, sha256 and licence | Only the fixture's lock (`collector/fixtures/synthetic/lock.json`) |
| fetch | Downloads the pinned files into a quarantine folder outside the repository, in a sandbox that allows only that | Planned |
| scan | Reads the raw files without network access and reports, by rule, row and count, anything that looks out of place; never their text | Planned |
| extract | Reduces a raw file to the extract, a table of codes and whole numbers, written by the canonical writer | Planned |
| gate | Checks the extract, the mappings, the lock and the emitted file against their shapes (below) | Yes: `collector/gate.py` |
| emit | Computes the emitted JSON file from the tracked extract, mappings and lock | Yes: `collector/emit.py`, on the fixture, and the site's file, empty while the site's set has no inputs |

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
src/data/sourced.json   the emitted file the site reads (the set `site`);
                        empty in this version
scripts/check-data.mjs  the second check of the emitted files, in Node
                        (+ test)
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
the site does not read the file yet. `inputs` may be empty only together
with `professions`: that is the empty file, which a set without inputs
gives, and no weight stands in the file without a source.

Two named sets give the paths (`--set`): `fixture`, the synthetic fixture,
and `site`, whose emitted file is `src/data/sourced.json`. The site's set has
no inputs until the first source is collected, so `emit` gives it the empty
file:

```json
{
  "format": 1,
  "inputs": [],
  "professions": {}
}
```

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
| `phrase` | In a field that can carry words (a title, a profession or source id, a version, a licence): generic phrasing of an embedded instruction, such as asking the reader to set aside what it was told or to show its hidden setup, also with words joined by hyphens or full stops |
| `duplicate-key` | Two rows with the same key |
| `reference` | An extract row naming a profession or element that the mappings lack, or another occupation code than the professions mapping gives; two professions with one occupation code and different titles |
| `rows` | An extract without exactly one row per profession, element and scale |
| `json-syntax` | JSON that is not strict: a syntax error, a duplicate key, a fraction or exponent, NaN or infinity |
| `json-shape` | JSON without the declared keys and types; an emitted file with weights but no source in `inputs` |
| `canonical` | An emitted file that is not in canonical form |

What the gate guarantees: a file that passes holds only what its shape
allows, and nowhere an address, markup or a character outside printable
ASCII. Words can stand in two kinds of field. Titles allow letters, digits,
single spaces and the marks `, ' ( ) -`. Identifiers allow words joined
without spaces: a profession or source id (up to 40 characters: lower-case
letters and digits, joined by single hyphens), a version (letters and digits
joined by full stops) and a licence (letters and digits joined by full stops
or hyphens). Every other field is a code or a whole number. The extract
holds a profession id and otherwise codes and whole numbers.

What it does not guarantee:

- That the numbers are right. A plausible but wrong value passes; pinned
  hashes, range checks and review of the mappings address that, not the gate.
- That a title or an identifier holds no instruction. The phrase list, which
  every such field gets, is a tripwire for the obvious cases and for the
  self-test, not a filter to rely on; titles and ids are typed by a person and
  reviewed.
- Anything about the raw files: those are the scan stage's (planned).

## Self-test

`run.py gate` and `run.py emit` run the self-test first. It builds a small
clean set, which must pass, and from it planted samples of every rule (an
invisible character, an address, markup, a phrase, a value out of range, a
missing row, JSON with a fraction, and so on), and one sample per entry of
the phrase list with a word put between its words. Each must be refused by its
rule in its file. If the clean set is refused, or one sample is not,
the gate refuses everything and the command exits 3.

The samples are put together at run time from fragments and code points, as
the tests of the check scripts do: no tracked file holds an injection phrase,
an address, markup or one of the invisible characters as text, and a unit
test checks that.

## The second check

`scripts/check-data.mjs` (`npm run check:data`) checks the emitted files
again: the `out` of each named set, `src/data/sourced.json` and the fixture's
`expected.json`. It is written apart from the gate, in Node and without a
JSON library, so that a mistake in the gate is not made a second time there.
It runs in CI's audit job, which installs no dependencies and is a required
check: a file that the gate let through by mistake still does not reach
`main` or the site.

It holds a file to the same grammar, with the same rule ids: `file-size`,
`bytes`, `forbidden`, `lines`, `row-cap`, `field-length`, `field-shape`,
`range`, `phrase`, `duplicate-key`, `json-syntax`, `json-shape` and
`canonical` (the rules for tables have no part in a JSON file). Its own
strict JSON reader keeps where each value starts, so every finding names the
line and the column of the value, where the gate names line 0 for a place
inside the JSON. Like the gate's, its findings never quote the file. Exit
codes: 0 passed, 1 refused, 2 a file could not be read or the arguments are
wrong.

How the two are held together:

- The grammar's values are written in both: the subjects, the ranges, the
  caps, the patterns, the phrase list, the forbidden sequences, the keys and
  the rule ids. `scripts/check-data.test.mjs` reads `collector/shapes.py`,
  `gate.py` and `canon.py` and fails when one of them differs, and when the
  list of files it checks is not the `out` of every named set in `run.py`. A
  change to the grammar is therefore a change to both, in one pull request.
- The code that applies them is separate: the byte scan, the JSON reader,
  the walk over the shape, the canonical writer and the phrase matcher.
- Both accept the fixture and the site's file, and each side's tests plant
  their own samples to refuse: the Node test one or more of every rule, each
  at its line and column, and one per entry of the phrase list.

Where they can still differ:

- On a sample that neither side's tests plant: no test runs the gate's
  samples through this check, or the other way round.
- On nesting deeper than 512 levels: this check stops reading with
  `json-syntax`, while the gate's reader reads on and refuses with
  `json-shape` and `canonical`. Both refuse; only the rule differs.

What it does not do: it does not check the tables (the extract and the
mappings) or the lock, which the gate checks, and it has no self-test at run
time, as the gate has: its planted samples run with the unit tests.

## Determinism

The canonical writer sorts table rows, joins fields with a tab, ends every
line with a line feed; JSON gets sorted keys, two spaces of indent, ASCII only
and a final line feed. There are no fractions, timestamps, paths or host names
in what it writes. `emit` reads nothing but the files it is given, so the same
inputs give the same bytes: the tests run it on shuffled copies of the fixture,
and in child processes with two hash seeds, and compare with the tracked
expected file byte for byte.

## Run it

Python 3.14, the standard library only. `-I` makes Python ignore its own
environment variables (those starting with `PYTHON`) and keeps the user's
site-packages and the script's folder off the path; other variables, such as
`TMPDIR`, `HOME` or the locale (`LC_*`, `LANG`), are still read. `-S`: no
site-packages; `-B`: no bytecode files.

```sh
python3.14 -I -S -B -m unittest discover -s collector/tests -t collector
python3.14 -I -S -B collector/run.py selftest
python3.14 -I -S -B collector/run.py emit --check --set fixture
python3.14 -I -S -B collector/run.py emit --check --set site
python3.14 -I -S -B collector/run.py gate --set fixture
```

`emit --check` writes nothing: it compares the file on disk with what its
inputs give and exits 1 when they differ, by as little as one byte. `emit`
without `--check` writes the file and says where. `gate --set site` checks
the emitted file alone, since the set has no inputs. Exit codes: 0 passed, 1
refused or different, 2 usage or a file that cannot be read or written, 3 the
self-test failed. The second check runs with Node from the repository's root
folder: `npm run check:data`.

The tests write only into temporary folders they make themselves and remove
afterwards. Two checks in `collector/tests/__init__.py` hold them to that:

- In the test's own process, a guard fails the test on any write outside
  those folders through `open` (also `io.open` and `_io.open`), `io.FileIO`
  (also `_io.FileIO`), `os.open` with a flag that writes, or the `os`
  functions that create, change or remove files (`mkdir`, `rmdir`, `remove`,
  `unlink`, `truncate`, `chmod`, `chown`, `utime`, `mkfifo`, `mknod`,
  `rename`, `replace`, `link`, `symlink`, and where the system has them
  `chflags`, `lchflags`, `lchmod`, `lchown`), and so through what is built on
  them (`pathlib`, `os.makedirs`, `shutil`). It does not see a write through
  a file descriptor opened before the test, or code that reaches the system
  some other way (a C extension). A unit test tries each of these ways.
- For child processes, each test class compares a listing of the
  repository's files (path, size, modification time) before its first test
  and after its last. The listing skips `.git`, `node_modules`, `dist`,
  `__pycache__` and the other ignored output folders, so a child process that
  writes there goes unnoticed.

## In CI

The job **Collector (offline)** runs the unit tests, the self-test and
`emit --check` on both sets, on Python 3.14 set up by the pinned
`actions/setup-python`, with read access to the repository only and no
package installed. No step fetches a source; setup-python itself may
download the Python build from GitHub when the runner image does not have
it. The deploy job needs this job to pass. The audit job, which installs no
dependencies, runs the second check, `npm run check:data`, on the emitted
files. What the other jobs check is in [ci.md](ci.md).
