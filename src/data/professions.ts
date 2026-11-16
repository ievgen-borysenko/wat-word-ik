import type { AdmissionSource, Need, Profession, SubjectId } from '../engine/types';
import { L } from './subjects';

/*
 * DEMO data (M0), made up for this prototype; no source has been used yet.
 * Requirements, levels and pay are rough approximations meant to make the
 * picture readable, not real admission rules. Real sources are planned for M1
 * (see docs/sources.md).
 *
 * The same holds for `vmbo`, which only the onderbouw view reads: which vmbo
 * direction fits an mbo profession best.
 *
 * `admission` is the exception: which havo or vwo profile admits to an hbo or wo
 * programme was checked against the Dutch admission regulation (Ratho, version
 * in force from 1 September 2026), and each row names its programme and the
 * cells as written in `source`. hbo has two rules, because the regulation has a
 * table for havo pupils and one for vwo pupils: `admission` and `admission.vwo`.
 * Which programme stands for a profession is an editorial choice. Where a row asks for more than the data can hold (two extra
 * subjects, or one of several), the data holds the stricter reading and the
 * note says so. docs/sources.md lists every row.
 *
 * Order inside a floor is the fixed tile order on screen.
 */

/** The version of the Ratho (BWBR0035059) that the `admission` rows were checked against. */
export const RATHO_VERSION = '2026-09-01';
export const RATHO_URL = `https://wetten.overheid.nl/BWBR0035059/${RATHO_VERSION}/0`;

/** The hbo tables the hbo rows come from: Bijlage B has one for havo pupils and one for vwo pupils. */
const HBO_TECHNIEK_HAVO = '3. Bachelorinstroom met havo-diploma: Techniek (instroom met havo-diploma)';
const HBO_TECHNIEK_VWO = '4. Bachelorinstroom met vwo-diploma: Techniek (instroom met vwo-diploma)';
const WISA_OR_B = 'C&M: wiskunde A or wiskunde B; the data names wiskunde A.';
const TWO_SUBJECTS = 'Two extra subjects for N&G, E&M and C&M: more than one step, so the data closes those profiles.';
const TECHNIEK_FOOTNOTE = 'Footnote 1 of the table: the institution may let an N&G pupil meet nat and wisB by the end of the first year.';
const HASH = '#: no right to admission; the institution may still admit after a test of comparable requirements.';
const PABO =
  'Not a profile rule: Bijlage F and article 2.6 ask for knowledge of geography, history, and nature and technology, met with those exam subjects or else shown in a test.';
/** Bijlage A, table Techniek, footnote 1: N&G may catch up nat and wisB in the first year. */
const TECHNIEK_CATCH_UP: AdmissionSource['catchUp'] = { profiles: ['ng'], subjects: ['natuurkunde', 'wiskunde-b'] };

/** A programme with a row in Bijlage A or B; `cells` are NT, NG, EM, CM as written. */
function ratho(
  bijlage: 'A' | 'B',
  intake: 'havo' | 'vwo',
  table: string,
  programme: string,
  [nt, ng, em, cm]: readonly [string, string, string, string],
  note?: string,
  catchUp?: AdmissionSource['catchUp'],
): AdmissionSource {
  const base = { bijlage, intake, table, programme, cells: { nt, ng, em, cm }, version: RATHO_VERSION, verified: true };
  return { ...base, ...(note === undefined ? {} : { note }), ...(catchUp === undefined ? {} : { catchUp }) };
}

/** A programme without a row in the bijlage (or that table): no extra requirements, every profile admits. */
function notListed(bijlage: 'A' | 'B', intake: 'havo' | 'vwo', programme: string, note?: string): AdmissionSource {
  const base = { bijlage, intake, table: null, programme, cells: null, version: RATHO_VERSION, verified: true };
  return note === undefined ? base : { ...base, note };
}

/** Every profile admits directly. */
const ALL = ['nt', 'ng', 'em', 'cm'] as const;

const n = (subject: SubjectId, min: number): Need => ({ subject, min });

export const PROFESSIONS: readonly Profession[] = [
  // ── Level 0: no diploma needed ──────────────────────────────────────────
  {
    id: 'schoonmaker',
    level: 0,
    emoji: '🧹',
    name: L('Schoonmaker', 'Cleaner', 'Прибиральник'),
    about: L(
      'Houdt scholen, kantoren en ziekenhuizen schoon en veilig; je moet betrouwbaar zijn en zorgvuldig werken.',
      'Keeps schools, offices and hospitals clean and safe; you need to be reliable and work carefully.',
      'Тримає школи, офіси й лікарні чистими та безпечними; треба бути надійним і працювати акуратно.',
    ),
    needs: [],
    pay: 1,
    family: 'schoonmaker',
    rung: 1,
    field: 'care',
  },
  {
    id: 'kassamedewerker',
    level: 0,
    emoji: '🛒',
    name: L('Kassamedewerker', 'Cashier', 'Касир'),
    about: L(
      'Helpt elke dag klanten bij de kassa; je bent vriendelijk, snel en precies met geld.',
      'Helps customers at the till every day; you need to be friendly, quick and accurate with money.',
      'Щодня обслуговує покупців на касі; треба бути привітним, швидким і точним із грошима.',
    ),
    needs: [],
    pay: 1,
    family: 'kassamedewerker',
    rung: 1,
    field: 'people',
  },
  {
    id: 'orderpicker',
    level: 0,
    emoji: '📦',
    name: L('Orderpicker', 'Warehouse order picker', 'Комплектувальник на складі'),
    short: L('Orderpicker', 'Order picker', 'Комплектувальник'),
    about: L(
      'Pakt producten in een groot magazijn zodat bestellingen op tijd verstuurd worden; het werk is lichamelijk en gaat snel.',
      'Collects products in a big warehouse so orders go out on time; the work is physical and fast-paced.',
      'Збирає товари на великому складі, щоб замовлення вчасно поїхали до людей; робота фізична і в швидкому темпі.',
    ),
    needs: [],
    pay: 1,
    family: 'logistiek',
    rung: 1,
    field: 'people',
  },
  {
    id: 'maaltijdbezorger',
    level: 0,
    emoji: '🛵',
    name: L('Maaltijdbezorger', 'Food delivery courier', 'Кур’єр доставки їжі'),
    short: L('Bezorger', 'Courier', 'Кур’єр'),
    about: L(
      'Brengt maaltijden bij mensen thuis op de fiets of scooter, in elk weer.',
      'Brings meals to people’s doors by bike or scooter, in any weather.',
      'Привозить їжу людям додому на велосипеді чи скутері, за будь-якої погоди.',
    ),
    needs: [],
    pay: 1,
    family: 'maaltijdbezorger',
    rung: 1,
    field: 'people',
  },
  {
    id: 'keukenhulp',
    level: 0,
    emoji: '🍽️',
    name: L('Keukenhulp', 'Kitchen assistant', 'Помічник на кухні'),
    about: L(
      'Helpt in de keuken van een restaurant: afwassen, groente snijden en alles schoonhouden.',
      'Helps in a restaurant kitchen: washing up, chopping vegetables and keeping everything clean.',
      'Допомагає на кухні ресторану: миє посуд, нарізає овочі, підтримує чистоту.',
    ),
    needs: [],
    pay: 1,
    family: 'keuken',
    rung: 1,
    field: 'making',
  },

  // ── Level 1: mbo 2-3 ─────────────────────────────────────────────────────
  {
    id: 'elektromonteur',
    level: 1,
    emoji: '🔌',
    name: L('Monteur elektrotechnische installaties', 'Electrical installer', 'Монтажник електроустановок'),
    short: L('Elektromonteur', 'Electrician', 'Електромонтажник'),
    about: L(
      'Legt bedrading, stopcontacten en zonnepanelen aan in huizen; je moet stroom begrijpen en heel veilig werken.',
      'Installs wiring, sockets and solar panels in houses; you need to understand electric current and work very safely.',
      'Прокладає проводку, ставить розетки й сонячні панелі в будинках; треба розуміти струм і працювати дуже безпечно.',
    ),
    needs: [n('techniek', 6), n('natuurkunde', 5), n('wiskunde', 5)],
    pay: 2,
    family: 'elektro',
    rung: 1,
    field: 'technology',
    vmbo: 'techniek',
  },
  {
    id: 'timmerman',
    level: 1,
    emoji: '🪚',
    name: L('Timmerman', 'Carpenter', 'Тесля'),
    about: L(
      'Bouwt daken, vloeren en kozijnen van hout; je hebt vaste handen, geduld en wat natuurkunde en wiskunde nodig om goed te meten.',
      'Builds roofs, floors and window frames from wood; you need steady hands, patience and some physics and maths to measure right.',
      'Будує дахи, підлоги й віконні рами з дерева; потрібні тверді руки, терпіння і трохи фізики та математики, щоб точно міряти.',
    ),
    needs: [n('techniek', 6), n('wiskunde', 5), n('natuurkunde', 4)],
    pay: 2,
    family: 'bouw',
    rung: 1,
    field: 'making',
    vmbo: 'techniek',
  },
  {
    id: 'kapper',
    level: 1,
    emoji: '💇',
    name: L('Kapper', 'Hairdresser', 'Перукар'),
    about: L(
      'Knipt en stylt haar; je hebt oog voor vorm en kleur, precieze handen en je praat makkelijk met klanten.',
      'Cuts and styles hair; you need an eye for shape and colour, precise hands and an easy way with customers.',
      'Стриже й укладає волосся; потрібні око на форму й колір, точні руки і вміння поговорити з клієнтом.',
    ),
    needs: [n('kunst', 6), n('nederlands', 5)],
    pay: 2,
    family: 'kapper',
    rung: 1,
    field: 'people',
    vmbo: 'zorg',
  },
  {
    id: 'kok',
    level: 1,
    emoji: '🍳',
    name: L('Kok', 'Cook', 'Кухар'),
    about: L(
      'Maakt gerechten in een restaurantkeuken; je weet hoe ingrediënten werken, je werkt schoon en blijft rustig als het druk is.',
      'Prepares dishes in a restaurant kitchen; you know how ingredients behave, work cleanly and stay calm when it gets busy.',
      'Готує страви на кухні ресторану; треба знати, як поводяться продукти, працювати чисто і не губитися, коли багато замовлень.',
    ),
    needs: [n('scheikunde', 5), n('biologie', 5), n('kunst', 5)],
    pay: 2,
    family: 'keuken',
    rung: 2,
    field: 'making',
    vmbo: 'economie',
  },
  {
    id: 'verzorgende',
    level: 1,
    emoji: '🤝',
    name: L('Verzorgende', 'Care worker', 'Працівник з догляду'),
    short: L('Verzorgende', 'Care worker', 'Доглядальник'),
    about: L(
      'Helpt ouderen of zieke mensen met de dagelijkse zorg; je kent het lichaam en je bent geduldig en vriendelijk.',
      'Helps older or sick people with daily care; you need to know how the body works and be patient and kind.',
      'Допомагає літнім або хворим людям у щоденному догляді; треба знати, як влаштоване тіло, і бути терплячим і уважним.',
    ),
    needs: [n('biologie', 6), n('nederlands', 5)],
    pay: 2,
    family: 'zorg',
    rung: 1,
    field: 'care',
    vmbo: 'zorg',
  },
  {
    id: 'vrachtwagenchauffeur',
    level: 1,
    emoji: '🚚',
    name: L('Vrachtwagenchauffeur', 'Lorry driver', 'Водій вантажівки'),
    short: L('Chauffeur', 'Lorry driver', 'Водій вантажівки'),
    about: L(
      'Rijdt goederen door het land en naar het buitenland; je plant routes, leest kaarten en spreekt wat Engels.',
      'Drives goods across the country and abroad; you plan routes, read maps and speak some English.',
      'Возить вантажі по країні й за кордон; треба планувати маршрути, читати карти і трохи говорити англійською.',
    ),
    needs: [n('aardrijkskunde', 6), n('engels', 6), n('techniek', 4)],
    pay: 2,
    family: 'logistiek',
    rung: 2,
    field: 'technology',
    vmbo: 'techniek',
  },
  {
    id: 'hovenier',
    level: 1,
    emoji: '🌳',
    name: L('Hovenier', 'Gardener and landscaper', 'Садівник-озеленювач'),
    short: L('Hovenier', 'Gardener', 'Садівник'),
    about: L(
      'Legt tuinen en parken aan en onderhoudt ze; je kent planten, de bodem en het weer.',
      'Builds and looks after gardens and parks; you need to know plants, soil and weather.',
      'Створює сади й парки і доглядає за ними; треба знати рослини, ґрунт і погоду.',
    ),
    needs: [n('aardrijkskunde', 6), n('biologie', 6), n('techniek', 5)],
    pay: 2,
    family: 'hovenier',
    rung: 1,
    field: 'nature',
    vmbo: 'groen',
  },
  {
    id: 'automonteur',
    level: 1,
    emoji: '🚗',
    name: L('Automonteur', 'Car mechanic', 'Автомеханік'),
    about: L(
      'Zoekt en repareert storingen in auto’s, ook elektrische; je hebt technisch inzicht en geduld om stap voor stap te zoeken.',
      'Finds and fixes faults in cars, electric ones too; you need technical insight and the patience to search step by step.',
      'Шукає і лагодить несправності в автомобілях, зокрема електричних; потрібні технічне чуття і терпіння шукати крок за кроком.',
    ),
    needs: [n('techniek', 6), n('natuurkunde', 5), n('engels', 5)],
    pay: 2,
    family: 'machines',
    rung: 1,
    field: 'technology',
    vmbo: 'techniek',
  },

  // ── Level 2: mbo 4 ───────────────────────────────────────────────────────
  {
    id: 'technicus-elektrotechniek',
    level: 2,
    emoji: '💡',
    name: L('Technicus elektrotechniek', 'Electrical technician', 'Технік-електрик'),
    short: L('Technicus elektro', 'Electrical technician', 'Технік-електрик'),
    about: L(
      'Installeert en onderhoudt elektrische systemen in fabrieken en gebouwen; je hebt goede kennis van natuurkunde en wiskunde nodig.',
      'Sets up and maintains electrical systems in factories and buildings; you need a good grasp of physics and maths.',
      'Налаштовує й обслуговує електросистеми на заводах і в будівлях; потрібні добрі знання фізики й математики.',
    ),
    needs: [n('natuurkunde', 6), n('wiskunde', 6), n('techniek', 6)],
    pay: 3,
    family: 'elektro',
    rung: 2,
    field: 'technology',
    vmbo: 'techniek',
  },
  {
    id: 'verpleegkundige',
    level: 2,
    emoji: '🩺',
    name: L('Verpleegkundige (mbo)', 'Nurse (mbo)', 'Медсестра / медбрат (mbo)'),
    short: L('Verpleegkundige', 'Nurse', 'Медсестра / медбрат'),
    about: L(
      'Zorgt voor patiënten in het ziekenhuis, geeft medicijnen en let op hoe het met ze gaat; je hebt biologie en een rustig hoofd nodig.',
      'Cares for patients in hospital, gives medicines and keeps an eye on how they are doing; you need biology and a calm head.',
      'Доглядає пацієнтів у лікарні, дає ліки і стежить за їхнім станом; потрібні біологія і спокійна голова.',
    ),
    needs: [n('biologie', 6), n('nederlands', 6), n('scheikunde', 5)],
    pay: 3,
    family: 'zorg',
    rung: 2,
    field: 'care',
    vmbo: 'zorg',
  },
  {
    id: 'meubelmaker',
    level: 2,
    emoji: '🪑',
    name: L(
      'Meubelmaker / werkvoorbereider bouw',
      'Furniture maker / construction planner',
      'Меблевий майстер / підготовник будівельних робіт',
    ),
    short: L('Meubelmaker', 'Furniture maker', 'Меблевий майстер'),
    about: L(
      'Maakt meubels op maat of plant het werk op de bouwplaats; je werkt met precieze tekeningen, wiskunde en gevoel voor materiaal.',
      'Makes furniture to measure or plans the work on a building site; you work with precise drawings, maths and a feel for materials.',
      'Робить меблі на замовлення або планує роботу на будівництві; потрібні точні креслення, математика і відчуття матеріалу.',
    ),
    needs: [n('techniek', 7), n('wiskunde', 6), n('kunst', 5), n('natuurkunde', 4)],
    pay: 3,
    family: 'bouw',
    rung: 2,
    field: 'making',
    vmbo: 'techniek',
  },
  {
    id: 'laborant',
    level: 2,
    emoji: '🔬',
    name: L('Laborant', 'Lab technician', 'Лаборант'),
    about: L(
      'Doet onderzoek in een lab, bijvoorbeeld naar bloed, water of voedsel; je hebt scheikunde nodig en werkt heel nauwkeurig.',
      'Runs tests in a lab, for example on blood, water or food; you need chemistry and have to work very precisely.',
      'Робить аналізи в лабораторії, наприклад крові, води чи їжі; потрібні хімія і дуже точна робота.',
    ),
    needs: [n('scheikunde', 7), n('biologie', 6), n('wiskunde', 5)],
    pay: 3,
    family: 'lab',
    rung: 1,
    field: 'nature',
    vmbo: 'techniek',
  },
  {
    id: 'politieagent',
    level: 2,
    emoji: '👮',
    name: L('Politieagent', 'Police officer', 'Поліцейський'),
    about: L(
      'Zorgt voor veiligheid en helpt als er iets misgaat; je kent de wet en de samenleving, schrijft duidelijke verslagen en blijft rustig.',
      'Keeps people safe and helps when something goes wrong; you know the law and society, write clear reports and stay calm.',
      'Береже безпеку людей і допомагає, коли щось сталося; треба знати закон і суспільство, писати чіткі звіти і зберігати спокій.',
    ),
    needs: [n('geschiedenis', 6), n('nederlands', 6), n('aardrijkskunde', 5)],
    pay: 3,
    family: 'recht',
    rung: 1,
    field: 'people',
    vmbo: 'zorg',
  },
  {
    id: 'grafisch-vormgever',
    level: 2,
    emoji: '🖌️',
    name: L('Grafisch vormgever', 'Graphic designer', 'Графічний дизайнер'),
    about: L(
      'Ontwerpt posters, logo’s en websites; je hebt oog voor kleur en vorm en begrijpt wat de klant wil.',
      'Designs posters, logos and websites; you need an eye for colour and shape and to understand what the client wants.',
      'Створює плакати, логотипи й сайти; потрібні око на колір і форму і вміння зрозуміти, чого хоче клієнт.',
    ),
    needs: [n('kunst', 7), n('nederlands', 5), n('engels', 5)],
    pay: 3,
    family: 'ontwerp',
    rung: 1,
    field: 'making',
    vmbo: 'techniek',
  },
  {
    id: 'applicatieontwikkelaar',
    level: 2,
    emoji: '📱',
    name: L('Applicatieontwikkelaar', 'App developer', 'Розробник застосунків'),
    short: L('App-ontwikkelaar', 'App developer', 'Розробник застосунків'),
    about: L(
      'Bouwt apps en websites met code; je denkt logisch en hebt wiskunde en Engels nodig om documentatie te lezen.',
      'Builds apps and websites with code; you think logically and need maths and English to read documentation.',
      'Пише застосунки й сайти; потрібні логічне мислення, математика й англійська, щоб читати документацію.',
    ),
    needs: [n('wiskunde', 6), n('engels', 6), n('techniek', 6)],
    pay: 3,
    family: 'software',
    rung: 1,
    field: 'technology',
    vmbo: 'techniek',
  },

  // ── Level 3: hbo ─────────────────────────────────────────────────────────
  {
    id: 'elektrotechnisch-ingenieur',
    level: 3,
    emoji: '⚡',
    name: L('Elektrotechnisch ingenieur (hbo)', 'Electrical engineer (hbo)', 'Інженер-електрик (hbo)'),
    short: L('E-ingenieur (hbo)', 'E-engineer (hbo)', 'Інженер-електрик'),
    about: L(
      'Ontwerpt elektrische systemen, zoals laadpalen en slimme stroomnetten; je hebt sterke natuurkunde en wiskunde nodig.',
      'Designs electrical systems such as charging points and smart power grids; you need strong physics and maths.',
      'Проєктує електросистеми, наприклад зарядні станції та розумні електромережі; потрібні сильні фізика й математика.',
    ),
    needs: [n('natuurkunde', 7), n('wiskunde', 7), n('techniek', 6)],
    pay: 4,
    family: 'elektro',
    rung: 3,
    field: 'technology',
    admission: {
      direct: ['nt', 'ng', 'em'],
      bridge: { cm: 'wiskunde-a' },
      source: ratho('B', 'havo', HBO_TECHNIEK_HAVO, 'Elektrotechniek', ['*', '*', '*', 'wisA of wisB'], WISA_OR_B),
      vwo: {
        direct: ['nt', 'ng', 'em'],
        bridge: { cm: 'wiskunde-a' },
        source: ratho('B', 'vwo', HBO_TECHNIEK_VWO, 'Elektrotechniek', ['*', '*', '*', 'wisA of wisB'], WISA_OR_B),
      },
    },
  },
  {
    id: 'mechatronica-engineer',
    level: 3,
    emoji: '🦾',
    name: L('Mechatronica- / robotica-engineer', 'Mechatronics / robotics engineer', 'Інженер мехатроніки / робототехніки'),
    short: L('Robotica-engineer', 'Robotics engineer', 'Інженер-робототехнік'),
    about: L(
      'Bouwt machines en robots waarin mechanica, elektronica en software samenkomen.',
      'Builds machines and robots where mechanics, electronics and software come together.',
      'Створює машини й роботів, де поєднуються механіка, електроніка і програми.',
    ),
    needs: [n('wiskunde', 7), n('natuurkunde', 7), n('techniek', 7), n('engels', 5)],
    pay: 4,
    family: 'machines',
    rung: 2,
    field: 'technology',
    admission: {
      direct: ['nt'],
      bridge: { ng: 'natuurkunde', em: 'natuurkunde' },
      source: ratho(
        'B',
        'havo',
        HBO_TECHNIEK_HAVO,
        'Mechatronica',
        ['*', 'nat of nlt of o&o of PgP-T', 'nat of nlt of o&o of PgP-T', '(wisA of wisB) + (nat of nlt of o&o of PgP-T)'],
        'N&G and E&M: physics, or nlt, o&o or PgP-T instead; the data names physics. C&M needs two extra subjects: more than one step, so the data closes it.',
      ),
      vwo: {
        direct: ['nt'],
        bridge: { ng: 'natuurkunde', em: 'natuurkunde' },
        source: ratho(
          'B',
          'vwo',
          HBO_TECHNIEK_VWO,
          'Mechatronica',
          ['*', 'nat of nlt of o&o', 'nat of nlt of o&o', '(wisA of wisB) + (nat of nlt of o&o)'],
          'N&G and E&M: physics, or nlt or o&o instead; the data names physics. C&M needs two extra subjects: more than one step, so the data closes it.',
        ),
      },
    },
  },
  {
    id: 'leraar-basisonderwijs',
    level: 3,
    emoji: '🧑‍🏫',
    name: L('Leraar basisonderwijs', 'Primary school teacher', 'Вчитель початкової школи'),
    short: L('Juf / meester', 'Primary teacher', 'Вчитель'),
    about: L(
      'Leert kinderen in groep 1 tot en met 8 van alles, van lezen tot rekenen; je legt goed uit en weet van elk vak iets.',
      'Teaches children in groep 1 to 8 everything from reading to sums; you explain things well and know a bit of every subject.',
      'Навчає дітей з groep 1 до 8 усього - від читання до математики; треба вміти зрозуміло пояснювати і знати потроху з кожного предмета.',
    ),
    needs: [n('nederlands', 7), n('wiskunde', 6), n('geschiedenis', 6)],
    pay: 3,
    family: 'onderwijs',
    rung: 1,
    field: 'people',
    admission: {
      direct: ALL,
      bridge: {},
      source: notListed('B', 'havo', 'Opleiding tot leraar basisonderwijs', PABO),
      vwo: { direct: ALL, bridge: {}, source: notListed('B', 'vwo', 'Opleiding tot leraar basisonderwijs', PABO) },
    },
  },
  {
    id: 'software-engineer',
    level: 3,
    emoji: '💻',
    name: L('Software engineer', 'Software engineer', 'Інженер-програміст'),
    about: L(
      'Ontwerpt grote softwaresystemen die veel mensen gebruiken; je hebt wiskunde, logica en goed Engels nodig.',
      'Designs large software systems that many people use; you need maths, logic and good English.',
      'Проєктує великі програмні системи, якими користується багато людей; потрібні математика, логіка і добра англійська.',
    ),
    needs: [n('wiskunde', 7), n('engels', 7), n('techniek', 6)],
    pay: 4,
    family: 'software',
    rung: 2,
    field: 'technology',
    admission: {
      direct: ['nt', 'ng', 'em'],
      bridge: { cm: 'wiskunde-a' },
      source: ratho('B', 'havo', HBO_TECHNIEK_HAVO, 'Technische Informatica', ['*', '*', '*', 'wisA of wisB'], WISA_OR_B),
      vwo: { direct: ALL, bridge: {}, source: notListed('B', 'vwo', 'Technische Informatica') },
    },
  },
  {
    id: 'journalist',
    level: 3,
    emoji: '📰',
    name: L('Journalist', 'Journalist', 'Журналіст'),
    about: L(
      'Zoekt uit wat er gebeurt en vertelt het helder in tekst, video of podcast; je hebt sterke taal nodig en begrijpt de samenleving.',
      'Finds out what is happening and tells it clearly in text, video or podcast; you need strong language skills and to understand society.',
      'З’ясовує, що відбувається, і зрозуміло розповідає про це в тексті, відео чи подкасті; потрібні сильна мова і розуміння суспільства.',
    ),
    needs: [n('nederlands', 7), n('engels', 6), n('geschiedenis', 6)],
    pay: 3,
    family: 'media',
    rung: 1,
    field: 'people',
    admission: {
      direct: ALL,
      bridge: {},
      source: notListed('B', 'havo', 'Journalistiek'),
      vwo: { direct: ALL, bridge: {}, source: notListed('B', 'vwo', 'Journalistiek') },
    },
  },
  {
    id: 'bouwkundig-ingenieur',
    level: 3,
    emoji: '🏗️',
    name: L('Bouwkundig ingenieur', 'Construction engineer', 'Інженер-будівельник'),
    short: L('Bouwkundige', 'Construction engineer', 'Інженер-будівельник'),
    about: L(
      'Rekent uit of bruggen en gebouwen sterk en veilig zijn; je hebt wiskunde en natuurkunde nodig.',
      'Works out whether bridges and buildings are strong and safe; you need maths and physics.',
      'Розраховує, чи міцні й безпечні мости та будівлі; потрібні математика і фізика.',
    ),
    needs: [n('wiskunde', 7), n('natuurkunde', 6), n('techniek', 7), n('kunst', 5)],
    pay: 4,
    family: 'bouw',
    rung: 3,
    field: 'making',
    admission: {
      direct: ['nt', 'ng', 'em'],
      bridge: { cm: 'wiskunde-a' },
      source: ratho('B', 'havo', HBO_TECHNIEK_HAVO, 'Built Environment', ['*', '*', '*', 'wisA of wisB'], WISA_OR_B),
      vwo: {
        direct: ['nt', 'ng', 'em'],
        bridge: { cm: 'wiskunde-a' },
        source: ratho('B', 'vwo', HBO_TECHNIEK_VWO, 'Built Environment', ['*', '*', '*', 'wisA of wisB'], WISA_OR_B),
      },
    },
  },
  {
    id: 'game-designer',
    level: 3,
    emoji: '🎮',
    name: L('Game designer', 'Game designer', 'Геймдизайнер'),
    about: L(
      'Bedenkt spelwerelden, regels en personages; je hebt creativiteit, kunst en wat wiskunde voor de spellogica nodig.',
      'Invents game worlds, rules and characters; you need creativity, art and some maths for the game logic.',
      'Вигадує ігрові світи, правила і персонажів; потрібні творчість, мистецтво і трохи математики для логіки гри.',
    ),
    needs: [n('kunst', 7), n('wiskunde', 6), n('engels', 6), n('nederlands', 5)],
    pay: 3,
    family: 'ontwerp',
    rung: 2,
    field: 'making',
    admission: {
      direct: ['nt', 'ng', 'em'],
      bridge: { cm: 'wiskunde-a' },
      source: ratho(
        'B',
        'havo',
        HBO_TECHNIEK_HAVO,
        'Creative Media and Game Technologies',
        ['*', '*', '*', 'wisA of wisB'],
        `${WISA_OR_B} Footnote 1: extra requirements under article 7.26 or 7.26a of the law (WHW).`,
      ),
      vwo: { direct: ALL, bridge: {}, source: notListed('B', 'vwo', 'Creative Media and Game Technologies') },
    },
  },
  {
    id: 'archeoloog',
    level: 3,
    emoji: '🏺',
    name: L('Archeoloog (hbo)', 'Archaeologist (hbo)', 'Археолог (hbo)'),
    short: L('Archeoloog', 'Archaeologist', 'Археолог'),
    about: L(
      'Graaft sporen uit het verleden op en onderzoekt ze, van munten tot hele dorpen; je hebt geschiedenis, kaarten en zorgvuldige aantekeningen nodig.',
      'Digs up and studies traces of the past, from coins to whole villages; you need history, maps and careful notes.',
      'Розкопує і досліджує сліди минулого - від монет до цілих сіл; потрібні історія, карти і ретельні записи.',
    ),
    needs: [n('geschiedenis', 7), n('aardrijkskunde', 6), n('nederlands', 6)],
    pay: 3,
    family: 'erfgoed',
    rung: 1,
    field: 'nature',
    admission: {
      direct: ALL,
      bridge: {},
      source: notListed('B', 'havo', 'Archeologie'),
      vwo: { direct: ALL, bridge: {}, source: notListed('B', 'vwo', 'Archeologie') },
    },
  },

  // ── Level 4: wo ──────────────────────────────────────────────────────────
  {
    id: 'arts',
    level: 4,
    emoji: '🧑‍⚕️',
    name: L('Arts', 'Doctor', 'Лікар'),
    about: L(
      'Onderzoekt wat patiënten hebben en behandelt ze; je hebt veel biologie en scheikunde nodig en studeert vele jaren.',
      'Finds out what is wrong with patients and treats them; you need a lot of biology and chemistry and many years of study.',
      'З’ясовує, що з пацієнтом, і лікує його; потрібно багато біології та хімії і роки навчання.',
    ),
    needs: [n('biologie', 8), n('scheikunde', 8), n('natuurkunde', 7), n('nederlands', 7)],
    pay: 5,
    family: 'zorg',
    rung: 3,
    field: 'care',
    admission: {
      direct: [],
      bridge: { nt: 'biologie', ng: 'natuurkunde' },
      source: ratho('A', 'vwo', 'Gezondheidszorg', 'Geneeskunde', ['biol', 'nat', '#', '#'], HASH),
    },
  },
  {
    id: 'chirurg',
    level: 4,
    emoji: '🫀',
    name: L('Chirurg', 'Surgeon', 'Хірург'),
    about: L(
      'Opereert mensen om hun lichaam te herstellen; je hebt veel kennis van biologie, heel vaste handen en urenlange concentratie nodig.',
      'Operates on people to repair their bodies; you need deep biology, very steady hands and focus for hours.',
      'Оперує людей, щоб відновити їхнє тіло; потрібні глибока біологія, дуже тверді руки і зосередженість годинами.',
    ),
    needs: [n('biologie', 9), n('scheikunde', 8), n('natuurkunde', 7), n('nederlands', 7), n('techniek', 7)],
    pay: 5,
    family: 'zorg',
    rung: 4,
    field: 'care',
    admission: {
      direct: [],
      bridge: { nt: 'biologie', ng: 'natuurkunde' },
      source: ratho('A', 'vwo', 'Gezondheidszorg', 'Geneeskunde', ['biol', 'nat', '#', '#'], HASH),
    },
  },
  {
    id: 'electrical-engineer',
    level: 4,
    emoji: '🛰️',
    name: L('Electrical engineer (wo)', 'Electrical engineer (wo)', 'Інженер-електрик (wo)'),
    short: L('Electrical engineer', 'Electrical engineer', 'Інженер-електрик (wo)'),
    about: L(
      'Onderzoekt en ontwerpt nieuwe elektronica, chips en energiesystemen; je hebt heel sterke natuurkunde en wiskunde nodig.',
      'Researches and designs new electronics, chips and energy systems; you need very strong physics and maths.',
      'Досліджує і створює нову електроніку, мікросхеми та енергосистеми; потрібні дуже сильні фізика й математика.',
    ),
    needs: [n('natuurkunde', 8), n('wiskunde', 8), n('techniek', 7)],
    pay: 4,
    family: 'elektro',
    rung: 4,
    field: 'nature',
    admission: {
      direct: ['nt'],
      bridge: {},
      source: ratho(
        'A',
        'vwo',
        'Techniek',
        'Electrical Engineering',
        ['*', 'nat + wisB', 'nat + wisB', 'nat + wisB'],
        `${TWO_SUBJECTS} ${TECHNIEK_FOOTNOTE}`,
        TECHNIEK_CATCH_UP,
      ),
    },
  },
  {
    id: 'wetenschapper',
    level: 4,
    emoji: '🤖',
    name: L(
      'Wetenschapper (robotica / natuurwetenschap)',
      'Scientist (robotics / natural science)',
      'Науковець (робототехніка / природничі науки)',
    ),
    short: L('Wetenschapper', 'Scientist', 'Науковець'),
    about: L(
      'Ontdekt nieuwe dingen met experimenten, bijvoorbeeld slimmere robots of nieuwe materialen; je hebt natuurkunde, wiskunde en Engels nodig om resultaten te delen.',
      'Discovers new things through experiments, for example smarter robots or new materials; you need physics, maths and English to share results.',
      'Відкриває нове через експерименти, наприклад розумніших роботів чи нові матеріали; потрібні фізика, математика й англійська, щоб ділитися результатами.',
    ),
    needs: [n('natuurkunde', 8), n('wiskunde', 8), n('scheikunde', 7), n('engels', 7), n('techniek', 7)],
    pay: 4,
    family: 'machines',
    rung: 3,
    field: 'nature',
    admission: {
      direct: ['nt'],
      bridge: {},
      source: ratho('A', 'vwo', 'Natuur', 'Natuurkunde', ['*', 'nat + wisB', 'nat + wisB', 'nat + wisB'], TWO_SUBJECTS),
    },
  },
  {
    id: 'advocaat',
    level: 4,
    emoji: '⚖️',
    name: L('Advocaat', 'Lawyer', 'Адвокат'),
    about: L(
      'Helpt mensen en bedrijven met de wet en verdedigt ze in de rechtszaal; je hebt uitstekende taal en kennis van geschiedenis en samenleving nodig.',
      'Helps people and companies with the law and defends them in court; you need excellent language skills and to know history and society.',
      'Допомагає людям і компаніям із законом і захищає їх у суді; потрібні відмінна мова, історія і розуміння суспільства.',
    ),
    needs: [n('nederlands', 8), n('geschiedenis', 7), n('engels', 7), n('aardrijkskunde', 5)],
    pay: 5,
    family: 'recht',
    rung: 2,
    field: 'people',
    admission: { direct: ALL, bridge: {}, source: notListed('A', 'vwo', 'Rechtsgeleerdheid') },
  },
  {
    id: 'architect',
    level: 4,
    emoji: '📐',
    name: L('Architect', 'Architect', 'Архітектор'),
    about: L(
      'Ontwerpt gebouwen die mooi, handig en veilig zijn; je hebt kunst en vormgeving, wiskunde en wat natuurkunde nodig.',
      'Designs buildings that are beautiful, practical and safe; you need art and design, maths and some physics.',
      'Проєктує будівлі - гарні, зручні й безпечні; потрібні мистецтво і дизайн, математика і трохи фізики.',
    ),
    needs: [n('kunst', 8), n('wiskunde', 7), n('natuurkunde', 6), n('techniek', 7)],
    pay: 4,
    family: 'bouw',
    rung: 4,
    field: 'making',
    admission: {
      direct: ['nt'],
      bridge: {},
      source: ratho(
        'A',
        'vwo',
        'Techniek',
        'Bouwkunde',
        ['*', 'nat + wisB', 'nat + wisB', 'nat + wisB'],
        `${TWO_SUBJECTS} ${TECHNIEK_FOOTNOTE}`,
        TECHNIEK_CATCH_UP,
      ),
    },
  },
  {
    id: 'apotheker',
    level: 4,
    emoji: '💊',
    name: L('Apotheker', 'Pharmacist', 'Фармацевт'),
    about: L(
      'Weet hoe medicijnen werken en zorgt dat elke patiënt het juiste medicijn krijgt; je hebt veel scheikunde en biologie nodig.',
      'Knows how medicines work and makes sure every patient gets the right one; you need a lot of chemistry and biology.',
      'Знає, як діють ліки, і стежить, щоб кожен пацієнт отримав правильні; потрібно багато хімії та біології.',
    ),
    needs: [n('scheikunde', 8), n('biologie', 7), n('wiskunde', 7)],
    pay: 5,
    family: 'lab',
    rung: 2,
    field: 'care',
    admission: {
      direct: ['nt'],
      bridge: { ng: 'natuurkunde' },
      source: ratho(
        'A',
        'vwo',
        'Natuur',
        'Farmacie',
        ['*', 'nat', 'nat + schk', 'nat + schk + (wisA of wisB)'],
        'E&M and C&M need two or more extra subjects: more than one step, so the data closes them.',
      ),
    },
  },
  {
    id: 'dierenarts',
    level: 4,
    emoji: '🐾',
    name: L('Dierenarts', 'Vet', 'Ветеринар'),
    about: L(
      'Onderzoekt en behandelt dieren, van katten tot koeien; je hebt biologie, scheikunde en rustige handen nodig.',
      'Examines and treats animals, from cats to cows; you need biology, chemistry and calm hands.',
      'Оглядає й лікує тварин - від котів до корів; потрібні біологія, хімія і спокійні руки.',
    ),
    needs: [n('biologie', 8), n('scheikunde', 7), n('natuurkunde', 6)],
    pay: 4,
    family: 'dierenarts',
    rung: 1,
    field: 'nature',
    admission: {
      direct: [],
      bridge: { nt: 'biologie', ng: 'natuurkunde' },
      source: ratho('A', 'vwo', 'Gezondheidszorg', 'Diergeneeskunde', ['biol', 'nat', '#', '#'], HASH),
    },
  },
];

export const PROFESSION_BY_ID: ReadonlyMap<string, Profession> = new Map(PROFESSIONS.map((p) => [p.id, p]));
export const PROFESSION_IDS: ReadonlySet<string> = new Set(PROFESSIONS.map((p) => p.id));
