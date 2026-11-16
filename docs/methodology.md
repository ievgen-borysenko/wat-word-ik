# How it works

> **Status: M0 demo, one exception.** Every number and rule on the pages
> (requirements, levels, pay, the vmbo directions) was made up for this
> prototype to make the picture readable. It is approximate demo data, not
> real admission rules and not career advice. The exception is the admission
> by school profile to hbo and wo on the onderbouw page: it was checked
> against the Dutch admission regulation (Ratho) of 1 September 2026; see
> [sources.md](sources.md).

## What the pages show

The site has three pages. The first two, for groep 6-8 of primary school,
answer one question: *with grades like these, which professions are open to
you?* The third, for klas 1-3 of secondary school, asks the same of a school
level and a profile (see "Third page: onderbouw" below). Each shows what is
**open**, never what you *will become*, and none shows probabilities.

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

## Third page: onderbouw

`onderbouw.html` is for klas 1-3 of secondary school (age 12-15), the years
before the profile choice. A child of that age has no use for ten
primary-school grades; what decides the route is the school level and the
profile. The input is two rows of buttons:

- **school level:** vmbo-bb/kb, vmbo-gl/tl, havo, vwo (default havo);
- **profile:** for havo and vwo the four profiles, Natuur & Techniek (N&T),
  Natuur & Gezondheid (N&G), Economie & Maatschappij (E&M) and Cultuur &
  Maatschappij (C&M); for vmbo four broad directions, Techniek, Zorg en
  welzijn, Economie and Groen. The real vmbo-bb/kb/gl has ten profiles; the
  page groups them into four for simplicity and says so in "How it works".
  Default: "not chosen yet".

The professions are the same 36 doors as on `deuren.html`, grouped by field,
each in one of three states (`src/engine/route.ts`):

- **open:** this level and profile lead there directly;
- **one step more** (detour): one extra step leads there, and the door names
  it;
- **not on this route** (closed for now): it needs another level or profile,
  and the door says which ("from havo up", "with N&G"). Nothing is shown as
  closed for good.

The profession's floor stays the source of its diploma level:

| Floor | From vmbo-bb/kb | From vmbo-gl/tl | From havo | From vwo |
|-------|-----------------|-----------------|-----------|----------|
| 0, 1 (no diploma, mbo 2-3) | open | open | open | open |
| 2 (mbo 4) | one step: mbo 2 first | open | open | open |
| 3 (hbo) | closed: from vmbo-gl/tl up | one step: via mbo 4 or havo 4 | by profile (havo rule) | by profile (vwo rule) |
| 4 (wo) | closed: from havo up | closed: from havo up | direct profile: one step via vwo 5 or an hbo first year (propedeuse); else closed | by profile |

A wo programme where no profile admits without an extra subject
(Geneeskunde, Diergeneeskunde) is closed from vmbo and from havo "from vwo
up": from havo every profile is two steps short. At vwo such a door names the
profiles that admit with one extra subject.

"By profile" uses the admission data of each hbo and wo profession: the
profiles that admit directly are **open**; a profile that one extra exam
subject brings up to the rule is **one step more**, and the door names the
subject; any other profile is **closed**, and the door names the direct
profiles. On the vmbo-gl/tl route via mbo 4 the profile rules do not apply;
at havo and vwo that route is not shown as a step (see the order of the
levels below). From havo to wo with a profile that would also need an extra
subject is two steps, so closed. The card's admission section follows the
profession and the level: "from havo" for hbo below vwo, "from vwo" for hbo
at vwo and for wo; at havo a wo card with a direct profile adds that vwo 5 or
an hbo first year comes first (with no direct profile the door is closed
"from vwo up" and the card leaves that line out).

Two simplifications, both the stricter reading:

- vmbo-bb/kb is one button, and the page follows bb, the stricter half:
  with bb, mbo 4 comes after mbo 2 and hbo is two steps away. With kb, mbo 4
  is direct and hbo is one step via mbo 4; "How it works" says so.
- Where an admission row asks for more than one extra subject, the data
  holds the stricter reading: that profile is closed.

A vmbo direction never closes a door: a vmbo diploma of any direction admits
to mbo. For mbo professions the direction is only a **fit**: the door says
"fits your direction" or "fits best with Zorg en welzijn".

Without a profile, havo and vwo show what the level alone decides: open when
every profile opens it, else one step more "with N&T or N&G" (and the step,
if any). Each profile button counts how many doors that profile opens ("opens
28 of 36"); a vmbo direction counts the mbo jobs that fit it ("fits 4 of 15
mbo jobs"), because it opens and closes nothing.

Without a profile, and with a profile that admits to the programme (directly
or with one extra subject), a higher level never shows a door as less open.
A havo or vwo profile without admission is the one exception, on purpose: it
closes an hbo or wo door and names the profiles that do admit, while
vmbo-gl/tl shows the same hbo door one step away via mbo 4. From vmbo-gl/tl,
mbo 4 is the normal next school; for a havo or vwo pupil it is a route of
several years, not one extra step, and showing it would erase what the
profile choice changes. Every closed door names a level or profile that does
reach it. Unit tests check all of this for every profession.

An hbo programme has two rules, because the regulation has a table for
havo pupils and one for vwo pupils: at havo (and on the card at the vmbo
levels) the door follows the havo rule, at vwo the vwo rule. The card's
admission section says which ("from havo", "from vwo"). Where a wo row has a
footnote that lets a profile catch up subjects in the first year, the door
stays closed for that profile and the card adds a line about it.

The data per profession is in `src/data/professions.ts`. `vmbo` is
hand-written demo data like the rest of the file. `admission` follows the
Ratho row of one programme per profession, and `admission.source` names it;
[sources.md](sources.md) lists every row and how a cell becomes data. Which
programme stands for a profession (Built Environment for the construction
engineer, Technische Informatica for the software engineer, Natuurkunde for
the scientist) is our own editorial choice, not part of the regulation.

## Privacy

Each page itself stores nothing and sends nothing: no accounts, no cookies, no
local storage, no analytics, no network requests. Everything runs in the
browser.

The state lives only in the part of the address after `#`
(`#s=6666666666&g=arts`), so a link can be shared. The language is added
(`&l=en`) only when it came with the link or was picked on the page;
otherwise each visitor gets their own browser language. The link to the other
view adds `&v=1`, the view-switch marker, when the grades are the user's own;
it carries no data, and the page it opens drops it from the address.

The onderbouw page keeps its state the same way (`#n=havo&p=nt`): `n` is the
school level, `p` the profile, left out until one is chosen, and `l` the
language as above. Each page reads only its own keys and drops the others
from the address on its first write. The links between the onderbouw page
and the other two carry only the chosen language (`#l=nl`), never grades, a
goal, a level or a profile.

The hosting provider serves the files and sees an ordinary page request, like
for any web page, but never the grades, the goal, the level or the profile: browsers do not send the
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
  languages; on the onderbouw page one of the four levels, one profile of
  that level and a language. Anything else falls back to the defaults
  (`src/engine/hash.ts` and its tests). A link cannot put text or code on the
  page. A link that carries the view-switch marker by hand hides the "came
  from a link" line for that visit; it changes nothing else.

## Contributing

How to add a profession, a subject or a language, and how to run the checks:
[contributing.md](contributing.md).
