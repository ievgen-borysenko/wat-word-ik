# What CI checks

The page makes a promise to children and parents: no accounts, no ads, no
analytics, no cookies or storage, and no network requests while it runs. CI
exists to prove, on every change, that we ship the page and nothing else: no
secrets, no passwords, no personal details, no files that do not belong there.

The workflow is [.github/workflows/ci.yml](../.github/workflows/ci.yml). It runs
on every pull request and on every push to `main`, with read-only access to the
repository. Every third-party action is pinned to a full commit hash. Four jobs,
each starting on a fresh machine:

```text
build ──> audit ──> e2e ──> deploy
            │                 ^
            └─────────────────┘
```

The deploy job needs both the audit and the end-to-end job, and runs only for a
push to `main` of a public repository.

## Who trusts what

The build job runs code from our dependencies: TypeScript, Vitest, Vite and
everything they load. A compromised dependency could rewrite anything on that
machine, the audit scripts and the sources included, so nothing that job checks
or leaves behind decides a release. It only builds and runs the unit tests.

The audit job installs and runs no project dependency. It uses Node and npm
from setup-node (no package cache is restored), git, and a gitleaks release
whose checksum is pinned. The job fails if a `node_modules` folder exists, and
the unit test `scripts/check-standalone.test.mjs` proves that every check
script imports only Node's own modules and other check scripts, and loads from
a folder with no `node_modules` anywhere above it. `npm audit` reads the
lockfile and asks the registry; it installs and runs nothing.

One thing passes from the build job to the audit job: the built site, as the
artifact `site-candidate`. It is untrusted input by design. The audit job
checks exactly those files (`check:dist` and the secret scan) and uploads
exactly those files as the Pages artifact; it takes no output, file or cache
from the build job. The download action neutralises `..` in archive entry
names, so the archive cannot write outside its folder, and the audit runs its
scripts with `node` from its own checkout.

What this does not cover:

- The build job, like every job, can upload artifacts to its own run. A forged
  second `github-pages` artifact makes the deploy refuse (two ids, see Job 4);
  the end-to-end job downloads the audited artifact by its id, not by name.
- The audit proves what the site cannot do (load anything but its own files,
  send or store data, carry private data), not that it is the build of the
  reviewed source. A compromised build dependency could still ship a different
  page that keeps every one of these rules. The end-to-end tests check the
  page's behaviour, not every word on it.

## Job 1: build and unit tests

| Step | What it protects against |
|------|--------------------------|
| `npm ci --ignore-scripts` | Dependencies that differ from the reviewed lockfile, and install scripts running code on the build machine. |
| `npm run typecheck`, `npm test` | Broken code and broken scoring, translations, data or Content-Security-Policy. The unit tests also cover every check script. |
| `npm run build` | |
| Upload as `site-candidate` | Hands the built site, hidden files included, to the audit job. |

## Job 2: audit (no dependencies installed)

| Check | What it protects against |
|-------|--------------------------|
| No `node_modules` | A dependency installed into the job that audits. |
| `npm run check:tree` | Files that do not belong to the program: settings of personal tools, editor folders, notes, dumps, scratch files. Every tracked file must match the list in `scripts/check-tree.mjs`, and so must every path that a commit of the pull request adds, copies or renames to (on a push to `main`: any commit in the history), even when a later commit removes it again. Symlinks, submodules, executable files and files that are not UTF-8 text (binary data, UTF-16) are refused. No tracked file may contain an e-mail address, a path from a developer's computer, a private key or a private network address (RFC 1918), and files other than code may not name a host under `.local`, `.lan` or `.internal`. Loopback addresses (`127.0.0.1`, `localhost`) are allowed in the repository on purpose: they are the same on every machine and the test setup serves the site on one; the built site may not contain them (`check:dist`). |
| Secret scan of the full git history and the working tree (gitleaks, a pinned release whose checksum is verified) | A key, token or password committed now or in any earlier commit. Inline "allow" comments are ignored, and a gitleaks config or ignore file fails the step until the step is updated with it. |
| `npm run check:lock` | A dependency downloaded from anywhere but the public npm registry, a dependency without a sha512 integrity hash, and a runtime dependency (any package not marked dev-only, so optional ones and those npm marks `devOptional` count) under a licence outside MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 and 0BSD. |
| `npm audit --omit=dev --audit-level=high` | A known high or critical vulnerability in a runtime dependency. A second, full audit of all dependencies only reports. Both read the lockfile; nothing is installed. |
| `npm run check:commits` | A personal e-mail address or a stray line in a commit. Author and committer must be personal GitHub noreply addresses, GitHub's own noreply address (web merges) or Dependabot; any other bot is refused. The message may contain no other address. Trailers: `Co-Authored-By` only with the maintainer's own co-author account, `Signed-off-by` only as Dependabot's sign-off; any other key or value, and a trailer without an address, is refused, and so is any line that looks like a generated-by footer. A pull request checks its own commits; a push to `main` checks the whole history, so a cancelled run never leaves a commit unchecked. |
| `npm run check:links` | Links in the Markdown files at the top of the repository and in `docs/` that point to files that do not exist. |
| `check:dist` on the downloaded `site-candidate` | See below. |
| Secret scan of the built site | A secret that reached the build output. |
| Upload as the Pages artifact | Only the files just audited. The job reports the artifact's id for the next jobs. |

What the history checks cover: `check:tree` and `check:commits` read every
commit of a pull request, because GitHub keeps those commits visible with the
pull request even after a squash merge. They check each commit's paths, author,
committer and message. The content of a commit that a later commit replaces is
covered only by the secret scan (gitleaks reads every commit): the e-mail,
local-path and host checks read the files as they are now. A personal address
added in one commit and removed in the next stays in that pull request's
history unless it looks like a secret.

A known limit of `check:commits`: an author or committer is judged by the
form of the address. An account without the `[bot]` suffix passes as a person,
whatever it is used for; who may author commits is decided in review.

`check:dist` audits the built site, the exact files that will be published:

- **Only expected files:** `index.html` and the JavaScript and CSS bundles in
  `assets/`. Source maps, hidden files, documents, JSON dumps, tests and images
  are refused, and so is any file that nothing links to.
- **Size budget:** JavaScript up to 150 kB, CSS up to 40 kB, the whole site up
  to 400 kB. The measured sizes are printed on every run.
- **Nothing private inside:** no paths from a developer's computer (home
  folders on macOS and Linux, Windows drive and network-share paths), no local
  or private network addresses or host names, no private keys, no source map
  comments, no e-mail address of any kind, and no web addresses except XML
  namespaces and this repository; addresses without a scheme (`//host/path`)
  are refused too.
- **No way to send or store data:** the JavaScript may not use any browser
  feature for network requests, storage (cookies, local and session storage,
  IndexedDB, Cache Storage, the origin file system) or workers, nor build code
  from text at run time. Nor may it send data to the page's own host without
  them: no `Image` or `Audio` objects, no writes to `location` or calls of
  `open()`, no direct writes of URL properties (`src`, `href`, `srcset` and the
  like), no such URL attributes in element props, and no string that starts a
  query string (`"?key="`, `"/page?key="`). What this scan cannot see is listed
  in the comment above `REQUEST_SINKS` in `scripts/check-dist.mjs`: names
  assembled at run time, aliases of `open` or `location`, a query written with
  `history.replaceState`, a link the user clicks.
- **Locked-down page:** `index.html` must carry a Content-Security-Policy that
  lets the page load its own script and stylesheet and nothing else:
  `default-src 'none'`, `'self'` only in `script-src` and `style-src`, images
  only as `data:` URLs (the icon), `base-uri 'none'` and `form-action 'none'`,
  and no other source anywhere. It must load nothing from another site, have
  no inline scripts or event handlers, and no local URL with a query string.

## Job 3: end-to-end tests

This job downloads the Pages artifact by the id the audit job reported (it
does not build again), serves it locally and drives it in Chromium with
Playwright, at desktop size (1280x800) and phone size (375x812):

- **No traffic, no errors:** during every test, the browser makes only plain
  GET requests: the page itself as a document, the files in `assets/` as a
  script or a stylesheet, never with a query string, each answered with the
  right content type (the local server answers an unknown path with the page,
  so a status of 200 alone proves nothing). No WebSockets, no console errors,
  no Content-Security-Policy violations. `e2e/guard.spec.ts` checks the guard
  itself: it makes the page send its grades in an image request, navigate to
  `/?x=1` and load its own file as an image, and expects the guard to report
  each of them.
- **No storage:** after dragging sliders, using the presets, opening a card,
  pinning a goal, switching languages and opening "How it works", there are no
  cookies, nothing in local or session storage, no IndexedDB databases, no
  service workers, no caches and nothing in the origin private file system.
- **It works:** "all 3" opens exactly the five jobs that need no diploma, "all
  9" opens most of the building, the state in the address survives a reload,
  the language goes into the address only after it was chosen on the page, a
  card and the "How it works" dialog (from the header and from the footer)
  open, carry a heading, close with Escape and give focus back.
- **Grades from a link:** the notice appears when a link with grades is opened,
  not after a reload, and goes away when a slider moves; closing it moves focus
  to the first preset.
- **Accessible:** no serious or critical findings (axe) on the main view, an
  open card, the "How it works" dialog and the link notice, in Dutch, English
  and Ukrainian.
- **Fits the screen:** never any sideways scrolling, also with a wide system
  font. On desktop (1280x800 and 1366x768) neither the page nor the slider
  column scrolls. On phones (375x812, 375x667, 360x640, 320x568) the ground
  floor of the building stays above the slider panel.

Data sent to the page's own host (for example the grades in the query string
of an image request, which the host's logs would keep) is stopped in three
places: `check:dist` refuses the code that would do it, the CSP makes the
browser block every image, media, font, frame and object load, and the guard
refuses any request with a query string. The limit: a navigation (`location.href
= "?x"`, a link the user follows) is not a load, and a CSP cannot block it. For
navigations only the static scan and the guard remain, and the guard sees only
what the tests do.

Playwright downloads Chromium from its own download server over HTTPS, without
a checksum we pin. We accept that: the job holds only a read-only token and no
stored secrets, and it has no permission to deploy. A compromised browser could, in
theory, use the job's access to this run's artifacts to swap the site that is
about to be deployed; the deploy job therefore refuses any artifact other than
the one the audit job uploaded (see below).

## Job 4: deploy

Only after the audit and the end-to-end tests pass, only for a push to `main`,
and only while the repository is public, the artifact is deployed to GitHub
Pages. The job first checks that the run's `github-pages` artifact has the id
that the audit job reported for its upload, so exactly the audited and tested
files go out. This job alone may write to Pages, and it signs in with a
short-lived token from GitHub, not a stored secret.

Re-runs. Re-running only the failed jobs keeps the result of the jobs that
passed: when the deploy or the end-to-end job is re-run, the run still holds
one `github-pages` artifact with the id the audit job reported, and the deploy
goes ahead. "Re-run all jobs" after a successful audit makes the audit job
upload a second `github-pages` artifact to the same run, or fail on the name
the run already holds. Either way nothing is deployed: a failed upload stops
the run, and with two artifacts the check refuses. Push a new commit instead,
or delete the older artifact on the run's page and re-run the failed deploy
job.

What the check does not close: it runs one step before the deploy action, and
deploy-pages again picks the artifact by name. In the seconds between the two
steps only the pinned configure-pages action runs, and no other job of the run
is still running, but a token taken from an earlier job of the run (see the
browser risk above), if GitHub still accepts it then, could swap the artifact
inside that window. The check turns a swap at any time before the deploy into a
swap within those few seconds; it does not make it impossible.

## Dependency updates

Dependabot proposes updates weekly for npm packages and for the pinned actions,
grouped and few at a time. A new release waits 7 days before it is proposed
(security updates do not wait), so a broken or malicious release has time to be
noticed and withdrawn. Each update is a pull request and goes through all of
the checks above.

## Node version

`.nvmrc` holds only the major version (`26`). CI takes the newest 26.x
available, so Node security releases arrive without a commit; Dependabot does
not update `.nvmrc`, and an exact version would go stale. The cost: two runs a
few weeks apart may use different patch versions of Node.

## Settings for the switch to public

These are repository settings, not files, so CI cannot check them:

- Security: enable **private vulnerability reporting** (the only channel in
  [SECURITY.md](../SECURITY.md)).
- Pages: set the source to **GitHub Actions**.
- Branch protection for `main`: require a **pull request** before merging (no
  direct pushes), and require the status checks **Build and unit tests**,
  **Audit (no dependencies installed)** and **End-to-end (built site)**.
- Pull requests: allow **squash merging only** (no merge commits, no rebase
  merging), so `main` gets one commit per pull request and none of the
  intermediate ones. Keep the default commit message, not the pull request
  description: a Dependabot description quotes upstream release notes, and
  those may hold addresses. The squash commit is written on github.com and is
  checked only by the push run after the merge, so before confirming, remove
  any `Co-authored-by` lines GitHub added for other authors of the branch.

## Running the checks locally

```sh
npm ci --ignore-scripts
npm run check:tree -- --range origin/main HEAD
npm run typecheck && npm test
npm run check:lock && npm run check:links
npm run check:commits -- origin/main HEAD
npm run build && npm run check:dist
npx playwright install chromium   # once
npm run e2e                       # tests the built site in dist/
```
