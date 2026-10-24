import { isShowcaseSize, LIMITS, type WorldId } from '../../core/model';
import type { AppContext, Dispose } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';

export interface ShowcaseSizeSection {
  element: HTMLElement;
  dispose: Dispose;
}

/**
 * How many collectibles the showcase shows, in management (SPEC.md §4, §6). It is the world's
 * `ruleset.showcaseSize`, shared by every device. The ones beyond it stay stored, and nothing says so.
 */
export function createShowcaseSizeSection(ctx: AppContext, worldId: WorldId): ShowcaseSizeSection {
  const problem = h('div');
  const size = h('input', { type: 'number', inputMode: 'numeric', min: 1, max: LIMITS.showcaseSizeMax, step: 1, required: true });
  const message = h('p', { class: 'message', role: 'alert', hidden: true }, ctx.text('rules.reserveSizeInvalid'));
  const form = h('form', { class: 'stack' },
    h('label', {}, ctx.text('rules.reserveSize'), size),
    h('small', {}, ctx.text('rules.reserveSizeHint')),
    message,
    h('button', { class: 'primary', type: 'submit' }, ctx.text('rules.reserveSizeSave')),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = Number(size.value);
    message.hidden = isShowcaseSize(value);
    if (!message.hidden) return;
    ctx.settle(ctx.store.worlds.setShowcaseSize(worldId, value).settled);
  });

  // Follow the world while nobody is typing in the field.
  const stop = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (world) => {
      if (document.activeElement !== size) size.value = String(world.ruleset.showcaseSize);
    }, onError),
  );
  return { element: h('section', { class: 'stack' }, h('h3', {}, ctx.text('rules.reserveSize')), problem, form), dispose: stop };
}
