import type { WorldScreen } from '../context';
import { h } from '../dom';
import { canOfferInstall, mountInstallOffer } from '../installOffer';

/** How to install the app, with the world's theme (ADR 0005). */
export const renderInstall: WorldScreen = (ctx, root) => {
  const offer = h('div', { class: 'stack' });
  const none = h('p', { class: 'message' });
  root.append(
    h('h1', {}, ctx.text('install.title')),
    offer,
    none,
    h('div', { class: 'stack' }, h('button', { onClick: () => ctx.go({ name: 'map' }) }, ctx.text('app.back'))),
  );
  const stop = mountInstallOffer(ctx, offer);
  none.textContent = canOfferInstall(ctx) ? '' : ctx.text('install.nothing');
  return stop;
};
