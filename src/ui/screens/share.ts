import type { WorldScreen } from '../context';
import { h } from '../dom';
import { createInvite } from '../invite';
import { mountInstallOffer } from '../installOffer';

/** Shows the join link, its QR code and the code for typing by hand, right after a world is created (SPEC.md §5). */
export const renderShare: WorldScreen = (ctx, root, { worldId }) => {
  const offer = h('div', { class: 'stack' });
  root.append(
    h('h1', {}, ctx.text('share.title')),
    createInvite(ctx, worldId),
    h('div', { class: 'stack' }, h('button', { class: 'primary', onClick: () => ctx.go({ name: 'map' }) }, ctx.text('share.continue'))),
    offer,
  );
  return mountInstallOffer(ctx, offer);
};
