import type { ObserverError, Unsubscribe } from '../data/DataStore';
import type { AppContext, Dispose } from './context';
import { h } from './dom';

/**
 * Subscribes, and when the observer fails shows a message with a retry button
 * in `problem`, instead of leaving the screen or failing silently. A failed
 * observer has already stopped, so retrying subscribes again.
 */
export function observeWithRetry(
  ctx: AppContext,
  problem: HTMLElement,
  subscribe: (onError: ObserverError) => Unsubscribe,
): Dispose {
  let stop: Unsubscribe = () => {};
  const start = () => {
    problem.replaceChildren();
    stop = subscribe((error) => {
      console.error('Could not load data', error);
      stop();
      problem.replaceChildren(
        h('p', { class: 'message', role: 'alert' }, ctx.text('error.load')),
        h('button', { onClick: start }, ctx.text('app.retry')),
      );
    });
  };
  start();
  return () => stop();
}
