import { useEffect, useRef } from 'preact/hooks';
import { PROFESSIONS } from '../data/professions';
import type { Evaluation } from '../engine/scoring';
import type { Level, Profession, State } from '../engine/types';
import { t, type MessageKey } from '../i18n';
import { euros, floorAbout, floorLabel, shortName } from './format';
import { band, counts, evaluations, goal, lang, selected } from './store';

const FLOORS_TOP_DOWN: readonly Level[] = [4, 3, 2, 1, 0];

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

  let stateText = t(l, `state.${e.state}` as MessageKey);
  if (e.state === 'near') stateText += `, ${t(l, 'tile.ariaSteps', { n: e.stepsToOpen })}`;
  let aria = t(l, 'tile.aria', { name: p.name[l], floor: floorLabel(p.level, l), state: stateText });
  if (isGoal) aria += `, ${t(l, 'tile.goal')}`;

  return (
    <button
      ref={ref}
      type="button"
      class={`tile is-${e.state} ${isGoal ? 'is-goal' : ''}`}
      aria-label={aria}
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
      <header class="floor-head">
        <h3 id={headingId} class="floor-label">
          {floorLabel(level, l)}
        </h3>
        <p class="floor-about">{floorAbout(level, l)}</p>
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
  return (
    <div class="summary">
      <p class="summary-counts" aria-live="polite">
        {t(l, 'summary.counts', { open: c.open, total: c.total, near: c.near })}
      </p>
      <p class={`headline band-${band.value}`}>{t(l, `headline.${band.value}` as MessageKey)}</p>
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
