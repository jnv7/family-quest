import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import type { Route } from '../routes';
import { canOfferInstall } from '../installOffer';
import { observeSelf } from '../self';
import type { PlaceRole } from '../../theme/types';
import { playTransition } from '../transition';

const PLACES: readonly PlaceRole[] = ['board', 'checkin', 'home', 'vault', 'showcase'];

/** Places that already lead somewhere; the others appear on the map but wait for their release. */
const DESTINATIONS: Partial<Record<PlaceRole, Route>> = { board: { name: 'board' }, checkin: { name: 'checkin' } };

/** The main screen: a map with five places, laid out by the theme (SPEC.md §7). */
export const renderMap: WorldScreen = (ctx, root, { worldId }) => {
  const { theme } = ctx;
  const title = h('h1');
  const actions = h('div', { class: 'bar-actions' });
  const map = h('div', { class: 'map', style: `--ratio: ${theme.map.aspectRatio}` },
    artElement(theme, theme.map.background, 'map-art'),
  );
  let cancelTransition = () => {};

  for (const role of PLACES) {
    const place = theme.places[role];
    const destination = DESTINATIONS[role];
    const button = h('button', {
      class: `place${destination ? '' : ' soon'}`,
      disabled: !destination,
      title: destination ? undefined : ctx.text('map.soon'),
      style: `left:${place.x}%;top:${place.y}%;width:${place.width}%;height:${place.height}%`,
    },
      artElement(theme, place.art, 'place-art'),
      h('span', { class: 'place-name' }, ctx.text(`map.${role}`)),
    );
    if (destination) {
      button.addEventListener('click', () => {
        cancelTransition();
        cancelTransition = playTransition(map, button, place.transition, () => ctx.go(destination));
      });
    }
    map.append(button);
  }

  root.append(h('header', { class: 'bar' }, title, actions), map);

  const stopSelf = observeSelf(ctx, worldId, ({ profile, isAdmin }) => {
    if (!profile) {
      // No active profile (yet, or the choice was refused): pick one.
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    title.textContent = ctx.text('map.hello', { name: profile.displayName });
    const buttons = [h('button', { onClick: () => ctx.go({ name: 'profiles' }) }, ctx.text('map.switch'))];
    if (canOfferInstall(ctx)) buttons.push(h('button', { onClick: () => ctx.go({ name: 'install' }) }, ctx.text('map.install')));
    if (isAdmin) buttons.push(h('button', { onClick: () => ctx.go({ name: 'manage' }) }, ctx.text('map.manage')));
    actions.replaceChildren(...buttons);
  });
  return () => {
    cancelTransition();
    stopSelf();
  };
};
