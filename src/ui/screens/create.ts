import { LIMITS } from '../../core/model';
import type { Screen } from '../context';
import { h } from '../dom';

/** Creates a world and the creator's own adult profile in one batch (SPEC.md §5). */
export const renderCreate: Screen = (ctx, root) => {
  const worldName = h('input', { type: 'text', required: true, maxLength: LIMITS.worldName, autocomplete: 'off' });
  const yourName = h('input', { type: 'text', required: true, maxLength: LIMITS.displayName, autocomplete: 'off' });

  const form = h('form', { class: 'stack' },
    h('label', {}, ctx.text('create.worldName'), worldName),
    h('label', {}, ctx.text('create.yourName'), yourName),
    h('button', { class: 'primary', type: 'submit' }, ctx.text('create.submit')),
    h('button', { type: 'button', onClick: () => ctx.go({ name: 'start' }) }, ctx.text('app.back')),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = worldName.value.trim();
    const creatorDisplayName = yourName.value.trim();
    if (!name || !creatorDisplayName) return;

    const created = ctx.store.worlds.createWorld({ name, themeId: ctx.theme.id, creatorDisplayName });
    ctx.world.set(created.result.worldId);
    ctx.settle(created.settled);
    ctx.go({ name: 'share' });
  });

  root.append(h('h1', {}, ctx.text('create.title')), form);
  return () => {};
};
