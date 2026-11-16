import { langFragment } from '../engine/hash';
import { t } from '../i18n';
import { lang, langChosen, otherViewHash } from './store';

/** The four pages: the floors view (index), the doors view (deuren.html), the onderbouw view and the bovenbouw view. */
export type PageId = 'index' | 'doors' | 'onderbouw' | 'bovenbouw';

/**
 * A plain link to another page of the site, named after where it goes. `fragment` is
 * what goes after the `#` (without it).
 *
 * Each address is written as a literal page, a literal `#` and the fragment, one
 * template per page: that is the only `href` shape check:dist accepts in the built
 * script (VIEW_LINK_HREF_RE in scripts/check-dist.mjs), once per page, because after
 * a literal `#` nothing can reach the host. Every link on every page renders through
 * this one component, so the build holds exactly four such templates.
 */
export function PageLink({ to, fragment, label, cls }: { to: PageId; fragment: string; label: string; cls: string }) {
  return to === 'doors' ? (
    <a class={cls} href={`deuren.html#${fragment}`}>
      {label}
    </a>
  ) : to === 'onderbouw' ? (
    <a class={cls} href={`onderbouw.html#${fragment}`}>
      {label}
    </a>
  ) : to === 'bovenbouw' ? (
    <a class={cls} href={`bovenbouw.html#${fragment}`}>
      {label}
    </a>
  ) : (
    <a class={cls} href={`./#${fragment}`}>
      {label}
    </a>
  );
}

/**
 * The link to the other view of the same grades (floors <-> doors). It carries the
 * page's own hash, so grades, goal and a chosen language come along; the only addition
 * is the view-switch marker (`v=1`, no data) while the grades are the user's own (see
 * otherViewHash in the store).
 */
export function OtherViewLink({ to }: { to: 'index' | 'doors' }) {
  const label = t(lang.value, to === 'doors' ? 'view.toDoors' : 'view.toBuilding');
  return <PageLink to={to} fragment={otherViewHash.value.slice(1)} label={label} cls="other-view" />;
}

/**
 * From a grade view to a school view (onderbouw or bovenbouw). It carries the language
 * when it was chosen (`l=` alone) and nothing else: grades and goal mean nothing there.
 */
export function SchoolLink({ to }: { to: 'onderbouw' | 'bovenbouw' }) {
  const fragment = langFragment(langChosen.value ? lang.value : null);
  const label = t(lang.value, to === 'onderbouw' ? 'view.toOnderbouw' : 'view.toBovenbouw');
  return <PageLink to={to} fragment={fragment} label={label} cls="other-page" />;
}
