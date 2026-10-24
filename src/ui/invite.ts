import type { WorldId } from '../core/model';
import type { AppContext } from './context';
import { h } from './dom';
import { qrSvg } from './qr';
import { joinLink } from './routes';

/** The join link, its QR code and the code for typing by hand (SPEC.md §5), shared by `share` and Pessoas. */
export function createInvite(ctx: AppContext, worldId: WorldId): HTMLElement {
  const link = joinLink(ctx.baseUrl, worldId, ctx.theme.id);
  const status = h('p', { class: 'message', role: 'status' });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = ctx.text('share.copied');
    } catch {
      status.textContent = ctx.text('share.copyFailed');
    }
  };
  return h('div', { class: 'stack' },
    h('p', {}, ctx.text('share.explain')),
    h('div', { class: 'qr' }, qrSvg(link, ctx.text('share.qrLabel'))),
    h('p', { class: 'code' }, ctx.text('share.code', { code: worldId })),
    h('button', { onClick: () => void copy() }, ctx.text('share.copy')),
    status,
  );
}
