import { useEffect, useRef, useState } from 'preact/hooks';
import { PROFESSIONS, PROFESSION_BY_ID } from '../data/professions';
import type { Evaluation } from '../engine/scoring';
import type { Lang, Level, Profession, State } from '../engine/types';
import { t, tp } from '../i18n';
import { euros, floorAbout, floorLabel, goalText, shortName } from './format';
import { FromLinkNotice } from './SlidersPanel';
import { band, counts, evaluations, fromLink, goal, lang, reducedMotion, selected } from './store';

const FLOORS_TOP_DOWN: readonly Level[] = [4, 3, 2, 1, 0];

/** Screen readers hear the counts once the sliders rest, not on every step of a drag. */
const ANNOUNCE_DELAY_MS = 800;

function Tile({ p, e }: { p: Profession; e: Evaluation }) {
  const l = lang.value;
  const ref = useRef<HTMLButtonElement>(null);
  const prev = useRef<State>(e.state);
  const isGoal = goal.value === p.id;

  // A short "pop" when a tile becomes open: the building feels alive while dragging.
  useEffect(() => {
    const el = ref.current;
    if (el && prev.current !== 'open' && e.state === 'open' && !reducedMotion() && el.animate) {
      el.animate(
        [
          { transform: 'scale(1)', offset: 0 },
          { transform: 'scale(1.12)', offset: 0.35 },
          { transform: 'scale(1)', offset: 1 },
        ],
        { duration: 380, easing: 'ease-out' },
      );
    }
    prev.current = e.state;
  }, [e.state]);

  let stateText = t(l, `state.${e.state}`);
  if (e.state === 'near') stateText += `, ${tp(l, 'tile.ariaSteps', e.stepsToOpen)}`;
  // The accessible name starts with the visible text (WCAG 2.5.3), then the full name.
  const visible = shortName(p, l);
  const full = p.name[l];
  const name = full.startsWith(visible) ? full : `${visible} (${full})`;
  let aria = t(l, 'tile.aria', { name, floor: floorLabel(p.level, l), state: stateText });
  if (isGoal) aria += `, ${t(l, 'tile.goal')}`;

  return (
    <button
      ref={ref}
      type="button"
      class={`tile is-${e.state} ${isGoal ? 'is-goal' : ''}`}
      data-id={p.id}
      aria-label={aria}
      title={p.name[l]}
      aria-haspopup="dialog"
      onClick={() => (selected.value = p.id)}
    >
      <span class="tile-emoji" aria-hidden="true">
        {p.emoji}
      </span>
      <span class="tile-name">{shortName(p, l)}</span>
      <span class="tile-pay" aria-hidden="true">
        {euros(p.pay)}
      </span>
      {e.state === 'near' && (
        <span class="tile-badge" aria-hidden="true">
          +{e.stepsToOpen}
        </span>
      )}
      {e.state === 'far' && (
        <span class="tile-lock" aria-hidden="true">
          🔒
        </span>
      )}
      {isGoal && (
        <span class="tile-goal" aria-hidden="true">
          ⚑
        </span>
      )}
    </button>
  );
}

function FloorInfo({ level, l }: { level: Level; l: Lang }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = `floor-about-${level}`;

  // Safari does not focus a button on click, so blur alone never closes the note there:
  // close on any pointerdown outside it and on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (!(ev.target instanceof Node) || !wrap.current?.contains(ev.target)) setOpen(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      setOpen(false);
      if (wrap.current?.contains(document.activeElement)) button.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span class="floor-info" ref={wrap}>
      <button
        ref={button}
        type="button"
        class="floor-info-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t(l, 'floor.info', { floor: floorLabel(level, l) })}
        onClick={() => setOpen(!open)}
        onBlur={(ev) => {
          if (!(ev.relatedTarget instanceof Node) || !wrap.current?.contains(ev.relatedTarget)) setOpen(false);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') setOpen(false);
        }}
      >
        <span class="floor-info-dot" aria-hidden="true">
          ?
        </span>
      </button>
      <span id={id} class="floor-about" role="note" hidden={!open}>
        {floorAbout(level, l)}
      </span>
    </span>
  );
}

function Floor({ level }: { level: Level }) {
  const l = lang.value;
  const evals = evaluations.value;
  const tiles = PROFESSIONS.filter((p) => p.level === level);
  const open = tiles.filter((p) => evals.get(p.id)?.state === 'open').length;
  const headingId = `floor-${level}`;
  return (
    <section
      class={`floor floor-${level}`}
      aria-labelledby={headingId}
      style={{ '--lit': String(open / tiles.length) }}
    >
      <header class="floor-head" title={floorAbout(level, l)}>
        <h3 id={headingId} class="floor-label">
          {floorLabel(level, l)}
        </h3>
        <FloorInfo level={level} l={l} />
        <p class="floor-count">{t(l, 'floor.count', { open, total: tiles.length })}</p>
      </header>
      <div class="tiles">
        {tiles.map((p) => {
          const e = evals.get(p.id);
          return e ? <Tile key={p.id} p={p} e={e} /> : null;
        })}
      </div>
    </section>
  );
}

export function Summary() {
  const l = lang.value;
  const c = counts.value;
  const g = goal.value ? PROFESSION_BY_ID.get(goal.value) : undefined;
  const ge = g ? evaluations.value.get(g.id) : undefined;
  const text = t(l, 'summary.counts', { open: c.open, total: c.total, near: c.near });

  // aria-live is debounced: a live region on the visible line would speak on every slider step.
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <div class={`summary ${g ? 'has-goal' : ''} ${fromLink.value ? 'has-link' : ''}`}>
      <p class="summary-counts" aria-hidden="true">
        {text}
      </p>
      <p class="visually-hidden" aria-live="polite">
        {settled}
      </p>
      <p class={`headline band-${band.value}`}>{t(l, `headline.${band.value}`)}</p>
      <FromLinkNotice place="summary" />
      {g && ge && (
        <button type="button" class={`summary-goal ${ge.state === 'open' ? 'is-open' : ''}`} onClick={() => (selected.value = g.id)}>
          {goalText(g, ge, l)}
        </button>
      )}
    </div>
  );
}

export function Building() {
  return (
    <div class="building">
      <div class="roof" aria-hidden="true" />
      {FLOORS_TOP_DOWN.map((level) => (
        <Floor key={level} level={level} />
      ))}
      <div class="ground" aria-hidden="true" />
    </div>
  );
}
