import { useEffect, useRef } from 'preact/hooks';
import { PROFESSIONS, PROFESSION_BY_ID } from '../data/professions';
import { focus, ladder, nextRung } from '../engine/hints';
import type { Evaluation } from '../engine/scoring';
import { GRADE_MAX, type Lang, type Profession } from '../engine/types';
import { t, type MessageKey } from '../i18n';
import { decimal, euros, floorAbout, floorLabel, shortName, subjectEmoji, subjectName } from './format';
import { evaluations, goal, lang, selected, sliders, toggleGoal } from './store';

const pct = (v: number) => `${(Math.max(0, Math.min(GRADE_MAX, v)) / GRADE_MAX) * 100}%`;

/** A 0..10 bar: your level filled, a marker at the requirement, a red gap when short. */
function NeedBar({ have, need, label }: { have: number; need: number; label: string }) {
  const ok = have >= need;
  return (
    <div class={`need-bar ${ok ? 'is-ok' : 'is-short'}`} role="img" aria-label={label}>
      <span class="need-fill" style={{ width: pct(have) }} />
      {!ok && <span class="need-gap" style={{ left: pct(have), width: pct(need - have) }} />}
      <span class="need-marker" style={{ left: pct(need) }} />
    </div>
  );
}

function FocusLines({ p, e, l }: { p: Profession; e: Evaluation; l: Lang }) {
  const items: string[] = [];
  if (e.state === 'open') {
    items.push(t(l, 'card.focusOpen'));
    const next = nextRung(PROFESSIONS, p);
    if (next) {
      const ne = evaluations.value.get(next.id);
      const name = shortName(next, l);
      if (ne?.state === 'open') items.push(t(l, 'card.focusNextOpen', { name }));
      else {
        const list = next.needs.map((n) => `${subjectName(n.subject, l)} ${n.min}`).join(', ');
        items.push(t(l, 'card.focusNext', { name, list: `${list} · ${floorLabel(next.level, l)}` }));
      }
    } else if (ladder(PROFESSIONS, p).length > 1) {
      items.push(t(l, 'card.focusTop'));
    }
  } else {
    for (const g of focus(p, sliders.value)) {
      items.push(
        g.kind === 'subject'
          ? t(l, 'card.focusSubject', { subject: subjectName(g.subject, l), n: g.points })
          : t(l, 'card.focusAverage', { n: g.points }),
      );
    }
  }
  return (
    <ul class="focus-list">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

function CardBody({ p, e }: { p: Profession; e: Evaluation }) {
  const l = lang.value;
  const s = sliders.value;
  const rungs = ladder(PROFESSIONS, p);
  const isGoal = goal.value === p.id;
  const titleRef = useRef<HTMLHeadingElement>(null);

  // When the ladder switches to another profession, move focus to its title.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    titleRef.current?.focus();
  }, [p.id]);

  return (
    <div class={`card is-${e.state}`}>
      <header class="card-head">
        <span class="card-emoji" aria-hidden="true">
          {p.emoji}
        </span>
        <div>
          <h2 id="card-title" ref={titleRef} tabIndex={-1}>
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
        <span class={`state-pill is-${e.state}`}>
          {e.state === 'far' ? '🔒 ' : e.state === 'near' ? `+${e.stepsToOpen} ` : '✓ '}
          {t(l, `state.${e.state}` as MessageKey)}
        </span>
      </p>
      <p class="card-about">{p.about[l]}</p>

      <section class="card-section">
        <h3>{t(l, 'card.needs')}</h3>
        {p.needs.length === 0 && <p class="muted">{t(l, 'card.noNeeds')}</p>}
        <ul class="need-list">
          {p.needs.map((n) => {
            const have = s[n.subject];
            const text = t(l, 'card.nowNeed', { have, need: n.min });
            const name = subjectName(n.subject, l, false);
            return (
              <li key={n.subject} class="need-row">
                <div class="need-text">
                  <span aria-hidden="true">{subjectEmoji(n.subject)}</span> <span>{name}</span>
                  <span class={`need-val ${have >= n.min ? 'is-ok' : 'is-short'}`}>
                    {have >= n.min ? '✓ ' : ''}
                    {text}
                  </span>
                </div>
                <NeedBar have={have} need={n.min} label={`${name}: ${text}`} />
              </li>
            );
          })}
          {p.level > 0 && (
            <li class="need-row is-general">
              <div class="need-text">
                <span>{t(l, 'card.general')}</span>
                <span class={`need-val ${e.avgDeficit === 0 ? 'is-ok' : 'is-short'}`}>
                  {e.avgDeficit === 0 ? '✓ ' : ''}
                  {t(l, 'card.nowNeed', { have: decimal(e.average, l), need: decimal(e.minAvg, l) })}
                </span>
              </div>
              <NeedBar
                have={e.average}
                need={e.minAvg}
                label={`${t(l, 'card.general')}: ${t(l, 'card.nowNeed', {
                  have: decimal(e.average, l),
                  need: decimal(e.minAvg, l),
                })}`}
              />
            </li>
          )}
        </ul>
      </section>

      {rungs.length > 1 && (
        <section class="card-section">
          <h3>{t(l, 'card.ladder')}</h3>
          <p class="muted small">{t(l, 'card.ladderHint')}</p>
          <ol class="ladder">
            {rungs.map((r) => {
              const re = evaluations.value.get(r.id);
              const current = r.id === p.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    class={`ladder-chip is-${re?.state ?? 'far'} ${current ? 'is-current' : ''}`}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => (selected.value = r.id)}
                  >
                    <span aria-hidden="true">{r.emoji}</span> {shortName(r, l)}
                    <span class="chip-floor">{floorLabel(r.level, l)}</span>
                    {re?.state === 'far' && <span aria-hidden="true"> 🔒</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section class="card-section">
        <h3>{t(l, 'card.focus')}</h3>
        <FocusLines p={p} e={e} l={l} />
      </section>

      <section class="card-section card-pay">
        <h3>{t(l, 'card.pay')}</h3>
        <p class="pay" aria-label={t(l, 'card.payAria', { n: p.pay })}>
          <span class="pay-on">{euros(p.pay)}</span>
          <span class="pay-off">{euros(5 - p.pay)}</span>
        </p>
      </section>

      <div class="card-actions">
        <button
          type="button"
          class={`goal-btn ${isGoal ? 'is-active' : ''}`}
          aria-pressed={isGoal}
          onClick={() => toggleGoal(p.id)}
        >
          ⚑ {isGoal ? t(l, 'card.goalRemove') : t(l, 'card.goalSet')}
        </button>
      </div>
    </div>
  );
}

export function ProfessionCard() {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const id = selected.value;
  const p = id ? PROFESSION_BY_ID.get(id) : undefined;
  const e = p ? evaluations.value.get(p.id) : undefined;
  const isOpen = Boolean(p && e);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (isOpen && !dlg.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dlg.showModal();
      document.documentElement.classList.add('has-modal');
      dlg.querySelector<HTMLElement>('.card-close')?.focus();
    } else if (!isOpen && dlg.open) {
      dlg.close();
    }
  }, [isOpen]);

  const onClose = () => {
    document.documentElement.classList.remove('has-modal');
    if (selected.value !== null) selected.value = null;
    const back = returnTo.current;
    returnTo.current = null;
    if (back && back.isConnected) back.focus();
  };

  return (
    <dialog
      ref={ref}
      class="card-dialog"
      aria-labelledby="card-title"
      onClose={onClose}
      onClick={(ev) => {
        // A click on the dialog element itself (not its content) is a click on the backdrop.
        if (ev.target === ev.currentTarget) selected.value = null;
      }}
    >
      {p && e && <CardBody key="card" p={p} e={e} />}
    </dialog>
  );
}
