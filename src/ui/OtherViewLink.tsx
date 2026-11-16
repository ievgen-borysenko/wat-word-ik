import { t } from '../i18n';
import { lang, otherViewHash } from './store';

/**
 * A plain link to the other view of the same data (floors <-> doors), named after where
 * it goes. It carries the page's own hash, so grades, goal and a chosen language come
 * along; the only addition is the view-switch marker (`v=1`, no data) while the grades
 * are the user's own (see otherViewHash in the store).
 *
 * Each address is written as a literal page, a literal `#` and the rest of the hash, one
 * template per page: that is the only `href` shape check:dist accepts in the built
 * script (VIEW_LINK_HREF_RE in scripts/check-dist.mjs), because after a literal `#`
 * nothing can reach the host.
 */
export function OtherViewLink({ to }: { to: 'index' | 'doors' }) {
  const fragment = otherViewHash.value.slice(1);
  const label = t(lang.value, to === 'doors' ? 'view.toDoors' : 'view.toBuilding');
  return to === 'doors' ? (
    <a class="other-view" href={`deuren.html#${fragment}`}>
      {label}
    </a>
  ) : (
    <a class="other-view" href={`./#${fragment}`}>
      {label}
    </a>
  );
}
