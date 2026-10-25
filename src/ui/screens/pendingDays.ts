import { isPendingDays, LIMITS, type WorldId } from '../../core/model';
import type { AppContext, Dispose } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';

export interface PendingDaysSection {
  element: HTMLElement;
  dispose: Dispose;
}

/** How many days a new collectible waits, pending, before it goes to the reserve (SPEC.md §4): `ruleset.pendingDays`. */
export function createPendingDaysSection(ctx: AppContext, worldId: WorldId): PendingDaysSection {
  const problem = h('div');
  const days = h('input', { type: 'number', inputMode: 'numeric', min: 1, max: LIMITS.pendingDaysMax, step: 1, required: true });
  const message = h('p', { class: 'message', role: 'alert', hidden: true }, ctx.text('rules.pendingDaysInvalid', { max: LIMITS.pendingDaysMax }));
  const form = h('form', { class: 'stack' },
    h('label', {}, ctx.text('rules.pendingDays'), days),
    h('small', {}, ctx.text('rules.pendingDaysHelp')),
    message,
    h('button', { class: 'primary', type: 'submit' }, ctx.text('rules.pendingDaysSave')),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = Number(days.value);
    message.hidden = isPendingDays(value);
    if (!message.hidden) return;
    ctx.settle(ctx.store.worlds.setPendingDays(worldId, value).settled);
  });
  const stop = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (world) => {
      if (document.activeElement !== days) days.value = String(world.ruleset.pendingDays);
    }, onError),
  );
  return { element: h('section', { class: 'stack' }, h('h3', {}, ctx.text('rules.pendingDays')), problem, form), dispose: stop };
}
