import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeSelf } from '../self';

/** Placeholder until the map arrives (0.2.2): who am I, and where can I go. */
export const renderHome: WorldScreen = (ctx, root, { worldId }) => {
  const title = h('h1');
  const actions = h('div', { class: 'stack' });
  root.append(title, h('p', {}, ctx.text('home.soon')), actions);

  return observeSelf(ctx, worldId, ({ profile, isAdmin }) => {
    if (!profile) {
      // No active profile (yet, or the choice was refused): pick one.
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    title.textContent = ctx.text('home.hello', { name: profile.displayName });
    const buttons = [h('button', { onClick: () => ctx.go({ name: 'profiles' }) }, ctx.text('home.switch'))];
    if (isAdmin) buttons.push(h('button', { onClick: () => ctx.go({ name: 'manage' }) }, ctx.text('home.manage')));
    actions.replaceChildren(...buttons);
  });
};
