import { t } from '../i18n';
import { Building, Summary } from './Building';
import { Header } from './Header';
import { ProfessionCard } from './ProfessionCard';
import { SlidersPanel } from './SlidersPanel';
import { lang } from './store';

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
              {t(l, 'footer.privacy')} <a href="docs/methodology.md">{t(l, 'footer.methodology')}</a>
              {' · '}
              <a href="docs/sources.md">{t(l, 'footer.sources')}</a>
            </p>
          </footer>
        </div>
        <aside class="col-sliders">
          <SlidersPanel />
        </aside>
      </main>
      <ProfessionCard />
    </div>
  );
}
