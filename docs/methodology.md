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

Everything runs in the browser. The state (sliders, goal, language) lives only
in the address bar (`#s=6666666666&g=arts&l=en`), so a link can be shared.
No accounts, no cookies, no local storage, no analytics, no network requests.
