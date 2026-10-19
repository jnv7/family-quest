import type { WorldScreen } from '../context';
import { h } from '../dom';
import { qrSvg } from '../qr';
import { mountInstallOffer } from '../installOffer';
import { joinLink } from '../routes';

/** Shows the join link, its QR code and the code for typing by hand (SPEC.md §5). */
export const renderShare: WorldScreen = (ctx, root, { worldId }) => {
  const link = joinLink(ctx.baseUrl, worldId, ctx.theme.id);
  const status = h('p', { class: 'message', role: 'status' });
  const offer = h('div', { class: 'stack' });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = ctx.text('share.copied');
    } catch {
      status.textContent = ctx.text('share.copyFailed');
    }
  };

  root.append(
    h('h1', {}, ctx.text('share.title')),
    h('p', {}, ctx.text('share.explain')),
    h('div', { class: 'qr' }, qrSvg(link, ctx.text('share.qrLabel'))),
    h('p', { class: 'code' }, ctx.text('share.code', { code: worldId })),
    h('div', { class: 'stack' },
      h('button', { onClick: () => void copy() }, ctx.text('share.copy')),
      h('button', { class: 'primary', onClick: () => ctx.go({ name: 'map' }) }, ctx.text('share.continue')),
    ),
    status,
    offer,
  );
  return mountInstallOffer(ctx, offer);
};
