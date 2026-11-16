import { DIRECTION_NAMES, EXAM_SUBJECT_NAMES, PROFILE_NAMES, SCHOOL_LEVEL_NAMES } from '../data/secondary';
import type { ClosedNeed, Fit, RouteStep, RouteView } from '../engine/route';
import type { HavoVwoProfile, Lang } from '../engine/types';
import { HTML_LANG, t } from '../i18n';

/** "a, b or c" in the page language. */
export function orList(items: readonly string[], l: Lang): string {
  return new Intl.ListFormat(HTML_LANG[l], { type: 'disjunction' }).format(items);
}

export function profileShort(p: HavoVwoProfile, l: Lang): string {
  return PROFILE_NAMES[p].short[l];
}

export function profileList(profiles: readonly HavoVwoProfile[], l: Lang): string {
  return orList(
    profiles.map((p) => profileShort(p, l)),
    l,
  );
}

export function stepText(step: RouteStep, l: Lang): string {
  return step.kind === 'subject'
    ? t(l, 'route.step.subject', { subject: EXAM_SUBJECT_NAMES[step.subject][l] })
    : t(l, `route.step.${step.kind}`);
}

export function stepsText(steps: readonly RouteStep[], l: Lang): string {
  return orList(
    steps.map((s) => stepText(s, l)),
    l,
  );
}

export function needText(need: ClosedNeed, l: Lang): string {
  return need.kind === 'level'
    ? t(l, 'route.need.level', { level: SCHOOL_LEVEL_NAMES[need.from][l] })
    : t(l, 'route.need.profile', { list: profileList(need.profiles, l) });
}

export function fitText(fit: Fit, l: Lang): string {
  return fit.yours === true ? t(l, 'route.fit.yours') : t(l, 'route.fit.other', { direction: DIRECTION_NAMES[fit.direction][l] });
}

/**
 * The short line a door shows under its state: the step of a detour, what a closed
 * door needs, and for an open mbo door at a vmbo level the direction that fits it.
 */
export function doorLine(view: RouteView, fit: Fit | null, l: Lang): string {
  if (view.state === 'open') return fit ? fitText(fit, l) : '';
  if (view.state === 'closed') return needText(view.need, l);
  const parts: string[] = [];
  if (view.steps.length > 0) parts.push(stepsText(view.steps, l));
  if (view.profiles) parts.push(t(l, 'route.with', { list: profileList(view.profiles, l) }));
  return parts.join(' · ');
}

/** The state in words, with the door's line: "one step more: extra subject: physics". */
export function stateText(view: RouteView, fit: Fit | null, l: Lang): string {
  const word = t(l, `route.state.${view.state}`);
  const line = doorLine(view, fit, l);
  return line ? `${word}: ${line}` : word;
}

/** The class a door or pill gets: the doors view's own words for open, ajar and closed. */
export function stateClass(view: RouteView): string {
  return view.state === 'open' ? 'is-open' : view.state === 'detour' ? 'is-ajar is-detour' : 'is-closed';
}
