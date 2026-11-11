import { PROFESSION_BY_ID } from '../data/professions';
import { LANGS } from '../engine/types';
import { t } from '../i18n';
import { goalText } from './format';
import { evaluations, goal, lang, selected, setLang, toggleGoal } from './store';

const LANG_ORDER = ['nl', 'en', 'ua'] as const satisfies readonly (typeof LANGS)[number][];

export function Header() {
  const l = lang.value;
  return (
    <header class="header">
      <div class="header-title">
        <h1>{t(l, 'app.title')}</h1>
        <p class="subtitle">{t(l, 'app.subtitle')}</p>
      </div>
      <GoalBanner />
      <div class="header-side">
        <div class="lang-switch" role="group" aria-label={t(l, 'lang.label')}>
          {LANG_ORDER.map((code) => (
            <button
              key={code}
              type="button"
              class="lang-btn"
              aria-pressed={code === l}
              onClick={() => setLang(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
        <span class="demo-badge">{t(l, 'app.demoBadge')}</span>
      </div>
    </header>
  );
}

export function GoalBanner() {
  const id = goal.value;
  const p = id ? PROFESSION_BY_ID.get(id) : undefined;
  if (!p) return null;
  const l = lang.value;
  const e = evaluations.value.get(p.id);
  if (!e) return null;
  const open = e.state === 'open';
  return (
    <div class={`goal-banner ${open ? 'is-open' : ''}`}>
      <button type="button" class="goal-banner-text" onClick={() => (selected.value = p.id)}>
        <span aria-hidden="true">{p.emoji}</span>{' '}
        {goalText(p, e, l)}
      </button>
      <button
        type="button"
        class="goal-banner-clear"
        aria-label={t(l, 'goal.clear')}
        title={t(l, 'goal.clear')}
        onClick={() => toggleGoal(p.id)}
      >
        ×
      </button>
    </div>
  );
}
