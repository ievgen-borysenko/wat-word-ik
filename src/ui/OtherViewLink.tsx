import { t } from '../i18n';
import { lang, stateHash } from './store';

/**
 * A plain link to the other view of the same data (floors <-> doors). It carries the
 * page's own hash, so grades, goal and a chosen language come along; nothing else is
 * added to the address.
 */
export function OtherViewLink({ to }: { to: 'index' | 'doors' }) {
  const page = to === 'doors' ? 'deuren.html' : './';
  return (
    <a class="other-view" href={`${page}${stateHash.value}`}>
      {t(lang.value, 'view.other')}
    </a>
  );
}
