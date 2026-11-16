# How it works

> **Status: M0 demo.** Every number on the page (requirements, levels, pay) was
> made up for this prototype to make the picture readable; no source has been
> used yet. It is approximate demo data, not real admission rules and not
> career advice.

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

Some professions form a ladder in one line of work, for example
electrical installer → electrical technician → electrical engineer (hbo) →
electrical engineer (wo). Each rung asks a bit more.

## Second view: doors

`deuren.html` shows the same sliders, data and engine as a street of doors
instead of a building, to compare the two framings. There are no floors: the
doors stand in five groups by field of work (care and health, technology and
computers, making and design, nature and research, people and society),
alphabetically inside a group, never ordered by level or pay. Level and
pay stay on the profession card. Each field spans at least three floors.

- **open**: the profession is open (as above);
- **almost open** (ajar): one +1 on one slider opens it, that is, the "+N"
  above is exactly 1. The door names the subject, or says "any subject" when
  only the average is one point short. This is stricter than "nearly there";
- **not open yet**: everything else.

The counter reads "N doors open, M almost open". The line under it names one
step: the +1 that opens the most doors, with how many (ties: the first subject
in slider order); if no single +1 opens a door, the door with the smallest
"+N" (ties: alphabetical by id) and that number; with every door open, a plain
sentence. The two views link to each other with the same address after `#`;
each link is named after where it goes ("View as doors", "View as building").

## Privacy

The page itself stores nothing and sends nothing: no accounts, no cookies, no
local storage, no analytics, no network requests. Everything runs in the
browser.

The state lives only in the part of the address after `#`
(`#s=6666666666&g=arts`), so a link can be shared. The language is added
(`&l=en`) only when it came with the link or was picked on the page;
otherwise each visitor gets their own browser language. The link to the other
view adds `&v=1`, the view-switch marker, when the grades are the user's own;
it carries no data, and the page it opens drops it from the address.

The hosting provider serves the files and sees an ordinary page request, like
for any web page, but never the grades or the goal: browsers do not send the
part after `#`. The address, with that part, stays in the browser history like
any other page.

When a fresh visit (not a reload or a back step) opens the page with grades
in the link, it says so in one line ("these grades came from a link"), until
the first slider change or preset. Switching to the other view keeps that line
while it shows; with the user's own grades the switch carries the marker, so
the other view does not show it.

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
  page. A link that carries the view-switch marker by hand hides the "came
  from a link" line for that visit; it changes nothing else.

## Contributing

How to add a profession, a subject or a language, and how to run the checks:
[contributing.md](contributing.md).
