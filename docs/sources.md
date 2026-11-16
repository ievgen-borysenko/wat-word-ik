# Sources

> **Status: M0 demo, one exception.** The data in this version is demo data,
> made up for this prototype and approximate. The exception is the admission
> by school profile on the onderbouw page, checked against Ratho (see
> "Admission by profile" below). The other sources are **planned for M1**.

| Source | What it could provide | Status |
|--------|----------------------|--------|
| O*NET (US Department of Labor) | Knowledge areas and their importance per occupation | planned for M1 |
| ESCO (European Commission) | European classification of occupations and skills, with Dutch labels | planned for M1 |
| Ratho (Regeling aanmelding en toelating hoger onderwijs) | The Dutch regulation on admission to higher education: which school profile and subjects each hbo and wo programme asks for | used for `admission` (below); the rest planned for M1 |
| ROA (Maastricht University) | Labour market forecasts per education type | planned for M1 |
| CBS (Statistics Netherlands) | Wages and employment per occupation | planned for M1 |
| DUO | Programmes, levels and admission requirements in Dutch education | planned for M1 |

The onderbouw page (`onderbouw.html`) adds rules of its own. Which vmbo
direction fits each mbo profession best (`vmbo` in
`src/data/professions.ts`) is demo data, written by hand for this prototype.
It follows the general shape of the Dutch rules (a vmbo diploma of any
direction admits to mbo; mbo 4 admits to hbo).

## Admission by profile (`admission`)

Which havo or vwo profile admits to each hbo and wo profession directly or
with one extra exam subject was checked against the
[Regeling aanmelding en toelating hoger onderwijs](https://wetten.overheid.nl/BWBR0035059/2026-09-01/0)
(Ratho, BWBR0035059), version in force from 1 September 2026. Bijlage A holds
the extra requirements of wo programmes for vwo profiles. Bijlage B holds
those of hbo programmes, in a table for havo pupils (section 3
"Bachelorinstroom met havo-diploma") and one for vwo pupils (section 4
"Bachelorinstroom met vwo-diploma"); the hbo rows come from table Techniek of
each. A programme without a row in its table has no extra requirements, so
every profile admits (article 2.1: an institution can only ask for the
requirements in the bijlage).

The legend of both bijlagen (item 2) defines two symbols: `*` "dit profiel
geeft toelatingsrecht tot de betreffende opleiding", and `#` no right to
admission, though the institution may still admit a student after a test of
comparable requirements. A subject in a cell (`nat`, `biol`, `wisB`, ...;
item 1 lists the abbreviations) is read as: this profile admits with that
subject in the exam. The data holds one extra subject per profile, so:

- a cell with one subject, or a choice of subjects (`nat of nlt of o&o`),
  becomes that extra subject; for a choice, the data names one of them
  (physics; wiskunde A for `wisA of wisB`);
- a cell with two or more subjects (`nat + wisB`) is more than one step,
  and `#` is no admission: the data closes that profile (the stricter
  reading);
- an hbo profession has two rules, one per table: `admission` for havo
  pupils (and at the vmbo levels, whose routes pass havo 4) and
  `admission.vwo` for vwo pupils, each with its own source.

Each row was read twice, with differently worded questions, and accepted
only when both readings agreed; a row that did not settle would stay marked
`verified: false` with the stricter reading. Every row below settled. Each
profession keeps its row in `admission.source` (bijlage, table, programme
as written, the four cells, version, intake, `verified`). The unit tests
check that every `*` is direct, that a cell with one subject or a choice
is a bridge to one of its subjects, and that a cell with `+` or `#` is
closed.

### wo (Bijlage A) and hbo for havo pupils (Bijlage B, section 3)

| Profession (`id`) | Programme | Bijlage | NT | NG | EM | CM | Verified |
|---|---|---|---|---|---|---|---|
| `elektrotechnisch-ingenieur` | Elektrotechniek | B | * | * | * | wisA of wisB | yes |
| `mechatronica-engineer` | Mechatronica | B | * | nat of nlt of o&o of PgP-T | nat of nlt of o&o of PgP-T | (wisA of wisB) + (nat of nlt of o&o of PgP-T) | yes |
| `leraar-basisonderwijs` | Opleiding tot leraar basisonderwijs | B | no row | | | | yes |
| `software-engineer` | Technische Informatica | B | * | * | * | wisA of wisB | yes |
| `journalist` | Journalistiek | B | no row | | | | yes |
| `bouwkundig-ingenieur` | Built Environment | B | * | * | * | wisA of wisB | yes |
| `game-designer` | Creative Media and Game Technologies | B | * | * | * | wisA of wisB | yes |
| `archeoloog` | Archeologie | B | no row | | | | yes |
| `arts` | Geneeskunde | A | biol | nat | # | # | yes |
| `chirurg` | Geneeskunde | A | biol | nat | # | # | yes |
| `electrical-engineer` | Electrical Engineering | A | * | nat + wisB | nat + wisB | nat + wisB | yes |
| `wetenschapper` | Natuurkunde | A | * | nat + wisB | nat + wisB | nat + wisB | yes |
| `advocaat` | Rechtsgeleerdheid | A | no row | | | | yes |
| `architect` | Bouwkunde | A | * | nat + wisB | nat + wisB | nat + wisB | yes |
| `apotheker` | Farmacie | A | * | nat | nat + schk | nat + schk + (wisA of wisB) | yes |
| `dierenarts` | Diergeneeskunde | A | biol | nat | # | # | yes |

### hbo for vwo pupils (Bijlage B, section 4, table Techniek)

| Profession (`id`) | Programme | NT | NG | EM | CM | Verified |
|---|---|---|---|---|---|---|
| `elektrotechnisch-ingenieur` | Elektrotechniek | * | * | * | wisA of wisB | yes |
| `mechatronica-engineer` | Mechatronica | * | nat of nlt of o&o | nat of nlt of o&o | (wisA of wisB) + (nat of nlt of o&o) | yes |
| `leraar-basisonderwijs` | Opleiding tot leraar basisonderwijs | no row | | | | yes |
| `software-engineer` | Technische Informatica | no row | | | | yes |
| `journalist` | Journalistiek | no row | | | | yes |
| `bouwkundig-ingenieur` | Built Environment | * | * | * | wisA of wisB | yes |
| `game-designer` | Creative Media and Game Technologies | no row | | | | yes |
| `archeoloog` | Archeologie | no row | | | | yes |

So from vwo, Technische Informatica and Creative Media and Game Technologies
admit every profile, while from havo C&M needs wiskunde A or B.

What the rows say that the profile data does not show:

- Geneeskunde and Diergeneeskunde admit no profile without an extra
  subject: N&T needs biology, N&G physics.
- Creative Media and Game Technologies (footnote 1): the programme can ask
  for more under article 7.26 or 7.26a of the law (WHW).
- Opleiding tot leraar basisonderwijs: Bijlage F and article 2.6 ask for
  knowledge of geography, history, and nature and technology, met with those
  exam subjects or else shown in a test. That is not a profile rule.
- Bijlage A, table Techniek (Electrical Engineering, Bouwkunde), footnote 1:
  the institution may let an N&G pupil meet `nat` and `wisB` by the end of
  the first year. The door stays closed for N&G (the stricter reading), and
  the card says it in its own line ("With N&G some universities let you
  catch up physics and maths B in the first year"), from `source.catchUp`.

When real data arrives, each number and rule on the pages should be
traceable to one of these sources, and this file will describe how it was
mapped.
