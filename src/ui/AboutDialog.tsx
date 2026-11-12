import { LEVELS } from '../engine/types';
import { t } from '../i18n';
import { floorLabel } from './format';
import { useModalDialog } from './modal';
import { aboutOpen, lang } from './store';

const FLOORS_TOP_DOWN = [...LEVELS].reverse();

/** "How it works" for children and parents: a short explanation, no links to raw files. */
export function AboutDialog() {
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
        <p>{t(l, 'about.sliders')}</p>
        <p>{t(l, 'about.floors')}</p>
        <ul class="about-floors">
          {FLOORS_TOP_DOWN.map((level) => (
            <li key={level}>
              <strong>{floorLabel(level, l)}</strong> - {t(l, `about.floor.${level}`)}
            </li>
          ))}
        </ul>
        <p>{t(l, 'about.states')}</p>
        <p>{t(l, 'about.goal')}</p>
        <p>{t(l, 'about.demo')}</p>
        <p>{t(l, 'about.privacy')}</p>
      </div>
    </dialog>
  );
}
