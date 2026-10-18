import type { Place } from '../theme/types';

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The short animation played when a place is tapped (SPEC.md §7). The theme
 * chooses the kind and the duration; `done` runs when it ends. Returns a
 * function that cancels it, for when the screen is left meanwhile.
 */
export function playTransition(
  map: HTMLElement,
  place: HTMLElement,
  transition: Place['transition'],
  done: () => void,
): () => void {
  if (transition.kind === 'none' || transition.durationMs === 0 || prefersReducedMotion()) {
    done();
    return () => {};
  }
  map.style.transition = `transform ${transition.durationMs}ms ease-in, opacity ${transition.durationMs}ms ease-in`;
  if (transition.kind === 'move') {
    // Zoom into the tapped place.
    map.style.transformOrigin = `${place.offsetLeft + place.offsetWidth / 2}px ${place.offsetTop + place.offsetHeight / 2}px`;
    map.style.transform = 'scale(2.4)';
  }
  map.style.opacity = '0';
  const timer = setTimeout(done, transition.durationMs);
  return () => clearTimeout(timer);
}
