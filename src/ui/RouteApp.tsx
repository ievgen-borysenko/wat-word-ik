import { useRef } from 'preact/hooks';
import { PROFESSIONS, PROFESSION_BY_ID } from '../data/professions';
import { DIRECTION_NAMES, EXAM_SUBJECT_NAMES, PROFILE_NAMES, SCHOOL_LEVEL_NAMES } from '../data/secondary';
import { groupByField } from '../engine/doors';
import { fitOf, isVmbo, type RouteView } from '../engine/route';
import { HAVO_VWO_PROFILES, LEVELS, SCHOOL_LEVELS, type HavoVwoProfile, type Profession, type SchoolProfile } from '../engine/types';
import { HTML_LANG, t } from '../i18n';
import { euros, floorAbout, floorLabel, shortName } from './format';
import { Header } from './Header';
import { openedBy, useModalDialog } from './modal';
import { PageLink } from './OtherViewLink';
import { counts, level, linkFragment, profile, routeViews, selected, setLevel, setProfile, totals } from './routeStore';
import { doorLine, fitText, profileList, profileShort, stateClass, stateText, stepsText } from './routeText';
import { aboutOpen, lang } from './store';

/*
 * The onderbouw view (onderbouw.html): klas 1-3 of secondary school. Two rows of
 * buttons (school level, profile) and the same professions as doors, each open, one
 * step more, or not on this route. The routing is in engine/route.ts.
 */

interface Choice {
  readonly key: string;
  readonly label: string;
  readonly note?: string;
}

/**
 * A row of buttons with radio-group semantics: one tab stop (the checked button), the
 * arrow keys, Home and End move the choice, and the choice follows focus.
 */
function RadioRow({
  id,
  title,
  choices,
  value,
  onChoose,
}: {
  id: string;
  title: string;
  choices: readonly Choice[];
  value: string;
  onChoose: (key: string) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (ev: KeyboardEvent, i: number) => {
    const n = choices.length;
    let next: number;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (i + 1) % n;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (i - 1 + n) % n;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = n - 1;
        break;
      default:
        return;
    }
    ev.preventDefault();
    const choice = choices[next];
    if (!choice) return;
    onChoose(choice.key);
    buttons.current[next]?.focus();
  };
  return (
    <div class={`choice choice-${id}`}>
      <h3 id={`${id}-title`} class="choice-title">
        {title}
      </h3>
      <div class="choice-row" role="radiogroup" aria-labelledby={`${id}-title`}>
        {choices.map((c, i) => {
          const checked = c.key === value;
          return (
            <button
              key={c.key}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              class={`choice-btn ${checked ? 'is-checked' : ''} ${c.key === NONE ? 'is-none' : ''}`}
              data-key={c.key}
              onClick={() => onChoose(c.key)}
              onKeyDown={(ev) => onKeyDown(ev, i)}
            >
              <span class="choice-label">{c.label}</span>
              {c.note && <span class="choice-note">{c.note}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The key of "not chosen yet" in the profile row. */
const NONE = 'none';

function profileLabel(p: SchoolProfile, l: (typeof lang)['value']): string {
  return (HAVO_VWO_PROFILES as readonly string[]).includes(p)
    ? PROFILE_NAMES[p as HavoVwoProfile].name[l]
    : DIRECTION_NAMES[p as keyof typeof DIRECTION_NAMES][l];
}

function ChoicePanel() {
  const l = lang.value;
  const lv = level.value;
  const total = PROFESSIONS.length;
  const mbo = PROFESSIONS.filter((p) => p.level === 1 || p.level === 2).length;
  const profileChoices: Choice[] = [
    { key: NONE, label: t(l, 'route.profile.none') },
    ...counts.value.map((c) => ({
      key: c.profile,
      label: profileLabel(c.profile, l),
      note:
        c.kind === 'opens'
          ? t(l, 'route.profile.opens', { n: c.count, total })
          : t(l, 'route.profile.fits', { n: c.count, total: mbo }),
    })),
  ];
  return (
    <section class="route-panel" aria-labelledby="route-panel-title">
      <h2 id="route-panel-title" class="visually-hidden">
        {t(l, 'route.panel')}
      </h2>
      <RadioRow
        id="level"
        title={t(l, 'route.level.title')}
        choices={SCHOOL_LEVELS.map((s) => ({ key: s, label: SCHOOL_LEVEL_NAMES[s][l] }))}
        value={lv}
        onChoose={(key) => setLevel(SCHOOL_LEVELS.find((s) => s === key) ?? lv)}
      />
      <RadioRow
        id="profile"
        title={t(l, isVmbo(lv) ? 'route.direction.title' : 'route.profile.title')}
        choices={profileChoices}
        value={profile.value ?? NONE}
        onChoose={(key) => setProfile(key === NONE ? null : (key as SchoolProfile))}
      />
      <p class="route-hint">{t(l, isVmbo(lv) ? 'route.hint.vmbo' : 'route.hint.none')}</p>
    </section>
  );
}

function RouteSummary() {
  const l = lang.value;
  const c = totals.value;
  const p = profile.value;
  const text = t(l, 'route.summary', { open: c.open, detour: c.detour, closed: c.closed });
  const chosen =
    p !== null && !isVmbo(level.value)
      ? t(l, 'route.hint.chosen', { profile: profileShort(p as HavoVwoProfile, l), n: c.open, total: c.total })
      : null;
  return (
    <div class="summary route-summary">
      <p class="summary-counts" aria-live="polite">
        {text}
      </p>
      {chosen && <p class="headline route-chosen">{chosen}</p>}
    </div>
  );
}

function RouteDoor({ p, view }: { p: Profession; view: RouteView }) {
  const l = lang.value;
  const fit = fitOf(p, level.value, profile.value);
  const visible = shortName(p, l);
  const full = p.name[l];
  const state = stateText(view, fit, l);
  const line = doorLine(view, fit, l);
  let aria = t(l, 'doors.aria', { name: visible, state });
  if (full !== visible) aria += `. ${full}`;
  return (
    <button
      type="button"
      class={`door ${stateClass(view)} ${fit?.yours ? 'is-fit' : ''}`}
      data-id={p.id}
      aria-label={aria}
      title={full}
      aria-haspopup="dialog"
      onClick={(ev) => {
        openedBy(ev);
        selected.value = p.id;
      }}
    >
      <span class="door-frame" aria-hidden="true">
        <span class="door-leaf" />
        <span class="door-emoji">{p.emoji}</span>
      </span>
      <span class="door-name">{visible}</span>{' '}
      <span class="door-state">
        {t(l, `route.state.${view.state}`)}
        {line && (
          <>
            {' '}
            <span class="door-key">{line}</span>
          </>
        )}
      </span>
    </button>
  );
}

function RouteStreet() {
  const l = lang.value;
  const views = routeViews.value;
  const groups = groupByField(PROFESSIONS, (p) => shortName(p, l), HTML_LANG[l]);
  return (
    <section class="street" aria-labelledby="street-title">
      <h2 id="street-title" class="visually-hidden">
        {t(l, 'doors.title')}
      </h2>
      {groups.map((g) => {
        const open = g.professions.filter((p) => views.get(p.id)?.state === 'open').length;
        const headingId = `field-${g.field}`;
        return (
          <section key={g.field} class={`block field-${g.field}`} aria-labelledby={headingId}>
            <header class="block-head">
              <h3 id={headingId}>{t(l, `field.${g.field}`)}</h3>
              <p class="block-count">{t(l, 'doors.groupCount', { open, total: g.professions.length })}</p>
            </header>
            <div class="doors">
              {g.professions.map((p) => {
                const view = views.get(p.id);
                return view ? <RouteDoor key={p.id} p={p} view={view} /> : null;
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}

/** What the card says about the route: one sentence for the state, and the fit for mbo. */
function routeLines(p: Profession, view: RouteView, l: (typeof lang)['value']): string[] {
  const lines: string[] = [];
  const fit = fitOf(p, level.value, profile.value);
  if (view.state === 'open') {
    lines.push(t(l, p.level >= 3 ? 'route.card.open' : 'route.card.openLevel'));
  } else if (view.state === 'detour') {
    const steps = stepsText(view.steps, l);
    if (view.profiles && view.steps.length === 0) lines.push(t(l, 'route.card.chooseProfile', { list: profileList(view.profiles, l) }));
    else if (view.profiles) lines.push(t(l, 'route.card.detourWith', { list: profileList(view.profiles, l), steps }));
    else lines.push(t(l, 'route.card.detour', { steps }));
  } else {
    lines.push(
      view.need.kind === 'level'
        ? t(l, 'route.card.closedLevel', { level: SCHOOL_LEVEL_NAMES[view.need.from][l] })
        : t(l, 'route.card.closedProfile', { list: profileList(view.need.profiles, l) }),
    );
    lines.push(t(l, 'route.card.never'));
  }
  if (fit) lines.push(t(l, 'route.card.fit', { direction: DIRECTION_NAMES[fit.direction][l] }));
  return lines;
}

/** The admission data of an hbo or wo profession, by profile. */
function admissionLines(p: Profession, l: (typeof lang)['value']): string[] {
  const a = p.admission;
  if (!a) return [];
  const lines: string[] = [];
  if (a.direct.length === HAVO_VWO_PROFILES.length) lines.push(t(l, 'route.card.directAll'));
  else lines.push(t(l, 'route.card.direct', { list: profileList(a.direct, l) }));
  for (const pr of HAVO_VWO_PROFILES) {
    const subject = a.bridge[pr];
    if (subject) lines.push(t(l, 'route.card.bridge', { profile: profileShort(pr, l), subject: EXAM_SUBJECT_NAMES[subject][l] }));
  }
  const other = HAVO_VWO_PROFILES.filter((pr) => !a.direct.includes(pr) && a.bridge[pr] === undefined);
  if (other.length > 0) lines.push(t(l, 'route.card.otherProfile', { list: profileList(other, l) }));
  if (p.level === 3) lines.push(t(l, 'route.card.viaMbo'));
  return lines;
}

function RouteCardBody({ p, view }: { p: Profession; view: RouteView }) {
  const l = lang.value;
  const fit = fitOf(p, level.value, profile.value);
  const admission = admissionLines(p, l);
  return (
    <div class="card route-card">
      <header class="card-head">
        <span class="card-emoji" aria-hidden="true">
          {p.emoji}
        </span>
        <div>
          <h2 id="card-title" tabIndex={-1}>
            {p.name[l]}
          </h2>
          <p class="card-floor">
            <strong>{floorLabel(p.level, l)}</strong> · {floorAbout(p.level, l)}
          </p>
        </div>
        <button type="button" class="card-close" aria-label={t(l, 'card.close')} onClick={() => (selected.value = null)}>
          ×
        </button>
      </header>

      <p class="card-state">
        <span class={`state-pill ${stateClass(view)}`}>
          {view.state === 'open' ? '✓ ' : ''}
          {stateText(view, fit, l)}
        </span>
      </p>
      <p class="card-about">{p.about[l]}</p>

      <section class="card-section">
        <h3>{t(l, 'route.card.route')}</h3>
        <ul class="focus-list route-lines">
          {routeLines(p, view, l).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      {admission.length > 0 && (
        <section class="card-section">
          <h3>{t(l, 'route.card.admission')}</h3>
          <ul class="focus-list admission-lines">
            {admission.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      <section class="card-section card-pay">
        <h3>{t(l, 'card.pay')}</h3>
        <p class="pay">
          <span class="pay-on" aria-hidden="true">
            {euros(p.pay)}
          </span>
          <span class="pay-off" aria-hidden="true">
            {euros(5 - p.pay)}
          </span>
          <span class="visually-hidden">{t(l, 'card.payAria', { n: p.pay })}</span>
        </p>
      </section>
    </div>
  );
}

/** The profession card of this view: the same dialog, focus and closing as the other views. */
function RouteCard() {
  const id = selected.value;
  const p = id ? PROFESSION_BY_ID.get(id) : undefined;
  const view = p ? routeViews.value.get(p.id) : undefined;
  const lastId = useRef<string | null>(null);
  if (p) lastId.current = p.id;
  const modal = useModalDialog(Boolean(p && view), {
    focusSelector: '.card-close',
    onDismiss: () => {
      if (selected.value !== null) selected.value = null;
    },
    fallbackFocus: () =>
      lastId.current ? document.querySelector<HTMLElement>(`.door[data-id="${lastId.current}"]`) : null,
  });
  return (
    <dialog
      ref={modal.ref}
      class="card-dialog"
      aria-labelledby="card-title"
      onClose={modal.onClose}
      onPointerDown={modal.onPointerDown}
      onClick={modal.onClick}
    >
      {p && view && <RouteCardBody key="card" p={p} view={view} />}
    </dialog>
  );
}

/** "How it works" for the onderbouw view. */
function RouteAbout() {
  const l = lang.value;
  const modal = useModalDialog(aboutOpen.value, {
    focusSelector: '.about-close',
    onDismiss: () => {
      if (aboutOpen.value) aboutOpen.value = false;
    },
  });
  return (
    <dialog
      ref={modal.ref}
      class="about-dialog"
      aria-labelledby="about-title"
      onClose={modal.onClose}
      onPointerDown={modal.onPointerDown}
      onClick={modal.onClick}
    >
      <div class="about">
        <header class="about-head">
          <h2 id="about-title">{t(l, 'about.title')}</h2>
          <button
            type="button"
            class="about-close"
            aria-label={t(l, 'card.close')}
            onClick={() => (aboutOpen.value = false)}
          >
            ×
          </button>
        </header>
        <p>{t(l, 'route.about.intro')}</p>
        <p>{t(l, 'route.about.doors')}</p>
        <p>{t(l, 'route.about.states')}</p>
        <p>{t(l, 'route.about.profiles')}</p>
        <p>{t(l, 'route.about.vmbo')}</p>
        <p>{t(l, 'route.about.bbkb')}</p>
        <p>{t(l, 'doors.about.levels')}</p>
        <ul class="about-floors">
          {LEVELS.map((lv) => (
            <li key={lv}>
              <strong>{floorLabel(lv, l)}</strong> - {t(l, `about.floor.${lv}`)}
            </li>
          ))}
        </ul>
        <p>{t(l, 'about.demo')}</p>
        <p>{t(l, 'route.about.privacy')}</p>
      </div>
    </dialog>
  );
}

/** The onderbouw view (onderbouw.html). */
export function RouteApp() {
  const l = lang.value;
  const fragment = linkFragment.value;
  return (
    <div class="app doors-app route-app">
      <Header subtitle="route.subtitle" goal={false} />
      <main class="layout">
        <aside class="col-route">
          <ChoicePanel />
        </aside>
        <div class="col-building">
          <RouteSummary />
          <RouteStreet />
          <footer class="footer">
            <p class="legend">
              <span>{t(l, 'route.legend.open')}</span>
              <span>{t(l, 'route.legend.detour')}</span>
              <span>{t(l, 'route.legend.closed')}</span>
            </p>
            <p>
              {t(l, 'route.footer.privacy')}{' '}
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
            </p>
          </footer>
        </div>
      </main>
      <RouteCard />
      <RouteAbout />
    </div>
  );
}
