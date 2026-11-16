# What CI checks

The page makes a promise to children and parents: no accounts, no ads, no
analytics, no cookies or storage, and no network requests while it runs. CI
exists to prove, on every change, that we ship the page and nothing else: no
secrets, no passwords, no personal details, no files that do not belong there.

The workflow is [.github/workflows/ci.yml](../.github/workflows/ci.yml). It runs
on every pull request, on every push to `main` and when a maintainer starts it
by hand, with read-only access to the repository. Every third-party action is
pinned to a full commit hash. Four jobs, each starting on a fresh machine:

```text
build ──> audit ──> e2e ──> deploy
            │                 ^
            └─────────────────┘
```

The deploy job needs both the audit and the end-to-end job, and runs only for a
push to `main`, or a run started by hand on `main`, of a public repository.

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
| Show what decides the deploy | A deploy decision nobody can see: before anything is installed, the step prints the event, the ref and the repository's visibility, the three values the deploy job's condition reads (Job 4). |
| `npm ci --ignore-scripts` | Dependencies that differ from the reviewed lockfile, and install scripts running code on the build machine. |
| `npm run typecheck`, `npm test` | Broken code and broken scoring, translations, data or Content-Security-Policy. The unit tests also cover every check script, and `scripts/check-workflow.test.mjs` reads this workflow and pins: when the deploy job runs; that only the deploy job may write, every other job gets only `contents: read` from the top-level `permissions`, and no job may start a run; that nothing cancels a run on `main`; which history range each event checks; that the secret scan reads merge commits; that no step continues on error except the report-only audit of all dependencies (`continue-on-error: true`), that no condition runs a step after a failure except the one on the step that keeps the Playwright report of a failed run (`if: failure()`), and that no condition skips a check; that no line swallows a failure with `\|\| true`, `\|\| :`, `\|\| exit 0` or `set +e`, and the audit of the built site fails when `check-dist.mjs` fails; and that the id of the audited artifact goes from the audit job's upload to the end-to-end job, which downloads the artifact by that id, and to the deploy job's check, while deploy-pages gets no inputs, so it deploys the `github-pages` artifact that the check compared. A step that hides a failure in any other way is left to review. |
| `npm run build` | |
| Upload as `site-candidate` | Hands the built site, hidden files included, to the audit job. |

## Job 2: audit (no dependencies installed)

| Check | What it protects against |
|-------|--------------------------|
| No `node_modules` | A dependency installed into the job that audits. |
| `npm run check:tree` | Files that do not belong to the program: settings of personal tools, editor folders, notes, dumps, scratch files. Every tracked file must match the list in `scripts/check-tree.mjs`, and so must every path that a commit of the pull request adds, copies or renames to (on a push to `main` or a run started by hand: any commit in the history), even when a later commit removes it again. Symlinks, submodules, executable files and files that are not UTF-8 text (binary data, UTF-16) are refused, with one exception: `docs/demo.gif`, the animation in the README, must be a GIF animation in the one form that `parseGif` in `scripts/check-tree.mjs` describes, at most 2 MiB, 880x880 pixels, 400 frames and 60 s for one pass: the GIF89a header; the screen descriptor with one global colour table and no pixel aspect ratio; one loop extension (NETSCAPE2.0) that loops forever, before the first image; frames that each have a delay of at least 0.02 s and an image inside the screen, without a colour table of its own, whose compressed data decodes to exactly its pixels; and the trailer as the last byte. That keeps out the blocks that tools add on their own (comments, plain text, XMP and other metadata, colour profiles, any other application data) and anything appended after an image's data or after the file, and it bounds the size of the file and of each frame, the number of frames and the running time. It does not keep out data hidden on purpose: in the pixels, in colour-table entries that no pixel uses, in the fields the parse leaves free (in the screen descriptor the background colour index, the colour resolution, the sort flag and the size of the colour table; in each frame the delay within the caps, the transparency flag and the transparent colour index, the disposal method, the image's position and size inside the screen, the interlace flag and the LZW code size) or in how the pixels are coded (where clear codes go, how the data is split into sub-blocks, one zero byte after the end code or none). That is for the reviewer, who looks at the animation, and for the caps. The same parse reads every version of the file that a commit of the range writes (see below). The animation gets no text checks, and the secret scan does not read binary files. No tracked text file may contain an e-mail address, a path from a developer's computer, a private key or a private network address (RFC 1918), and files other than code may not name a host under `.local`, `.lan` or `.internal`. Loopback addresses (`127.0.0.1`, `localhost`) are allowed in the repository on purpose: they are the same on every machine and the test setup serves the site on one; the built site may not contain them (`check:dist`). |
| Secret scan of the full git history and the working tree (gitleaks, a pinned release whose checksum is verified) | A key, token or password committed now or in any earlier commit. A merge commit is read as its changes against its first parent (`--diff-merges=first-parent`): `git log -p` shows no diff for merges by default, so what a merge resolution added would go unscanned. Inline "allow" comments are ignored, and a gitleaks config or ignore file fails the step until the step is updated with it. |
| `npm run check:lock` | A dependency downloaded from anywhere but the public npm registry, a dependency without a sha512 integrity hash, and a runtime dependency (any package not marked dev-only, so optional ones and those npm marks `devOptional` count) under a licence outside MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 and 0BSD. The same runtime packages must have their licence notice in the built site (`check:dist`). |
| `npm audit --omit=dev --audit-level=high` | A known high or critical vulnerability in a runtime dependency. A second, full audit of all dependencies only reports. Both read the lockfile; nothing is installed. |
| `npm run check:commits` | A personal e-mail address or a stray line in a commit. Author and committer must be personal GitHub noreply addresses, GitHub's own noreply address (web merges) or Dependabot; any other bot is refused. The message may contain no other address. Trailers: `Co-Authored-By` only with the maintainer's own co-author account, `Signed-off-by` only as Dependabot's sign-off; any other key or value, and a trailer without an address, is refused, and so is any line that looks like a generated-by footer. A pull request checks its own commits; a push to `main` and a run started by hand check the whole history, so a cancelled run never leaves a commit unchecked. |
| `npm run check:links` | Links in the Markdown files at the top of the repository and in `docs/` that point to files that do not exist. |
| `check:dist` on the downloaded `site-candidate` | See below. |
| Secret scan of the built site | A secret that reached the build output. |
| Upload as the Pages artifact | Only the files just audited. The job reports the artifact's id for the next jobs. |

What the history checks cover: `check:tree` and `check:commits` read every
commit of a pull request, because GitHub keeps those commits visible with the
pull request even after a squash merge. They check each commit's paths, author,
committer and message, and `check:tree` parses every version of
`docs/demo.gif` that a commit writes, whether it adds, changes, copies or
renames the file to that path, or a merge writes a version that none of its
sides had: the secret scan does not read binary files, so nothing else would.
The content of any other file that a later commit replaces is covered only by
the secret scan (gitleaks reads every commit): the e-mail, local-path and host
checks read the files as they are now. A personal address added in one commit
and removed in the next stays in that pull request's history unless it looks
like a secret.

A known limit of the history checks: a run reads the commits that the pull
request holds when the run starts, so a version of a branch is checked only
when a run on it gets to these checks. A version that no run got to, and that
a force-push then took out of the pull request, is never checked. That
happens, for example, to a version pushed before the pull request was opened
(CI does not run on pushes to branches other than `main`), to one pushed
while the pull request had a merge conflict (GitHub runs no `pull_request`
workflow then) and to one whose run a newer push cancelled before the checks.
GitHub can keep such commits reachable by their hash all the same, so
contributors run the checks before every push ("Check before every push" in
[contributing.md](contributing.md)).

A known limit of `check:commits`: an author or committer is judged by the
form of the address. An account without the `[bot]` suffix passes as a person,
whatever it is used for; who may author commits is decided in review.

`check:dist` audits the built site, the exact files that will be published:

- **Only expected files:** the two pages, `index.html` (the floors view) and
  `deuren.html` (the doors view), and the JavaScript and CSS bundles in
  `assets/`. Source maps, hidden files, documents, JSON dumps, tests, images
  and any other page are refused, and so is any file that nothing links to.
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
- **Locked-down pages:** each page must carry a Content-Security-Policy that
  lets the page load its own script and stylesheet and nothing else:
  `default-src 'none'`, `'self'` only in `script-src` and `style-src`, images
  only as `data:` URLs (the icon), `base-uri 'none'` and `form-action 'none'`,
  and no other source anywhere. It must load nothing from another site, have
  no inline scripts or event handlers, and no local URL with a query string.
- **Licence notices:** the built script bundles the code of the runtime
  packages (Preact and Preact Signals, all MIT), whose licences ask that their
  copyright and permission notice go with every copy. The build writes them as
  one comment at the top of the script that holds that code (the chunk both
  pages share), from each installed package's own
  licence file: name, version, licence and copyright lines of each package,
  then each distinct licence text once. An update of a dependency therefore
  brings its own notice, and the build fails when the bundle holds code from
  a package that is not a runtime package of the lockfile. `check:dist` reads
  the lockfile of its own checkout (the same runtime packages as `check:lock`)
  and refuses the site when one of them is missing from the notice at its
  locked version and licence, has no copyright line or no licence text, or,
  for MIT, a text without the sentence that asks for the notice; a notice for
  any other package or version is refused too. The comment passes every
  content check above and counts towards the size budget. What the audit
  cannot see, since it installs no package: whether the copyright lines and
  texts are the packages' own. A licence file that holds an e-mail or a web
  address, as in the common form `Copyright (c) Name <address> (https://...)`,
  builds without complaint and then fails `check:dist` under its rules for
  e-mail and web addresses. That stop is deliberate: the published files carry
  no address of any kind, and the notice gets no exception. When a dependency
  update brings such a file, its pull request stays red and is not merged as
  it is. Either keep the current version (close the pull request and add an
  `ignore` entry for that version to `.github/dependabot.yml`), or decide in a
  pull request of its own how the build writes that package's notice, so that
  the published copy still carries its copyright line and licence text but no
  address. The check stays as it is.

## Job 3: end-to-end tests

This job downloads the Pages artifact by the id the audit job reported (it
does not build again), serves it locally and drives it in Chromium with
Playwright, at desktop size (1280x800) and phone size (375x812):

- **No traffic, no errors:** during every test, the browser makes only plain
  GET requests: the pages (`/`, `index.html`, `deuren.html`) as documents,
  the files in `assets/` as a script or a stylesheet, never with a query
  string, each answered with the right content type (the local server
  answers an unknown path with the page, so a status of 200 alone proves
  nothing). No WebSockets, no console errors,
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
  open, carry a heading, close with Escape and give focus back. The doors view
  (`e2e/doors.spec.ts`): the door states and the counter at the lowest, mixed
  and highest grades, the step it names opens what it says, the card opens
  from a door, a goal marks the sliders, the language switch, and the link to
  the other view keeps the address after `#`, both ways.
- **Grades from a link:** the notice appears when a link with grades is opened,
  not after a reload, and goes away when a slider moves; closing it moves focus
  to the first preset.
- **Accessible:** no serious or critical findings (axe) on the main view, an
  open card, the "How it works" dialog and the link notice, in Dutch, English
  and Ukrainian, on both views.
- **Fits the screen:** never any sideways scrolling, also with a wide system
  font. On desktop (1280x800 and 1366x768) neither the page nor the slider
  column scrolls. On phones (375x812, 375x667, 360x640, 320x568) the ground
  floor of the building, and the last group of doors, stay above the slider
  panel.

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

Only after the audit and the end-to-end tests pass, only for a push to `main`
or a run started by hand on `main`, and only while the repository is public,
the artifact is deployed to GitHub Pages. The job first checks that the run is
for `refs/heads/main` exactly, then that the run's `github-pages` artifact has
the id that the audit job reported for its upload, so exactly the audited and
tested files go out. This job alone may write to Pages, and it signs in with a
short-lived token from GitHub, not a stored secret.

The job's condition reads the event name, the ref and the repository's
visibility from the run's event; the build job prints all three. Two rules of
GitHub's expressions shape it. A value missing from the event counts as equal
to `false`, so the condition asks for the visibility `public` rather than for
"private is false". Strings are compared without regard to case, so
`refs/heads/Main` would pass the condition; the first step therefore compares
the ref again, exactly, in the shell.

Runs started by hand. A maintainer can start the workflow on any branch or
tag: on the Actions tab choose CI, then Run workflow, or run
`gh workflow run ci.yml --ref main`. The workflow takes no inputs, and such a
run does everything a push run does. It has no pushed range of commits, so
`check:tree` and `check:commits` read the whole history of the commit it runs
on, as a push run does: that history is what the public repository and the
deployment stand on. It deploys only on `main`; on any other branch or tag the
deploy job is skipped. On `main` it shares the concurrency group of the push
runs: a run that has started is never cancelled, and a run still waiting for
an earlier one is replaced by a newer one, which then checks and deploys the
newer `main`.

Who can start one, and why that widens nothing: starting a run needs write
access to the repository, the same access that pushing a branch needs. A run
started by hand uses the copy of the workflow on the ref it runs on, and so
does a pull request from a branch of this repository; someone who can push a
branch can already run any workflow they write there, and such a workflow can
deploy to Pages. So the boundary is write access, which only maintainers
hold, together with review of every change to the workflow before it reaches
`main`; a run started by hand does not move it. This file's condition stops
every ref other than `main` that carries this version of the file. The rule of
the `github-pages` environment that only `main` may deploy (see "Settings for
the switch to public") is recommended on top, and it does less: it holds back
a job that names `github-pages` as its environment, as this workflow's deploy
job does. A changed copy on another branch can name another environment:
deploy-pages accepts one, though it advises against it
([deploy-pages, "Security Considerations"](https://github.com/actions/deploy-pages#security-considerations)),
and the first run that names an environment creates it, without protection
rules
([Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)).
No job of this workflow holds `actions: write`, so no job, and no dependency
running in one, can start a run.

Re-runs. A re-run keeps the original run's event: the same commit and ref
([Re-run workflows and jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs))
and the same event payload, which GitHub stores with the run so that a re-run
behaves like the original
([changelog, 30 September 2019](https://github.blog/changelog/2019-09-30-github-actions-deterministic-re-runs-for-workflows)).
The repository's visibility is part of that payload: the deploy job of a run
that started while the repository was private is skipped however often the run
is re-run, also after the switch. Start a new run by hand on `main` instead.

Re-running only the failed jobs keeps the result of the jobs that passed: when
the deploy or the end-to-end job is re-run, the run still holds one
`github-pages` artifact with the id the audit job reported, and the deploy
goes ahead. That deploy publishes the site of the run's own commit, so re-run
a deploy only while no newer run on `main` has deployed since; otherwise it
puts the older site back. Settings, Pages links to the run that deployed
last. "Re-run all jobs" after a successful audit makes the audit job upload a
second `github-pages` artifact to the same run, or fail on the name the run
already holds. Either way nothing is deployed: a failed upload stops the run,
and with two artifacts the check refuses. Start a new run by hand on `main`
instead, or, under the same condition, delete the older artifact on the run's
page and re-run the failed deploy job.

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

`@types/node`, the types of Node's own modules, follows the same major
version. Dependabot proposes its minor and patch releases but no new major
(an `ignore` rule in `.github/dependabot.yml`): the major versions in
`.nvmrc` and of `@types/node` are raised together by hand, in one change.

## Settings for the switch to public

These are repository settings, not files, so CI cannot check them. Until the
switch nothing deploys: every run sees a private repository.

Before the day, while the repository is still private, start a run by hand on
`main` once (`gh workflow run ci.yml --ref main`). It must pass with the deploy
job skipped, and the build job's first step must print
`event: workflow_dispatch; ref: refs/heads/main; repository visibility: private`.
That proves the trigger and every check; only the deployment is left.

On the day of the switch, in this order:

1. **Visibility.** Settings, General, Danger Zone: change the visibility to
   public. Nothing deploys yet: no run has seen a public repository, and a
   re-run of an earlier run never will (see "Re-runs" above).
2. **Security.** Enable **private vulnerability reporting** (the only channel
   in [SECURITY.md](../SECURITY.md)).
3. **Pages.** Set the source to **GitHub Actions**. Then, under Settings,
   Environments, open `github-pages` (create it with that name if it is not
   there yet) and limit **Deployment branches and tags** to the branch `main`.
   GitHub and deploy-pages recommend this rule. It holds back every job that
   names `github-pages` as its environment, this workflow's deploy job
   included, on any ref but `main`; a job that names another environment is
   not held back by it (see "Who can start one" under Job 4).
4. **Branch protection for `main`.** Require a **pull request** before merging
   (no direct pushes), and require the status checks **Build and unit tests**,
   **Audit (no dependencies installed)** and **End-to-end (built site)**.
   Pull requests: allow **squash merging only** (no merge commits, no rebase
   merging), so `main` gets one commit per pull request and none of the
   intermediate ones. Keep the default commit message, not the pull request
   description: a Dependabot description quotes upstream release notes, and
   those may hold addresses. The squash commit is written on github.com and is
   checked only by the push run after the merge, so before confirming, remove
   any `Co-authored-by` lines GitHub added for other authors of the branch.
5. **First deployment.** Start the workflow by hand on `main`: Actions, CI,
   Run workflow, branch `main` (or `gh workflow run ci.yml --ref main`). The
   build job's first step must now print `repository visibility: public`, and
   the deploy job must run, not be skipped.
6. **Check the page.** Open the address the deploy job shows (Settings, Pages
   shows it too): the page loads and the sliders light up the building, and
   `curl -sI` on the address answers `200`.

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
