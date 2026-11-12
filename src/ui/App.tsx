import { t } from '../i18n';
import { AboutDialog } from './AboutDialog';
import { Building, Summary } from './Building';
import { Header } from './Header';
import { openedBy } from './modal';
import { ProfessionCard } from './ProfessionCard';
import { SlidersPanel } from './SlidersPanel';
import { aboutOpen, lang } from './store';

export function App() {
  const l = lang.value;
  return (
    <div class="app">
      <Header />
      <main class="layout">
        <div class="col-building">
          <Summary />
          <Building />
          <footer class="footer">
            <p class="legend">
              <span>{t(l, 'legend.lock')}</span>
              <span>{t(l, 'legend.badge')}</span>
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
            </p>
          </footer>
        </div>
        <aside class="col-sliders">
          <SlidersPanel />
        </aside>
      </main>
      <ProfessionCard />
      <AboutDialog />
    </div>
  );
}
