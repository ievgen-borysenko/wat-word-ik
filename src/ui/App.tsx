import { t } from '../i18n';
import { Building, Summary } from './Building';
import { GoalBanner, Header } from './Header';
import { ProfessionCard } from './ProfessionCard';
import { SlidersPanel } from './SlidersPanel';
import { lang } from './store';

export function App() {
  const l = lang.value;
  return (
    <div class="app">
      <Header />
      <GoalBanner />
      <main class="layout">
        <div class="col-building">
          <Summary />
          <Building />
          <footer class="footer">
            <p>{t(l, 'footer.privacy')}</p>
            <p>
              <a href="docs/methodology.md">{t(l, 'footer.methodology')}</a>
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
