# How it works

> **Status: M0 demo, one exception.** Every number and rule on the pages
> (requirements, levels, pay, the vmbo directions) was made up for this
> prototype to make the picture readable. It is approximate demo data, not
> real admission rules and not career advice. The exception is the admission
> to hbo and wo, by school profile on the onderbouw page and by profile and
> exam subject on the bovenbouw page: it was checked against the Dutch
> admission regulation (Ratho) of 1 September 2026. The national dates to
> apply on the bovenbouw page were checked on rijksoverheid.nl and in the
> Ratho; see [sources.md](sources.md).

## What the pages show

The site has four pages. The first two, for groep 6-8 of primary school,
answer one question: *with grades like these, which professions are open to
you?* The third, for klas 1-3 of secondary school, asks the same of a school
level and a profile (see "Third page: onderbouw" below). The fourth, for the
upper years after the profile choice, adds the exam subjects a pupil has on
top of the profile (see "Fourth page: bovenbouw" below). Each shows what is
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

## Fourth page: bovenbouw

`bovenbouw.html` is for the upper years of secondary school, after the
profile choice and before the choice of a study. The onderbouw page judges a
profile before any subject is chosen; here the pupil knows which exam
subjects they take, and the page holds them against the full rule of each hbo
and wo programme. The input is the same two rows of buttons, plus, at havo
and vwo only, a box for each of five exam subjects the pupil may take on top
of the profile: wiskunde A, wiskunde B, natuurkunde, scheikunde and biologie.
No grades, no names; the profile may stay "not chosen yet".

**The rule of a cell.** Every Ratho cell of an hbo or wo programme is also
written by hand as a typed rule next to its text (`source.rules` in
`src/data/professions.ts`), never parsed from the text when the page runs:

- `*`: the profile admits;
- `#`: the profile gives no right to admission (an institution may still
  admit after an investigation of what the pupil knows);
- otherwise an AND of OR-groups: each group needs one of its subjects. The
  cell `(wisA of wisB) + (nat of nlt of o&o of PgP-T)` is two groups, `[wiskunde
  A, wiskunde B]` and `[natuurkunde, nlt, o&o, PgP-T]`.

A data test reads every cell's text with a small parser of its own and checks
that it says the same as the typed rule, that a typed cell is `*` exactly
where the profile is in `direct`, that a cell of one group holds the profile's
`bridge` subject and any other cell has none, and that every group holds at
least one exam subject, so the boxes can always meet it.

**Judging** (`src/engine/exam.ts`). A group is met when the pupil has one of
its exam subjects. Against the cell of the pupil's profile at the pupil's
level:

- every group met (or `*`, or a programme without a row): **open**;
- exactly one group missing: **one step more**, and the door names that
  group's exam subjects ("extra vak natuurkunde", or two subjects as
  alternatives);
- more groups missing: **not on this route** for now, and the door names what
  is missing ("nog nodig: (wiskunde A of wiskunde B) en natuurkunde");
- `#`: **not on this route** for now, and the door names the profiles that
  admit.

nlt, o&o and PgP-T are not boxes: they are not general exam subjects of every
school. A group is met only by its exam subjects, so a pupil who takes nlt
sees that group as missing; the card names these three in words where the
rule mentions them and says that they count where the rule names them.

hbo follows the havo rule at havo and the vwo rule (`admission.vwo`) at vwo,
as on the onderbouw page; wo follows the vwo rule. Below the programme's level
the page keeps the onderbouw routing, shared in one function
(`routeWith` in `src/engine/route.ts`): mbo 2 first from vmbo-bb/kb, via mbo
4 or havo 4 from vmbo-gl/tl. wo from havo is one step (vwo 5 or an hbo first
year) when the profile with the pupil's subjects meets the vwo rule; otherwise
it is closed as on the onderbouw page. The vmbo levels have no boxes and show
the onderbouw doors; the subjects ticked at havo or vwo stay in memory, out of
the address, and come back when the level does.

Without a profile, havo and vwo show what the level alone decides, as on the
onderbouw page, now with the pupil's subjects: open when every profile opens
it, else one step more "with N&T or N&G". Each profile button counts the
doors it opens with the ticked subjects. Without any subject ticked every door
is in the same state as on the onderbouw page; ticking a subject never closes
a door. Unit tests check both for every profession, level and profile.

**The card** names the profession, the programme of the Ratho row, the
pupil's own line ("Met C&M en wiskunde A heb je nog nodig: natuurkunde"), the
rule for every profile in words, and the existing line on what it was checked
against. A card of an mbo, hbo or wo profession also says when to apply:

- a bachelor's programme (hbo or wo) that starts in September: through
  Studielink by 1 May;
- a programme with a limited number of places that selects (numerus fixus):
  by 15 January;
- mbo: by 1 April, at the mbo school itself.

These are national dates (see [sources.md](sources.md)). Which programmes
select differs per institution and per year, so the page names no programme
as selective; the card says to check the programme's own page.

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

The bovenbouw page adds one key (`#n=vwo&p=ng&x=wb.na&l=nl`): `x` holds the
ticked exam subjects as short codes joined by a dot (`wa` wiskunde A, `wb`
wiskunde B, `na` natuurkunde, `sk` scheikunde, `bi` biologie), always written
in that order, read in any order, and left out when no box is ticked or the
level is vmbo. Unknown codes are dropped. Its links to the other three pages,
and theirs to it, carry only the chosen language as well.

The hosting provider serves the files and sees an ordinary page request, like
for any web page, but never the grades, the goal, the level, the profile or the subjects: browsers do not send the
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
  that level and a language; on the bovenbouw page the same, plus any set of
  the five exam subjects. Anything else falls back to the defaults
  (`src/engine/hash.ts` and its tests). A link cannot put text or code on the
  page. A link that carries the view-switch marker by hand hides the "came
  from a link" line for that visit; it changes nothing else.

## Contributing

How to add a profession, a subject or a language, and how to run the checks:
[contributing.md](contributing.md).
