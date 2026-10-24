import type { Profile, WorldId } from '../core/model';
import type { AppContext } from './context';
import { h } from './dom';
import { qrSvg } from './qr';
import { joinLink } from './routes';

/**
 * The join link, its QR code and the code for typing by hand (SPEC.md §5), shared by `share` and Pessoas.
 * With a child's `profile` (ADR 0015) it is that child's own invite: the link ends with the profile id, and the bare
 * code is not shown, because typing it would lose the profile. The name stays on this screen, never in the link.
 */
export function createInvite(ctx: AppContext, worldId: WorldId, profile?: Profile): HTMLElement {
  const link = joinLink(ctx.baseUrl, worldId, ctx.theme.id, profile?.id ?? null);
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
    h('p', {}, profile ? ctx.text('people.childInviteExplain', { name: profile.displayName }) : ctx.text('share.explain')),
    h('div', { class: 'qr' }, qrSvg(link, ctx.text('share.qrLabel'))),
    !profile && h('p', { class: 'code' }, ctx.text('share.code', { code: worldId })),
    h('button', { onClick: () => void copy() }, ctx.text('share.copy')),
    status,
  );
}
