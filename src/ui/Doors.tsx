import { computed } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { PROFESSIONS, PROFESSION_BY_ID } from '../data/professions';
import { doorCounts, doorOf, groupByField, nextStep, type DoorView } from '../engine/doors';
import type { Evaluation } from '../engine/scoring';
import type { Lang, Profession } from '../engine/types';
import { HTML_LANG, t, tp } from '../i18n';
import { goalText, shortName, subjectEmoji, subjectName } from './format';
import { openedBy } from './modal';
import type { CardWords } from './ProfessionCard';
import { FromLinkNotice } from './SlidersPanel';
import { evaluations, fromLink, goal, lang, selected, sliders } from './store';

/** Screen readers hear the counts once the sliders rest, not on every step of a drag. */
const ANNOUNCE_DELAY_MS = 800;

const doorViews = computed<ReadonlyMap<string, DoorView>>(
  () => new Map([...evaluations.value].map(([id, e]) => [id, doorOf(e)])),
);
const counts = computed(() => doorCounts(doorViews.value.values()));
const step = computed(() => nextStep(PROFESSIONS, sliders.value));

/** "+1 Maths" or "+1 in any subject": the step an ajar door shows. */
function keyText(view: DoorView, l: Lang): string {
  if (!view.key) return '';
  return view.key.kind === 'subject'
    ? t(l, 'doors.key.subject', { subject: subjectName(view.key.subject, l) })
    : t(l, 'doors.key.any');
}

/** The door's state in words: "open", "almost open: +1 Maths", "not open yet". */
export function doorStateText(view: DoorView, l: Lang): string {
  const word = t(l, `doors.state.${view.state}`);
  return view.state === 'ajar' ? `${word}: ${keyText(view, l)}` : word;
}

/** The card in the doors view speaks of doors too; level and pay stay on it as facts. */
export const DOOR_WORDS: CardWords = {
  pill: (e, l) => {
    const view = doorOf(e);
    return { cls: `is-${view.state}`, mark: view.state === 'open' ? '✓ ' : '', text: doorStateText(view, l) };
  },
  rung: (e, l) => {
    const view: DoorView = e ? doorOf(e) : { state: 'closed', key: null };
    return { cls: `is-${view.state}`, mark: '', text: doorStateText(view, l) };
  },
};

function Door({ p, e }: { p: Profession; e: Evaluation }) {
  const l = lang.value;
  const view = doorOf(e);
  const isGoal = goal.value === p.id;
  const visible = shortName(p, l);
  const full = p.name[l];
  const state = doorStateText(view, l);
  // The accessible name starts with the visible words in their order (WCAG 2.5.3): the
  // name and the state. Then the full name, when the door shows a shorter one.
  let aria = t(l, 'doors.aria', { name: visible, state });
  if (full !== visible) aria += `. ${full}`;
  if (isGoal) aria += `, ${t(l, 'tile.goal')}`;
  const badge = view.key?.kind === 'subject' ? `+1${subjectEmoji(view.key.subject)}` : '+1';

  return (
    <button
      type="button"
      class={`door is-${view.state} ${isGoal ? 'is-goal' : ''}`}
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
        {view.state === 'ajar' && <span class="door-badge">{badge}</span>}
        {isGoal && <span class="door-goal">⚑</span>}
      </span>
      <span class="door-name">{visible}</span>{' '}
      <span class="door-state">
        {t(l, `doors.state.${view.state}`)}
        {view.state === 'ajar' && (
          <>
            {' '}
            <span class="door-key">{keyText(view, l)}</span>
          </>
        )}
      </span>
    </button>
  );
}

export function Street() {
  const l = lang.value;
  const evals = evaluations.value;
  const views = doorViews.value;
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
                const e = evals.get(p.id);
                return e ? <Door key={p.id} p={p} e={e} /> : null;
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}

/** The step line: the one +1 that opens the most doors, else the next door, else a plain fact. */
function stepText(l: Lang): string {
  const s = step.value;
  if (s.kind === 'plusOne') return tp(l, 'doors.stepOpens', s.opens, { subject: subjectName(s.subject, l) });
  if (s.kind === 'next') return tp(l, 'doors.next', s.points, { name: shortName(s.profession, l) });
  return t(l, 'doors.allOpenStep');
}

export function DoorsSummary() {
  const l = lang.value;
  const c = counts.value;
  const g = goal.value ? PROFESSION_BY_ID.get(goal.value) : undefined;
  const ge = g ? evaluations.value.get(g.id) : undefined;
  const text =
    c.open === c.total
      ? t(l, 'doors.allOpen', { total: c.total })
      : `${tp(l, 'doors.open', c.open)}, ${t(l, 'doors.ajar', { n: c.ajar })}`;
  const next = stepText(l);

  // aria-live is debounced: a live region on the visible line would speak on every slider step.
  const spoken = `${text}. ${next}`;
  const [settled, setSettled] = useState(spoken);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(spoken), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [spoken]);

  return (
    <div class={`summary doors-summary ${g ? 'has-goal' : ''} ${fromLink.value ? 'has-link' : ''}`}>
      <p class="summary-counts" aria-hidden="true">
        {text}
      </p>
      <p class="visually-hidden" aria-live="polite">
        {settled}
      </p>
      <p class="headline door-step" aria-hidden="true">
        {next}
      </p>
      <FromLinkNotice place="summary" />
      {g && ge && (
        <button
          type="button"
          class={`summary-goal ${ge.state === 'open' ? 'is-open' : ''}`}
          onClick={(ev) => {
            openedBy(ev);
            selected.value = g.id;
          }}
        >
          {goalText(g, ge, l)}
        </button>
      )}
    </div>
  );
}
