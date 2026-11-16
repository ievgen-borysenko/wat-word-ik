# Sources

> **Status: M0 demo.** The data in this version is demo data, made up for
> this prototype and approximate. None of the sources below has been used
> yet; they are **planned for M1**.

| Source | What it could provide | Status |
|--------|----------------------|--------|
| O*NET (US Department of Labor) | Knowledge areas and their importance per occupation | planned for M1 |
| ESCO (European Commission) | European classification of occupations and skills, with Dutch labels | planned for M1 |
| Ratho (Regeling aanmelding en toelating hoger onderwijs) | The Dutch regulation on admission to higher education: which school profile and subjects each hbo and wo programme asks for | planned for M1 |
| ROA (Maastricht University) | Labour market forecasts per education type | planned for M1 |
| CBS (Statistics Netherlands) | Wages and employment per occupation | planned for M1 |
| DUO | Programmes, levels and admission requirements in Dutch education | planned for M1 |

The onderbouw page (`onderbouw.html`) adds rules of its own, and they are
demo data too, written by hand for this prototype: which vmbo direction fits
each mbo profession best (`vmbo` in `src/data/professions.ts`), and which havo
or vwo profile admits to each hbo and wo profession directly or with one
extra exam subject (`admission`). They follow the general shape of the Dutch
rules (a vmbo diploma of any direction admits to mbo; mbo 4 admits to hbo;
hbo and wo programmes ask for certain profiles and subjects), but no
programme's real requirements were looked up. Where a rule was not certain,
the stricter reading was written down. Ratho and DUO above are the planned
sources for the real rules.

When real data arrives, each number and rule on the pages should be
traceable to one of these sources, and this file will describe how it was
mapped.
