import { PROFESSION_BY_ID } from '../data/professions';
import { SUBJECTS } from '../data/subjects';
import { GRADE_MAX, GRADE_MIN, type Subject } from '../engine/types';
import { t } from '../i18n';
import { shortName } from './format';
import { applyPreset, goal, lang, plusOneBySubject, setSlider, sliders } from './store';

const PRESETS = [
  { value: 3, key: 'presets.low' },
  { value: 6, key: 'presets.mid' },
  { value: 9, key: 'presets.high' },
] as const;

/** Position of grade `v` on the range track, as a CSS length (thumb width aware). */
function trackPos(v: number): string {
  const f = (v - GRADE_MIN) / (GRADE_MAX - GRADE_MIN);
  return `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${f})`;
}

function SliderRow({ subject }: { subject: Subject }) {
  const l = lang.value;
  const value = sliders.value[subject.id];
  const opens = plusOneBySubject.value[subject.id];
  const g = goal.value ? PROFESSION_BY_ID.get(goal.value) : undefined;
  const need = g?.needs.find((n) => n.subject === subject.id)?.min;
  const inputId = `slider-${subject.id}`;
  const hintId = `hint-${subject.id}`;

  const shown = opens.slice(0, 2).map((p) => shortName(p, l));
  const more = opens.length - shown.length;
  const hint =
    opens.length > 0
      ? t(l, 'sliders.plusOne', { list: shown.join(', ') }) + (more > 0 ? ` ${t(l, 'sliders.more', { n: more })}` : '')
      : '';

  return (
    <div class="slider-row">
      <label class="slider-label" for={inputId}>
        <span class="slider-emoji" aria-hidden="true">
          {subject.emoji}
        </span>
        <span class="slider-name">{subject.name[l]}</span>
        <output class="slider-value" for={inputId}>
          {value}
        </output>
      </label>
      <div class="range-wrap" style={{ '--pct': trackPos(value) }}>
        <input
          id={inputId}
          type="range"
          min={GRADE_MIN}
          max={GRADE_MAX}
          step={1}
          value={value}
          aria-describedby={hint || need !== undefined ? hintId : undefined}
          onInput={(e) => setSlider(subject.id, Number((e.currentTarget as HTMLInputElement).value))}
        />
        {need !== undefined && (
          <span
            class={`goal-flag ${value >= need ? 'is-met' : ''}`}
            style={{ left: trackPos(need) }}
            title={t(l, 'sliders.goalMarker', { need })}
            aria-hidden="true"
          >
            ⚑
          </span>
        )}
      </div>
      <p class="slider-hint" id={hintId}>
        {hint}
        {need !== undefined && <span class="visually-hidden"> {t(l, 'sliders.goalMarker', { need })}</span>}
      </p>
    </div>
  );
}

export function SlidersPanel() {
  const l = lang.value;
  return (
    <section class={`sliders-panel ${goal.value ? 'has-goal' : ''}`} aria-labelledby="sliders-title">
      <div class="sliders-head">
        <h2 id="sliders-title">{t(l, 'sliders.title')}</h2>
        <p class="sliders-scale">{t(l, 'sliders.scale')}</p>
      </div>
      <div class="presets" role="group" aria-label={t(l, 'presets.label')}>
        {PRESETS.map((p) => (
          <button key={p.value} type="button" class="preset-btn" onClick={() => applyPreset(p.value)}>
            {t(l, p.key)}
          </button>
        ))}
      </div>
      <div class="slider-list">
        {SUBJECTS.map((s) => (
          <SliderRow key={s.id} subject={s} />
        ))}
      </div>
    </section>
  );
}
