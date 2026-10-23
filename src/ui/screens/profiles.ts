import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeSelf } from '../self';

/** Netflix-style picker of the world's non-archived profiles (SPEC.md §7.2). */
export const renderProfiles: WorldScreen = (ctx, root, { worldId }) => {
  const list = h('div', { class: 'profiles' });
  root.append(h('h1', {}, ctx.text('profiles.title')), list);

  return observeSelf(ctx, worldId, ({ profiles }) => {
    list.replaceChildren(
      ...profiles
        .filter((profile) => !profile.archived)
        .map((profile) =>
          h('button', {
            class: 'profile',
            onClick: () => {
              ctx.settle(ctx.store.worlds.chooseProfile(worldId, profile.id).settled);
              ctx.go({ name: 'map' });
            },
          },
            // The profile's emoji stands where the picture would be; with none, the initial.
            h('span', { class: 'avatar', 'aria-hidden': 'true' }, profile.avatar.symbol ?? ([...profile.displayName][0]?.toUpperCase() ?? '')),
            h('span', { class: 'name' }, profile.displayName),
          ),
        ),
    );
  });
};
