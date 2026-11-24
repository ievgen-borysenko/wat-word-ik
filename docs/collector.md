# The collector

The collector will turn open data sources into numbers the site can use,
starting with the knowledge areas that occupations ask for (O*NET, see
[sources.md](sources.md)). It lives in `collector/`: Python, the standard
library only, no package to install. Its rule is that nothing from a source
reaches the repository unchecked. Only a small table of codes and whole
numbers, the extract, is ever committed; the raw downloads stay outside the
repository; and every file that enters passes the gate, a closed grammar.

This version has the gate, the canonical writer, `emit`, the self-test, a
synthetic fixture that the tests run on, and the fetch stage with its
sandbox: two sandbox profiles, the probe that checks them before every run,
and the launcher that runs a stage in them. It has no data from any source:
no lock names a source to fetch, and nothing was fetched. `emit` also writes
the file the site will read, `src/data/sourced.json`; with no source
collected yet that file is empty (no source, no weights), and no page reads
it.

## Stages

| Stage | What it does | In this version |
|-------|--------------|-----------------|
| lock | `collector/sources.lock.json`, written by a person: each source with its version, size, sha256 and licence, and for fetch where it is | Only the fixture's lock (`collector/fixtures/synthetic/lock.json`); no lock with a source to fetch |
| fetch | Downloads a pinned file into a quarantine folder outside the repository, in a sandbox that allows only that, or checks one put there by hand | Yes: `collector/fetch.py`, started by `collector/sandboxed.py` in `collector/sandbox/fetch.sb` (or `offline.sb` for a file put there by hand); nothing fetched yet |
| scan | Reads the raw files without network access and reports, by rule, row and count, anything that looks out of place; never their text | Planned |
| extract | Reduces a raw file to the extract, a table of codes and whole numbers, written by the canonical writer | Planned |
| gate | Checks the extract, the mappings, the lock and the emitted file against their shapes (below) | Yes: `collector/gate.py` |
| emit | Computes the emitted JSON file from the tracked extract, mappings and lock | Yes: `collector/emit.py`, on the fixture, and the site's file, empty while the site's set has no inputs |

## Files

```text
collector/run.py        the command line: selftest, gate, emit, probe, fetch
collector/shapes.py     the shapes: columns, patterns, lists of values, caps
collector/gate.py       the gate
collector/canon.py      the canonical writer and the strict JSON reader
collector/emit.py       emit, a pure function
collector/selftest.py   the planted samples of the self-test
collector/lock.py       the lock as the fetch stage reads it
collector/fetch.py      the fetch stage, run in the sandbox
collector/sandboxed.py  the launcher: runs a stage in a sandbox after a probe
collector/probe.py      the probe, run in the sandbox before every stage
collector/sandbox/fetch.sb, offline.sb
                        the two sandbox profiles (sandbox-exec, macOS)
collector/tests/        unit tests (unittest)
collector/fixtures/synthetic/
                        a made-up set: extract.tsv, professions.tsv,
                        subjects.tsv, lock.json and expected.json, the file
                        that emit must give for them
collector/.python-version   the Python version (3.14)
src/data/sourced.json   the emitted file the site will read (the set
                        `site`); empty in this version
src/data/sourced.ts     its typed loader, which no page imports yet (+ test)
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
- On the rule for deep nesting. This check reads a value at most 512 levels
  below the top level and stops deeper with `json-syntax`. The gate's reader
  reads on, and the gate refuses such a file with `json-shape` and
  `canonical`, up to Python's recursion limit (it depends on the machine:
  about 116,000 levels where this was measured); past that limit the gate
  refuses with `json-syntax` too. So the rule names differ only between those
  two depths, and both refuse at every depth past 512.
- On where a `json-syntax` finding points. The gate names line 0 for a key
  that appears twice, a fraction or an exponent, NaN or infinity, an integer
  with too many digits and nesting past Python's recursion limit, where this
  check names the place. Where both name a place, they can point at
  different characters of the same error: a file that starts with a lone
  minus sign is refused at 1:1 by the gate, where the value starts, and at
  1:2 here, where a digit was expected.

Neither of the last two changes whether a file is refused: only the rule or
the place that a finding names differs.

What it does not do: it does not check the tables (the extract and the
mappings) or the lock, which the gate checks; it does not compare the file
with the site's own data (that each profession exists), which the data test
`src/data/sourced.test.ts` does; and it has no self-test at run time, as the
gate has: its planted samples run with the unit tests.

## Fetch

The fetch stage puts one source of the lock into its quarantine folder,
`QUARANTINE/<id>/<sha256>/<file>`, outside the repository, and checks that the
file has the size and sha256 the lock pins. It parses nothing. It runs only in
a sandbox, as a child process that the launcher starts after a probe.

### The lock entry

Every source has the five keys of the gate's lock shape (`id`, `version`,
`licence`, `sha256`, `size`) and these, which `collector/lock.py` reads:

| Key | What |
|-----|------|
| `kind` | `https`: the stage downloads the file; `manual`: a person puts it into the quarantine folder by hand, and the stage only checks its size and sha256 |
| `file` | The name the file gets in the quarantine folder: letters, digits, `.`, `-`, `_`, starting with a letter or digit, at most 100 characters |
| `url` | (`https` only) `https`, a host name in lower case, a path and an optional query; no port, no user name, no fragment |
| `type` | (`https` only) the media type the server must give, such as `application/zip`; never an HTML type |

The gate checks the five shared keys, with its own rules, on a copy of the
lock that holds only them; `lock.py` checks the rest, and its errors never
quote the lock. The gate's lock shape does not have the four keys yet, so a
lock that holds them passes the fetch stage but not `run.py gate` or `emit`:
the pull request that adds the first source extends the gate's lock shape
(and the self-test's samples for it) to them. Until then no tracked lock
names a source to fetch.

### What the stage does

For an `https` source (`collector/fetch.py`):

- HTTPS only, with the certificate check of the interpreter's TLS, to port
  443 only. The first request goes to the lock's URL.
- A redirect is followed at most 5 times, only on the same host and only over
  HTTPS. A redirect to `http`, to a host the lock does not list, or to another
  host that the lock does list (cross-host redirects are refused) ends the
  stage; so does an address outside the lock's grammar.
- A generic user agent, `Python/3.14`: nothing about the person or the
  project. No cookies, no proxy, no compression (`Accept-Encoding: identity`).
- Refused: a status other than 200, a content type other than the lock's, an
  HTML content type, a body that starts like a web page, an encoded body
  (`Content-Encoding`), an announced length other than the lock's size, a body
  larger than that size (refused while it arrives, so at most the size and one
  chunk of 64 KiB are read), a body of another size or sha256, and no answer
  within 60 s. A challenge page or a page that asks for a person is refused
  this way and never worked around: such a source becomes `manual`.
- The body is written under a temporary name, renamed to `file` only when
  size and sha256 match, and made read-only; a refused body is removed. A
  file that is already there is checked the same way and not fetched again;
  if it does not match the lock, it is left as it is and the stage says so.

For a `manual` source the stage only checks the file that a person put at
`QUARANTINE/<id>/<sha256>/<file>`: its size and sha256, and that it is a file,
not a symbolic link. It needs no network, so it runs in the offline profile.

Messages never quote what a server sent: they name the rule, and at most
numbers and the lock's own values. An error that no rule expects ends the
stage with exit 1 and a fixed message, without the error's text or a
traceback, which could quote it.

### Run it

On macOS, from the repository's root folder, once a reviewed lock entry
exists and the download is approved:

```sh
python3.14 -I -S -B collector/run.py probe --profile fetch     # optional: the probe alone
python3.14 -I -S -B collector/run.py fetch --source <id>
```

`--lock` names another lock (default `collector/sources.lock.json`, which this
version does not have), `--quarantine` another root for the quarantine
(default `~/dev/_quarantine/wat-word-ik`). The root must be outside the
repository and outside the folders macOS syncs (iCloud Drive under
`~/Library/Mobile Documents`, cloud storage under `~/Library/CloudStorage`);
other synced folders are not recognised, so do not choose one. For a manual
source, put the file into the folder the first run names, then run the same
command again.

Exit codes: 0 the file is in the quarantine and matches the lock; 1 refused
(the lock entry, a rule above, a size or hash that differs, no connection);
2 usage, or a file that cannot be read or written; 3 the gate's self-test
failed; 4 no sandbox: `sandbox-exec` is missing (any system but macOS), the
profile does not load, or the probe did not observe what the profile
promises, and the stage did not run. Exit 4 is never worked around: no flag
runs a stage without the sandbox. If an update of macOS breaks the profiles,
the probe says which observation differs; the way out is a fixed profile in a
reviewed pull request, or a virtual machine (an owner decision).

The first pin of a source is trust on first use: its size and sha256 come
from a download that the owner made and checked by hand. A second download,
from another network, before the pin is written lowers that risk.

On a machine with an outbound firewall that decides per program, the first
fetch can wait for its answer and then time out. The program is the
interpreter binary that the launcher starts: for a macOS framework build the
one inside the framework (`Resources/Python.app/Contents/MacOS/Python` in the
interpreter's home folder), not `python3.14` on the path.

### The launcher

`collector/sandboxed.py` runs every stage as a child process:

- under `sandbox-exec -f collector/sandbox/<profile>.sb`, deny by default,
  with every path as a `-D` parameter, a real path worked out at run time:
  the profiles name no path of their own;
- with an empty environment: the launcher passes no variable at all. Inside,
  the child sees only what the interpreter and the system set themselves:
  `LC_CTYPE` (Python's coercion of the C locale) and, on macOS,
  `__CF_USER_TEXT_ENCODING`; the probe fails on any other;
- as `python3.14 -I -S -B`, the same interpreter that runs the launcher (for
  a framework build, its binary inside the framework, so the profile allows
  exactly one program);
- in the folder `/`, with no standard input, its output captured and passed
  on;
- under resource limits: no core files (`system.sb` would let a process write
  them under `/cores`), 600 CPU seconds, files of at most 1 MiB (for a
  download: the source's size and 1 MiB), 64 open files, and 1,800 s of
  running time (600 s to check a manual file, 60 s for the probe).

It reads the lock itself first (a tracked file that a person wrote, in strict
JSON), and to build the parameters it reads the load commands of the
interpreter's Mach-O extension modules for TLS and hashes (`_ssl`,
`_hashlib`), to find the libraries they load from outside the interpreter's
home, and asks the interpreter, in a child with an empty environment and no
sandbox, where its TLS looks for certificates (`probe.py paths`, which only
prints them). It never reads what a stage downloads.

### The profiles

Both start with `(deny default)` and `(import "system.sb")`, the base profile
that comes with macOS. On macOS 27.2 that file allows: reading `/System`,
`/usr/lib`, `/usr/share`, `/Library/Apple`, a few files under `/private/etc`
(`passwd`, `services`, `protocols`, `localtime`) and two under the system's
database folder (time zones, the directory record store); `/dev/null`,
`/dev/zero`, `/dev/random`, `/dev/urandom`, `/dev/fd`; the dynamic loader;
creating core files under `/cores`; the system log's local socket; looking up
about twenty named system services (logging, preferences, the trust and
directory services among them) and XPC services by any name; reading
system settings (`sysctl`). The profiles add:

| Rule | `fetch.sb` | `offline.sb` | Why |
|------|------------|--------------|-----|
| Start `PYTHON` | yes | yes | `sandbox-exec` starts the interpreter after the profile applies; no other program may start, and no process may fork |
| Read and load `PYTHON_HOME`; metadata of its parent folders | yes | yes | The standard library, the extension modules and the framework; the interpreter resolves its own path at start, which reads each parent folder's metadata |
| Read and load `LIBRARIES`; metadata of `LIBRARIES_LINK` and its parents | yes | yes | The TLS and hash libraries outside the interpreter's home (Homebrew: OpenSSL in its own folder, named through a symbolic link); without them `ssl` does not load and `hashlib` falls back to its own code |
| Read `COLLECTOR` | yes | yes | The collector's code, read only |
| Read `LOCK` | yes | when given | The lock |
| `QUARANTINE` | read and write | read only | The source's own folder, `QUARANTINE/<id>/<sha256>`; nothing else of the quarantine |
| Read and write `OUT` | - | yes | The stage's own folder (a temporary folder for the check of a manual file; staging and reports later) |
| Read `CA_FILE`, `CA_DIR` (as named and as real paths) | yes | - | The certificates TLS checks a server against. Without these rules the default TLS context loads none (measured: 0 certificates instead of 181) and every server fails the check |
| TCP to port 443 of any host | yes | - | The download |
| The name resolver's local socket (`/var/run/mDNSResponder`) | yes | - | Looking up host names; without it every lookup fails |

Not allowed, in either: any other port or protocol (TCP 9 and 80, UDP 53, 443
and 9 were measured refused under `fetch.sb`), listening for connections,
starting a program or forking (a shell and `/usr/bin/true` measured refused),
reading anywhere else (a file in a temporary folder and the repository's
README measured refused), writing anywhere else, and OpenSSL's own
configuration file, which TLS does not need: it ran with its built-in
defaults. A parameter used without `(when ...)` must be given: without it the
profile does not load and nothing runs.

The profiles import `system.sb` and not `bsd.sb`, which an earlier test of
this approach used: `bsd.sb` also lets a process read the metadata of every
path (whether a file exists, its size and times), which no stage needs.

### What the probe proves

Before every stage, `collector/probe.py` runs under the same profile, with the
same parameters and limits, and tries each of these once; the launcher
compares the outcomes with what the profile promises:

| Action | `fetch.sb` | `offline.sb` |
|--------|------------|--------------|
| Read a file of the collector | allowed | allowed |
| Read the lock | allowed | allowed when given |
| List the quarantine folder | allowed | allowed |
| Write into the quarantine folder | allowed | refused |
| Write into `OUT` | - | allowed |
| Read a file outside every allowed folder (made for the probe) | refused | refused |
| Read the repository's README | refused | refused |
| Write outside every allowed folder | refused | refused |
| Start a shell | refused | refused |
| TCP to port 443 on the loopback interface | allowed (the network stack answers) | refused |
| TCP to port 9 on the loopback interface | refused | refused |
| UDP to port 53 on the loopback interface | refused | refused |
| Connect to the name resolver's socket | allowed | refused |
| Load TLS with its certificates | allowed | - |

"Refused" means EPERM, the sandbox's answer; any other error does not count.
The probe also reports the names of the variables in its environment, its
interpreter flags and its limits. Nothing leaves the machine: the connections
go to the loopback interface and to the resolver's local socket.

What that proves: on this run, with this macOS and these parameters, the
profile refuses each tried action of those kinds and allows what the stage
needs, so a removed or changed `sandbox-exec` (a deprecated tool, without
documentation) does not go unnoticed. What it does not prove: that the
profile refuses every path, port or service it does not try; the profile's
text and its tests (`collector/tests/test_sandbox.py`) cover the rules
themselves.

### What the sandbox does not protect against

Each item says whether it was checked for this version.

- **Bugs in the kernel or in the sandbox itself.** It is the same kernel, not
  a virtual machine. Not testable here.
- **A removed or changed `sandbox-exec` after an update of macOS.** The probe
  runs before every stage. Checked: the launcher stops with exit 4 and starts
  nothing when `sandbox-exec` is missing (a test that runs everywhere), when a
  probe action that must be refused succeeds (a test with a made-up result,
  for every such action of both profiles, everywhere), and under a profile
  that allows everything (a test on macOS).
- **Network by host name.** The sandbox cannot filter by host (it refuses a
  host other than `*` or `localhost` in the rule): code in the fetch stage
  could reach any host on port 443. The lock's hosts and the refusal of
  cross-host redirects are rules of `fetch.py`, not of the sandbox. What such
  code could send is what it can learn: its own paths (which name the user's
  home folder), its user id, what `system.sb` lets every process read, and
  what the system services it may ask (the directory service among them)
  answer. Checked: reads outside the allowed folders are refused for the
  probe's samples. Not checked: the answers of every service `system.sb`
  allows.
- **Resource exhaustion.** Partly limited: CPU seconds, the size of each file
  written, open files, running time. Not limited: memory (macOS does not
  enforce an address-space limit; measured: the limit does not take, and a
  6 GiB allocation succeeded) and the number of files written into the
  allowed folder.
- **The Mach and XPC services that `system.sb` allows.** Listed above from
  the file; what each does was not examined.
- **The content.** Plausible but wrong numbers pass any sandbox; only pinned
  hashes, range checks and review of the mappings address that.
- **TLS under the fetch profile.** Checked as far as this machine allows, on
  macOS 27.2.1 with Homebrew's Python 3.14.10 and OpenSSL 4.1.0, with one
  HTTPS GET of `https://example.com/` in `fetch.sb`: `ssl` loads, the default
  context loads the certificates (181), and the host name resolves through
  the system resolver; the TCP connection to port 443 was not refused by the
  sandbox (no EPERM) but got no answer within 20 s per address. That machine
  runs an outbound firewall that decides per program and had no rule for the
  interpreter binary the launcher starts, the likely cause. So the handshake
  with a remote server and the answer to the GET were not observed: the first
  real fetch (the pull request that adds the first source) must show them.
  Observed locally instead, on every run: TLS loads with its certificates in
  the probe, and the fetch stage reaches port 443 on the loopback interface
  in the sandbox (the connection is refused there, since nothing listens).

### Where it is proved

CI runs on Linux, which has no `sandbox-exec`. Its unit tests prove there:
the fetch rules, against an HTTPS server on the loopback interface that the
tests start with a certificate authority they make with `openssl` in a
temporary folder (http, a host the lock does not list, a cross-host redirect
also to a listed host, a body larger or shorter than the lock's size, a hash
that differs, another content type, a web page, an encoded body, a status
other than 200, a certificate the system does not trust, too many redirects,
and a matching file accepted); the lock's grammar; that the launcher starts
nothing when a probe action succeeds that must be refused, when the probe does
not run, or when `sandbox-exec` is missing; that a child gets an empty
environment, no input, the folder `/` and the limits; the profiles' text and
parameters; the reading of Mach-O load commands; and that only `fetch.py`,
`probe.py` and the test with the loopback server import network modules.
`run.py fetch` and `run.py probe` exit 4 there.

Only a run on macOS proves the rest, in the tests of the class `Sandboxed`
in `collector/tests/test_sandbox.py`, which CI skips with that reason: the
probe's observations under both profiles, including EPERM for every network
action under `offline.sb` and for TCP port 9 and UDP under `fetch.sb`; that a
profile that allows everything stops the launcher; the check of a manual file
in the offline sandbox, end to end; and that the fetch stage reaches port 443
in the fetch sandbox. Run them with the unit tests (below) on a Mac.

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

The unit tests of the fetch stage start an HTTPS server on the loopback
interface and make its throw-away certificates with the `openssl` command in
a temporary folder. Without that command they are skipped, except where the
variable `CI` is set (as in CI): there they fail, since a skip would leave the
job green while it proves nothing. The tests of the
real sandbox need macOS and are skipped elsewhere (see "Where it is proved").
`probe` and `fetch` are described under "Fetch".

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
package installed. The unit tests include those of the fetch stage, against
the HTTPS server they start on the loopback interface; those of the real
sandbox are skipped, since Linux has no `sandbox-exec`. No step fetches a
source and nothing runs in a sandbox; setup-python itself may
download the Python build from GitHub when the runner image does not have
it. The deploy job needs this job to pass. The audit job, which installs no
dependencies, runs the second check, `npm run check:data`, on the emitted
files. What the other jobs check is in [ci.md](ci.md).
