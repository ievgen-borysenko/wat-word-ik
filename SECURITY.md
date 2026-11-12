# Security

## Reporting a problem

Please report a security or privacy problem privately, through a GitHub
security advisory on this repository: open the **Security** tab and choose
**Report a vulnerability**. Do not open a public issue for it.

Examples of what we want to hear about:

- the page sends any request, or stores anything (cookies, local storage,
  IndexedDB) in the browser;
- something in the published site or in the repository history that should not
  be there: a secret, a personal address, a private file;
- a way to make the page run code or load content from another site.

There is no e-mail address for reports; the advisory form is the only channel.
We will answer in the advisory. (Maintainers: the form exists only while
private vulnerability reporting is enabled in the repository settings; see
"Settings for the switch to public" in [docs/ci.md](docs/ci.md).)

## Scope

This is a static page with no backend, no accounts and no data collection.
What CI checks on every change is described in [docs/ci.md](docs/ci.md).
