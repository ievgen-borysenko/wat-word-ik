# Wat word ik?

A small web page for children from about age 10 (groep 7/8 and up) that shows
**why** to study and **what** to study. Drag the sliders for your school
subjects (1-10, the Dutch grade scale) and watch a building of 36 professions
light up or go dark. Click a profession to see what you need to know for it.

It shows what is *open* with your grades, never what you *will become*.

**Status: M0 prototype with demo data.** All requirements, levels and pay
values are approximate and written by hand. See
[docs/methodology.md](docs/methodology.md) and [docs/sources.md](docs/sources.md).

Languages: Dutch, English, Ukrainian.

## Privacy

Static page, no backend. The page itself stores nothing and sends nothing: no
accounts, cookies, local storage, analytics, ads, external fonts or network
requests. The grades and the goal live only in the part of the address after
`#`. The hosting provider serves the files and sees an ordinary page request,
but never the grades: browsers do not send the part after `#`.

## Run

Requires Node.js and npm.

```sh
npm ci
npm run dev        # local dev server
npm test           # unit tests (engine, data, translations, store, built CSP)
npm run typecheck
npm run build      # static site in dist/, works from any sub-path
```

## Layout

```
src/engine   pure TypeScript: scoring, hints, URL hash codec (+ tests)
src/data     subjects and professions (demo data, 3 languages) + validation test
src/i18n     UI strings: nl.json, en.json, ua.json
src/ui       Preact components
docs         methodology, sources and how to contribute (docs/contributing.md)
```

## Licence

MIT, see [LICENSE](LICENSE).
