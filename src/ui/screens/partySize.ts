import { LIMITS, type WorldId } from '../../core/model';
import { isPartySize } from '../../core/tokens';
import type { AppContext, Dispose } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';

export interface PartySizeSection {
  element: HTMLElement;
  dispose: Dispose;
}

/**
 * How many collectibles a party holds, in management (SPEC.md §4). It is the world's `ruleset.partySize`,
 * shared by every device. Lowering it takes nobody out of a party: a party above the size may only lose members.
 */
export function createPartySizeSection(ctx: AppContext, worldId: WorldId): PartySizeSection {
  const problem = h('div');
  const size = h('input', { type: 'number', inputMode: 'numeric', min: 1, max: LIMITS.partySizeMax, step: 1, required: true });
  const message = h('p', { class: 'message', role: 'alert', hidden: true }, ctx.text('manage.partySizeInvalid', { max: LIMITS.partySizeMax }));
  const form = h('form', { class: 'stack' },
    h('label', {}, ctx.text('manage.partySize'), size),
    h('small', {}, ctx.text('manage.partySizeHint')),
    message,
    h('button', { class: 'primary', type: 'submit' }, ctx.text('manage.partySizeSave')),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = Number(size.value);
    message.hidden = isPartySize(value);
    if (!message.hidden) return;
    ctx.settle(ctx.store.worlds.setPartySize(worldId, value).settled);
  });

  // Follow the world while nobody is typing in the field.
  const stop = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (world) => {
      if (document.activeElement !== size) size.value = String(world.ruleset.partySize);
    }, onError),
  );
  return { element: h('section', { class: 'stack' }, h('h2', {}, ctx.text('manage.partySize')), problem, form), dispose: stop };
}
