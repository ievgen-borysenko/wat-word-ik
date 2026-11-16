import { EXAM_SUBJECT_NAMES, OTHER_OPTION_NAMES } from '../data/secondary';
import { cellRuleOf, isExamSubject, judgeCell } from '../engine/exam';
import { admissionAt, isVmbo } from '../engine/route';
import {
  EXAM_SUBJECTS,
  HAVO_VWO_PROFILES,
  OTHER_OPTIONS,
  type ExamSubject,
  type HavoVwoProfile,
  type Lang,
  type Profession,
  type ProfileRule,
  type SchoolLevel,
  type SchoolProfile,
} from '../engine/types';
import { t, type MessageKey } from '../i18n';
import { examCounts, examTotals, examViews, extras, setExtra } from './examStore';
import { Header } from './Header';
import { openedBy } from './modal';
import { PageLink } from './OtherViewLink';
import { ChoicePanel, RouteAbout, RouteCard, RouteCardBody, RouteStreet, RouteSummary } from './RouteApp';
import { level, linkFragment, profile } from './routeStore';
import { andList, groupsText, profileList, profileShort, subjectName } from './routeText';
import { aboutOpen, lang } from './store';

/*
 * The bovenbouw view (bovenbouw.html): after the profile choice. The onderbouw view's
 * rows of buttons, doors, card and "How it works" (RouteApp.tsx), plus a box for each
 * exam subject the pupil takes on top of the profile, at havo and vwo. The doors judge
 * the admission rule of each hbo and wo programme on that profile and those subjects
 * (engine/exam.ts); the card says the rule in words, what the pupil has and what is
 * missing, and when to apply.
 */

/** The subject boxes: native checkboxes, one tab stop each, Space toggles. */
function ExtrasRow() {
  const l = lang.value;
  const chosen = new Set(extras.value);
  return (
    <fieldset class="choice choice-extras">
      <legend class="choice-title">{t(l, 'exam.extras.title')}</legend>
      <div class="extras-row">
        {EXAM_SUBJECTS.map((s) => {
          const checked = chosen.has(s);
          return (
            <label key={s} class={`extra-btn ${checked ? 'is-checked' : ''}`}>
              <input
                type="checkbox"
                class="extra-box"
                data-key={s}
                checked={checked}
                onChange={(ev) => setExtra(s, (ev.currentTarget as HTMLInputElement).checked)}
              />
              <span class="extra-label">{EXAM_SUBJECT_NAMES[s][l]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function isHavoVwoProfile(p: SchoolProfile | null): p is HavoVwoProfile {
  return p !== null && (HAVO_VWO_PROFILES as readonly string[]).includes(p);
}

/** The pupil's own line: what the profile and the subjects meet, and what is still missing. */
function yourLine(rule: ProfileRule, pr: HavoVwoProfile, chosen: ReadonlySet<ExamSubject>, l: Lang): string {
  const cell = cellRuleOf(rule, pr);
  const v = judgeCell(cell, chosen);
  const profile = profileShort(pr, l);
  if (v.kind === 'noRight') return t(l, 'exam.card.yoursNoRight', { profile });
  const groups = cell.kind === 'subjects' ? cell.groups : [];
  const have = EXAM_SUBJECTS.filter((s) => chosen.has(s) && groups.some((g) => g.includes(s))).map((s) => subjectName(s, l));
  if (v.kind === 'met') {
    return have.length === 0 ? t(l, 'exam.card.yoursAdmits', { profile }) : t(l, 'exam.card.yoursMet', { profile, subjects: andList(have, l) });
  }
  const subjects = groupsText(v.missing, l, false);
  return have.length === 0
    ? t(l, 'exam.card.yoursMissing', { profile, subjects })
    : t(l, 'exam.card.yoursPartly', { profile, have: andList(have, l), subjects });
}

/** The rule for every profile in words: the profiles that admit, the subjects each other profile needs, those without a right. */
function ruleLines(rule: ProfileRule, l: Lang): string[] {
  const cells = HAVO_VWO_PROFILES.map((pr) => ({ pr, cell: cellRuleOf(rule, pr) }));
  const admits = cells.filter((c) => c.cell.kind === 'admits').map((c) => c.pr);
  if (admits.length === HAVO_VWO_PROFILES.length) return [t(l, 'route.card.directAll')];
  const lines: string[] = [];
  if (admits.length > 0) lines.push(t(l, 'route.card.direct', { list: profileList(admits, l) }));
  // Profiles that need the same subjects share one line.
  const bySubjects = new Map<string, HavoVwoProfile[]>();
  for (const { pr, cell } of cells) {
    if (cell.kind !== 'subjects') continue;
    const text = groupsText(cell.groups, l, true);
    bySubjects.set(text, [...(bySubjects.get(text) ?? []), pr]);
  }
  for (const [subjects, profiles] of bySubjects) lines.push(t(l, 'exam.card.needs', { list: profileList(profiles, l), subjects }));
  const none = cells.filter((c) => c.cell.kind === 'noRight').map((c) => c.pr);
  if (none.length > 0) lines.push(t(l, 'exam.card.noRight', { list: profileList(none, l) }));
  return lines;
}

/**
 * The admission section: at havo for wo, that vwo 5 or an hbo first year comes first;
 * the pupil's own line (with a havo or vwo profile); the rule for every profile; the
 * subjects without a box, by their full names; a catch-up footnote; the regulation row
 * it was checked against; and at the vmbo levels, that the mbo 4 route has no profile rules.
 */
function admissionLines(p: Profession, lv: SchoolLevel, chosenProfile: SchoolProfile | null, chosen: ReadonlySet<ExamSubject>, l: Lang): string[] {
  if (!p.admission) return [];
  const rule = admissionAt(p, lv);
  const lines: string[] = [];
  if (p.level === 4 && lv === 'havo') lines.push(t(l, 'route.card.woFromHavo'));
  if (!isVmbo(lv) && isHavoVwoProfile(chosenProfile)) lines.push(yourLine(rule, chosenProfile, chosen, l));
  lines.push(...ruleLines(rule, l));
  const named = new Set(HAVO_VWO_PROFILES.flatMap((pr) => {
    const cell = cellRuleOf(rule, pr);
    return cell.kind === 'subjects' ? cell.groups.flat().filter((s) => !isExamSubject(s)) : [];
  }));
  const others = OTHER_OPTIONS.filter((o) => named.has(o)).map((o) => OTHER_OPTION_NAMES[o].name[l]);
  if (others.length > 0) lines.push(t(l, 'exam.card.others', { others: andList(others, l) }));
  const src = rule.source;
  const catchUp = src?.catchUp;
  if (catchUp) {
    const subjects = andList(
      catchUp.subjects.map((s) => EXAM_SUBJECT_NAMES[s][l]),
      l,
    );
    for (const pr of catchUp.profiles) lines.push(t(l, 'route.card.catchUp', { profile: profileShort(pr, l), subjects }));
  }
  if (src?.verified) {
    const key = src.cells === null ? 'route.card.admissionNoRow' : 'route.card.admissionChecked';
    lines.push(t(l, key, { programme: src.programme }));
  } else {
    lines.push(t(l, 'route.card.admissionUnchecked'));
  }
  if (p.level === 3 && isVmbo(lv)) lines.push(t(l, 'route.card.viaMbo'));
  return lines;
}

/** When to apply: national dates only (docs/sources.md); nothing per programme. */
function applyLines(p: Profession): readonly MessageKey[] {
  if (p.level === 0) return [];
  if (p.level === 1 || p.level === 2) return ['exam.apply.mbo', 'exam.apply.mboCheck', 'exam.apply.source'];
  return ['exam.apply.bachelor', 'exam.apply.fixus', 'exam.apply.check', 'exam.apply.source'];
}

function ApplySection({ p }: { p: Profession }) {
  const l = lang.value;
  const keys = applyLines(p);
  if (keys.length === 0) return null;
  return (
    <section class="card-section card-apply">
      <h3>{t(l, 'exam.card.apply')}</h3>
      <ul class="focus-list apply-lines">
        {keys.map((key) => (
          <li key={key}>{t(l, key)}</li>
        ))}
      </ul>
    </section>
  );
}

const ABOUT_TOP: readonly MessageKey[] = [
  'exam.about.intro',
  'route.about.doors',
  'exam.about.states',
  'exam.about.rules',
  'exam.about.others',
  'route.about.vmbo',
  'route.about.bbkb',
];
const ABOUT_BOTTOM: readonly MessageKey[] = ['exam.about.apply', 'exam.about.demo', 'exam.about.privacy'];

/** The bovenbouw view (bovenbouw.html). */
export function ExamApp() {
  const l = lang.value;
  const lv = level.value;
  const fragment = linkFragment.value;
  const chosen = new Set(extras.value);
  return (
    <div class="app doors-app route-app exam-app">
      <Header subtitle="exam.subtitle" goal={false} />
      <main class="layout">
        <aside class="col-route">
          <ChoicePanel counts={examCounts.value} hint={t(l, isVmbo(lv) ? 'route.hint.vmbo' : 'exam.hint')}>
            {!isVmbo(lv) && <ExtrasRow />}
          </ChoicePanel>
        </aside>
        <div class="col-building">
          <RouteSummary totals={examTotals.value} />
          <RouteStreet views={examViews.value} />
          <footer class="footer">
            <p class="legend">
              <span>{t(l, 'exam.legend.open')}</span>
              <span>{t(l, 'route.legend.detour')}</span>
              <span>{t(l, 'route.legend.closed')}</span>
            </p>
            <p>
              {t(l, 'exam.footer.privacy')}{' '}
              <button
                type="button"
                class="link-btn"
                aria-haspopup="dialog"
                onClick={(ev) => {
                  openedBy(ev);
                  aboutOpen.value = true;
                }}
              >
                {t(l, 'about.title')}
              </button>
              {' · '}
              <PageLink to="index" fragment={fragment} label={t(l, 'view.toPrimaryBuilding')} cls="other-page" />
              {' · '}
              <PageLink to="doors" fragment={fragment} label={t(l, 'view.toPrimaryDoors')} cls="other-page" />
              {' · '}
              <PageLink to="onderbouw" fragment={fragment} label={t(l, 'view.toOnderbouw')} cls="other-page" />
            </p>
          </footer>
        </div>
      </main>
      <RouteCard
        views={examViews.value}
        body={(p, view) => (
          <RouteCardBody
            key="card"
            p={p}
            view={view}
            programme={p.admission ? admissionAt(p, lv).source?.programme : undefined}
            admission={admissionLines(p, lv, profile.value, chosen, l)}
          >
            <ApplySection p={p} />
          </RouteCardBody>
        )}
      />
      <RouteAbout top={ABOUT_TOP} bottom={ABOUT_BOTTOM} />
    </div>
  );
}
