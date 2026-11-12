# What CI checks

The page makes a promise to children and parents: no accounts, no ads, no
analytics, no cookies or storage, and no network requests while it runs. CI
exists to prove, on every change, that we ship the page and nothing else: no
secrets, no passwords, no personal details, no files that do not belong there.

The workflow is [.github/workflows/ci.yml](../.github/workflows/ci.yml). It runs
on every pull request and on every push to `main`, with read-only access to the
repository. Every third-party action is pinned to a full commit hash.

## Job 1: verify and build

| Check | What it protects against |
|-------|--------------------------|
| Secret scan of the full git history and the working tree (gitleaks, a pinned release whose checksum is verified) | A key, token or password committed now or in any earlier commit. Inline "allow" comments are ignored, and a gitleaks config or ignore file fails the step until the step is updated with it. |
| `npm ci --ignore-scripts` | Dependencies that differ from the reviewed lockfile, and install scripts running code on the build machine. |
| `npm run typecheck`, `npm test` | Broken code and broken scoring, translations or data. The unit tests also cover every check below. |
| `npm run check:lock` | A dependency downloaded from anywhere but the public npm registry, a dependency without an integrity hash, and a runtime dependency (one that ends up in the page) under a licence outside MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 and 0BSD. |
| `npm audit --omit=dev --audit-level=high` | A known high or critical vulnerability in a runtime dependency. A second, full audit of all dependencies only reports. |
| `npm run check:commits` | A personal e-mail address in a commit. Every author and committer address, and every address in a trailer such as Co-Authored-By, must be a GitHub noreply address on a short list. |
| `npm run check:links` | Links in the README and in `docs/` that point to files that do not exist. |
| `npm run build` | |
| `npm run check:dist` | See below. |
| Secret scan of the built site | A secret that reached the build output. |

`check:dist` audits the built site, the exact files that will be published:

- **Only expected files:** `index.html`, the JavaScript and CSS bundles in
  `assets/` and the documents in `docs/` that the page links to. Source maps,
  hidden files, JSON dumps, tests and images are refused, and so is any file
  that nothing links to.
- **Size budget:** JavaScript up to 150 kB, CSS up to 40 kB, the whole site up
  to 400 kB. The measured sizes are printed on every run.
- **Nothing private inside:** no paths from a developer's computer, no local
  server addresses, no private keys, no source map comments, no e-mail
  addresses, and no web addresses except XML namespaces and this repository.
- **No way to send or store data:** the JavaScript may not use any browser
  feature for network requests, storage or background workers, nor build code
  from text at run time.
- **Locked-down page:** `index.html` must carry a Content-Security-Policy that
  forbids network connections and every remote source, must load nothing from
  another site, and must have no inline scripts or event handlers.

The audited files are then uploaded as the GitHub Pages artifact.

## Job 2: end-to-end tests

The second job downloads that same artifact (it does not build again), serves
it locally and drives it in Chromium with Playwright, at desktop size
(1280x800) and phone size (375x812):

- **No traffic, no errors:** every request during the whole test goes to the
  page itself, there are no WebSockets, no console errors and no
  Content-Security-Policy violations.
- **No storage:** after dragging sliders, using the presets, opening a card,
  pinning a goal and switching languages, there are no cookies, nothing in
  local or session storage, no IndexedDB databases, no service workers and no
  caches.
- **It works:** "all 3" opens exactly the five jobs that need no diploma, "all
  9" opens most of the building, the state in the address survives a reload,
  a card opens and closes with Escape, and the footer links work.
- **Accessible and on one screen:** no serious or critical accessibility
  findings (axe) on the main view and on an open card in Dutch, English and
  Ukrainian; no sideways scrolling, and on desktop no scrolling at all.

## Job 3: deploy

Only after both jobs pass, only for a push to `main`, and only while the
repository is public, the artifact that was audited and tested is deployed to
GitHub Pages. This job alone may write to Pages, and it signs in with a
short-lived token from GitHub, not a stored secret.

## Dependency updates

Dependabot proposes updates weekly for npm packages and for the pinned actions,
grouped and few at a time. Each update is a pull request and goes through all
of the checks above.

## Running the checks locally

```sh
npm ci
npm run typecheck && npm test
npm run check:lock && npm run check:links
npm run check:commits -- origin/main HEAD
npm run build && npm run check:dist
npx playwright install chromium   # once
npm run e2e                       # tests the built site in dist/
```
