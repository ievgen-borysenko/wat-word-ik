# Wat word ik?

A small website of four pages for children from about age 10 (groep 7/8 and
up) that shows **why** to study and **what** to study. On the first page, drag the sliders for your school
subjects (1-10, the Dutch grade scale) and watch a building of 36 professions
light up or go dark. Click a profession to see what you need to know for it.

![A short tour of the four pages: in the building, Maths goes from 4 to 8 and the open professions go from 16 to 28 of 36; the same grades as doors, where Dutch goes from 7 to 4 and nine doors close again; the onderbouw page, where vwo and Nature & Health open 28 doors instead of 23; the bovenbouw page, where vwo and Culture & Society open 26 doors and maths A as an exam subject opens two more.](docs/demo.gif)

Try it: <https://ievgen-borysenko.github.io/wat-word-ik/>

A second view, `deuren.html`, shows the same grades as a street of doors
grouped by field of work; each view links to the other.

A third page, `onderbouw.html`, is for the next age: klas 1-3 of secondary
school (about 12 to 15), before the profile choice. There the input is not
grades but the school level (vmbo-bb/kb, vmbo-gl/tl, havo, vwo) and the
profile or vmbo direction. The same professions stand as doors that are
open, one step away (the door names the step) or not on this route for now
(the door says which level or profile leads there), and each profile button
counts the doors it opens.

A fourth page, `bovenbouw.html`, is for the upper years of havo and vwo, after
the profile choice and before the choice of a study. On top of the level and
the profile it takes the exam subjects a pupil has besides the profile (maths
A or B, physics, chemistry, biology) and holds them against the admission rule
of each hbo and wo programme: the card says what you have, what is still
missing, and when to apply. All four pages link to each other.

It shows what is *open* with your grades or your school route, never what you
*will become*.

**Status: M0 prototype with demo data.** All requirements, levels and pay
values are approximate and made up for this prototype. The one exception is
the admission to hbo and wo, by school profile on the onderbouw page and by
profile and exam subject on the bovenbouw page, checked against the Dutch
admission regulation (Ratho) of 1 September 2026, and the national dates to
apply on the bovenbouw page, checked on rijksoverheid.nl. See
[docs/methodology.md](docs/methodology.md) and [docs/sources.md](docs/sources.md).

Languages: Dutch, English, Ukrainian.

## Privacy

Four static pages, no backend. Each page stores nothing and sends nothing: no
accounts, cookies, local storage, analytics, ads, external fonts or network
requests. The grades and the goal, on the onderbouw page the level and the
profile, and on the bovenbouw page also the exam subjects, live only in the
part of the address after `#`. The hosting provider
serves the files and sees an ordinary page request, but never that state:
browsers do not send the part after `#`.

## Run

Requires Node.js and npm.

```sh
npm ci --ignore-scripts  # install exactly what package-lock.json lists, run no install scripts
npm run dev              # local dev server
npm test                 # unit tests (engine, data, translations, store, built CSP)
npm run typecheck
npm run build            # static site in dist/, works from any sub-path
```

## What CI checks

Every pull request and every push to `main` runs the same checks, so that we
ship the pages and nothing else:

- the repository, and every commit of a pull request, holds only files on an
  explicit list; every tracked file is text without an e-mail address, a path
  from a developer's computer, a private key or a private network address,
  except the animation above. That one must be a looping GIF in one fixed
  form, at most 2 MiB, 880x880 pixels, 400 frames and 60 s, in every commit
  that changes it: without the metadata that tools write (comments, XMP,
  colour profiles) and with nothing appended. The check cannot see data hidden on purpose in its
  pixels, its colour table or the fields the format leaves free; the reviewer
  looks at the animation;
- secret scan of the whole git history and of the built site;
- dependencies only from the npm registry, with integrity hashes and
  permissive licences; no known high or critical vulnerabilities at run time;
- commits carry only GitHub noreply addresses, no trailers but the
  maintainer's co-author line, Dependabot's sign-off and Dependabot's
  co-author line on its own commits, and no generated-by footers;
- the data file the site will read (`src/data/sourced.json`, written by the
  collector, still empty) holds only its closed grammar: the collector's gate
  checks it in Python, and a second check written apart from it checks it
  again in the job that installs no dependencies;
- the built site is audited in a separate job that installs no dependencies,
  so no package code can touch the audit: it holds the four pages
  (`index.html`, the building, `deuren.html`, the doors, `onderbouw.html`,
  the school route, and `bovenbouw.html`, the route with exam subjects),
  their bundles and nothing else, stays within a size budget, contains no local paths, private
  addresses, e-mail addresses or keys, uses no browser feature that sends or
  stores data and no way to send data to its own host, keeps on each page a
  Content-Security-Policy that lets it load its own scripts and stylesheets
  and nothing else, and carries the licence notice of every package bundled
  into it;
- end-to-end tests in Chromium on that same audited build: the browser asks
  only for the pages and their own files, never with a query string, nothing is
  stored, no console errors, no serious accessibility findings, and the
  layout fits desktop and phone screens.

Only then, and only from `main`, is that exact build deployed to GitHub Pages.
Details: [docs/ci.md](docs/ci.md). To report a problem: [SECURITY.md](SECURITY.md).

```sh
npm run check:tree && npm run check:lock && npm run check:links && npm run check:data
npm run build && npm run check:dist
npx playwright install chromium   # once
npm run e2e                       # end-to-end tests of dist/
```

## Layout

```
src/engine   pure TypeScript: scoring, hints, doors, school routes, URL hash codec (+ tests)
src/data     subjects and professions (demo data, 3 languages) + validation test;
             sourced.json, the collector's weights (empty yet), and its typed loader
src/i18n     UI strings: nl.json, en.json, ua.json
src/ui       Preact components
docs         methodology, sources, how to contribute, what CI checks, demo.gif
scripts      CI checks: files, lockfile, commits, links, data, built site (+ tests);
             record-demo.mjs, which records docs/demo.gif (not run in CI)
e2e          end-to-end tests of the built site (Playwright)
collector    data collector (Python, standard library only): gate, emit, tests; no data yet
.github      CI workflow and Dependabot settings
```

## Licence

MIT, see [LICENSE](LICENSE). The built pages bundle Preact and Preact Signals
(MIT) into one script that all four pages load; their copyright and licence
notices open that shared script.
