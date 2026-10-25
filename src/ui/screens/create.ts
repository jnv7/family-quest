import { LIMITS } from '../../core/model';
import { listThemes } from '../../theme';
import type { Screen } from '../context';
import { h } from '../dom';

/**
 * What was typed, kept while the screen is drawn again because the theme changed
 * (the labels use the theme's names). Cleared when the world is created.
 */
const draft = { worldName: '', yourName: '' };

/** Creates a world and the creator's own adult profile in one batch (SPEC.md §5). */
export const renderCreate: Screen = (ctx, root) => {
  const worldName = h('input', { type: 'text', required: true, maxLength: LIMITS.worldName, autocomplete: 'off', value: draft.worldName });
  const yourName = h('input', { type: 'text', required: true, maxLength: LIMITS.displayName, autocomplete: 'off', value: draft.yourName });
  worldName.addEventListener('input', () => (draft.worldName = worldName.value));
  yourName.addEventListener('input', () => (draft.yourName = yourName.value));

  // The theme is chosen here and is fixed for the world (SPEC.md §1). Only worth asking with a choice.
  const themes = listThemes();
  const themeField =
    themes.length > 1
      ? h('label', {}, ctx.text('create.theme'), (() => {
          const select = h('select', {}, ...themes.map((t) => h('option', { value: t.id, selected: t.id === ctx.theme.id }, t.name)));
          select.addEventListener('change', () => ctx.setTheme(select.value));
          return select;
        })())
      : null;

  const form = h('form', { class: 'stack' },
    themeField,
    h('label', {}, ctx.text(ctx.themeKnown ? 'create.worldName' : 'create.worldNameNeutral'), worldName),
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
    ctx.world.setTheme(ctx.theme.id);
    ctx.settle(created.settled);
    draft.worldName = draft.yourName = '';
    ctx.go({ name: 'share' });
  });

  root.append(h('h1', {}, ctx.text(ctx.themeKnown ? 'create.title' : 'create.titleNeutral')), form);
  return () => {};
};
