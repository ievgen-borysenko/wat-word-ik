# How it works

> **Status: M0 demo.** Every number on the page (requirements, levels, pay) was
> written by hand to make the picture readable. It is approximate demo data,
> not real admission rules and not career advice.

## What the page shows

The page answers one question: *with grades like these, which professions are
open to you?* It shows what is **open**, never what you *will become*, and it
never shows probabilities.

## Inputs

Ten school subjects, each a slider from 1 to 10 (the Dutch grade scale):
maths, physics, chemistry, biology, Dutch, English, history and society,
geography, technology, art and design. Default: 6 everywhere.

## Professions

36 professions on five floors:

| Floor | Meaning                     | Minimum average of all sliders |
|-------|-----------------------------|-------------------------------:|
| 0     | no diploma needed           | none                           |
| 1     | mbo 2-3                     | 4.5                            |
| 2     | mbo 4                       | 5.5                            |
| 3     | hbo                         | 6.5                            |
| 4     | wo                          | 7.5                            |

The minimum average is a rough stand-in for the school track (vmbo, havo, vwo)
in this demo. Each profession above floor 0 also lists 2 to 5 subjects with a
minimum grade (4 to 9).

## States

For a profession `p` and the current sliders:

- **deficits**: every listed subject where the slider is below the minimum,
  as *have* and *need*;
- **average gap**: `max(0, minAvg - average)`, computed on whole slider points
  (6.5 on ten subjects means a sum of 65), so there is no rounding noise.

Then:

- **open**: no deficits and no average gap;
- **nearly there** (near): not open, the subject deficits add up to at most
  2 points and the average gap is at most 0.5;
- **locked** (far): everything else.

The "+N" badge on a "nearly there" tile is the smallest number of +1 slider steps
that would open it: `max(sum of subject deficits, average gap in points)`,
because raising a subject also raises the average.

**Monotonic:** raising a slider can only shrink deficits and the average gap,
so it never closes a profession. A property test checks this over 500 seeded
random slider sets.

## Hints

- Under each slider: the professions that would become open if that slider
  went up by one (the average changes too).
- In the profession card: up to three of the largest gaps, or, when the
  profession is open, what the next rung of its ladder asks.

## Ladders

Some professions form a ladder in one field, for example
electrical installer → electrical technician → electrical engineer (hbo) →
electrical engineer (wo). Each rung asks a bit more.

## Privacy

The page itself stores nothing and sends nothing: no accounts, no cookies, no
local storage, no analytics, no network requests. Everything runs in the
browser.

The state lives only in the part of the address after `#`
(`#s=6666666666&g=arts`), so a link can be shared. The language is added
(`&l=en`) only when someone picks it on the page; otherwise each visitor gets
their own browser language.

The hosting provider serves the files and sees an ordinary page request, like
for any web page, but never the grades or the goal: browsers do not send the
part after `#`. The address, with that part, stays in the browser history like
any other page.

When the page opens with grades in the link, it says so in one line ("these
grades came from a link"), until the first slider change or preset.

## Limits

- **Framing.** The site is plain static files without response headers. A
  page like this cannot forbid another site from showing it inside a frame:
  that needs a header (`Content-Security-Policy: frame-ancestors` or
  `X-Frame-Options`), and `frame-ancestors` has no effect in a `<meta>` tag.
  That is acceptable here: there are no accounts, no actions that change
  anything outside the page and no data to take, so a framing site can only
  show the page as it is.
- **Crafted links.** A link can only choose among known values: ten grades
  from 1 to 10, one goal from the list of professions and one of the three
  languages. Anything else falls back to the defaults
  (`src/engine/hash.ts` and its tests). A link cannot put text or code on the
  page.

## Contributing

How to add a profession, a subject or a language, and how to run the checks:
[contributing.md](contributing.md).
