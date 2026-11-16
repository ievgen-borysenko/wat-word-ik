import { t } from '../i18n';
import { lang, otherViewHash } from './store';

/**
 * A plain link to the other view of the same data (floors <-> doors), named after where
 * it goes. It carries the page's own hash, so grades, goal and a chosen language come
 * along; the only addition is the view-switch marker (`v=1`, no data) while the grades
 * are the user's own (see otherViewHash in the store).
 */
export function OtherViewLink({ to }: { to: 'index' | 'doors' }) {
  const page = to === 'doors' ? 'deuren.html' : './';
  return (
    <a class="other-view" href={`${page}${otherViewHash.value}`}>
      {t(lang.value, to === 'doors' ? 'view.toDoors' : 'view.toBuilding')}
    </a>
  );
}
