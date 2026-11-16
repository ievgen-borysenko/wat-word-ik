# Security

## Supported versions

Only the current version is supported: the site deployed on GitHub Pages (three
pages, `index.html`, `deuren.html` and `onderbouw.html`) and the `main` branch
it is built from.
There are no releases and no older versions to patch; a fix lands on `main`
and is deployed from there.

Known advisories: none.

## Reporting a problem

Please report a security or privacy problem privately, through a GitHub
security advisory on this repository: open the **Security** tab and choose
**Report a vulnerability**. Do not open a public issue for it.

Examples of what we want to hear about:

- a page sends any request (to its own host too, for example with data in a
  query string), or stores anything (cookies, local storage, IndexedDB) in the
  browser;
- something in the published site or in the repository history that should not
  be there: a secret, a personal address, a private file;
- a way to make a page run code or load content from another site;
- a way for a dependency to change what CI audits or deploys.

There is no e-mail address for reports; the advisory form is the only channel.
We will answer in the advisory. (Maintainers: the form exists only while
private vulnerability reporting is enabled in the repository settings; see
"Settings for the switch to public" in [docs/ci.md](docs/ci.md).)

## Scope

This is a static site of three pages: two show the same grades in two views,
the third shows the same professions by school level and profile. It has no
backend, no accounts and no data collection.
What CI checks on every change is described in [docs/ci.md](docs/ci.md).
