import type { WorldScreen } from '../context';
import { h } from '../dom';
import { canOfferInstall, mountInstallOffer } from '../installOffer';
import { screenBar } from '../bar';

/** How to install the app, with the world's theme (ADR 0005). */
export const renderInstall: WorldScreen = (ctx, root) => {
  const offer = h('div', { class: 'stack' });
  const none = h('p', { class: 'message' });
  root.append(
    screenBar(ctx, { title: ctx.text('install.title'), back: { name: 'map' } }),
    offer,
    none,
  );
  const stop = mountInstallOffer(ctx, offer);
  none.textContent = canOfferInstall(ctx) ? '' : ctx.text('install.nothing');
  return stop;
};
