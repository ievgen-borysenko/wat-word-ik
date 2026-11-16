import { LEVELS } from '../engine/types';
import { t } from '../i18n';
import { DOOR_WORDS, DoorsSummary, Street } from './Doors';
import { floorLabel } from './format';
import { Header } from './Header';
import { openedBy, useModalDialog } from './modal';
import { OtherViewLink, SchoolLink } from './OtherViewLink';
import { ProfessionCard } from './ProfessionCard';
import { SlidersPanel } from './SlidersPanel';
import { aboutOpen, lang } from './store';

/** "How it works" for the doors view: the same dialog, with doors instead of floors. */
function DoorsAbout() {
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
        <p>{t(l, 'doors.about.doors')}</p>
        <p>{t(l, 'doors.about.states')}</p>
        <p>{t(l, 'doors.about.levels')}</p>
        <ul class="about-floors">
          {LEVELS.map((level) => (
            <li key={level}>
              <strong>{floorLabel(level, l)}</strong> - {t(l, `about.floor.${level}`)}
            </li>
          ))}
        </ul>
        <p>{t(l, 'about.goal')}</p>
        <p>{t(l, 'about.demo')}</p>
        <p>{t(l, 'about.privacy')}</p>
      </div>
    </dialog>
  );
}

/** The doors view (deuren.html): same sliders, data, engine and card as the floors view. */
export function DoorsApp() {
  const l = lang.value;
  return (
    <div class="app doors-app">
      <Header />
      <main class="layout">
        <div class="col-building">
          <DoorsSummary />
          <Street />
          <footer class="footer">
            <p class="legend">
              <span>{t(l, 'doors.legend.open')}</span>
              <span>{t(l, 'doors.legend.ajar')}</span>
              <span>{t(l, 'doors.legend.closed')}</span>
            </p>
            <p>
              {t(l, 'footer.privacy')}{' '}
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
              <OtherViewLink to="index" />
              {' · '}
              <SchoolLink to="onderbouw" />
              {' · '}
              <SchoolLink to="bovenbouw" />
            </p>
          </footer>
        </div>
        <aside class="col-sliders">
          <SlidersPanel />
        </aside>
      </main>
      <ProfessionCard words={DOOR_WORDS} opener=".door" />
      <DoorsAbout />
    </div>
  );
}
