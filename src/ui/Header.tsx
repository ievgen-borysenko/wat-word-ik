import { PROFESSION_BY_ID } from '../data/professions';
import { LANGS } from '../engine/types';
import { t, type MessageKey } from '../i18n';
import { goalText } from './format';
import { openedBy } from './modal';
import { aboutOpen, evaluations, goal, lang, selected, setLang, toggleGoal } from './store';

/**
 * The page header: title, subtitle, "How it works", language switch and demo badge.
 * The grade views show the goal banner; the onderbouw view has no goal and its own subtitle.
 */
export function Header({ subtitle = 'app.subtitle', goal = true }: { subtitle?: MessageKey; goal?: boolean }) {
  const l = lang.value;
  return (
    <header class="header">
      <div class="header-title">
        <h1>{t(l, 'app.title')}</h1>
        <p class="subtitle">{t(l, subtitle)}</p>
      </div>
      {goal && <GoalBanner />}
      <div class="header-side">
        <button
          type="button"
          class="help-btn"
          aria-haspopup="dialog"
          onClick={(ev) => {
            openedBy(ev);
            aboutOpen.value = true;
          }}
        >
          <span class="help-icon" aria-hidden="true">
            ?
          </span>
          <span class="help-text">{t(l, 'about.title')}</span>
        </button>
        <div class="lang-switch" role="group" aria-label={t(l, 'lang.label')}>
          {LANGS.map((code) => (
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
        <span class="demo-badge" title={t(l, 'app.demoBadge')}>
          <span class="demo-long">{t(l, 'app.demoBadge')}</span>
          <span class="demo-short" aria-hidden="true">
            {t(l, 'app.demoShort')}
          </span>
        </span>
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
      <button
        type="button"
        class="goal-banner-text"
        onClick={(ev) => {
          openedBy(ev);
          selected.value = p.id;
        }}
      >
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
