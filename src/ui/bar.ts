import type { AppContext } from './context';
import { h } from './dom';
import type { Route } from './routes';

/**
 * The top bar of a screen (SPEC.md §7): back on the left, the title, and at most one action on the
 * right. It replaces the "back" button that used to sit at the bottom, far from the thumb on a long
 * screen. The map keeps its own bar.
 */
export function screenBar(ctx: AppContext, options: { title: string; back: Route | null; action?: HTMLElement | null }): HTMLElement {
  const { title, back, action } = options;
  return h('header', { class: 'screen-bar' },
    back ? h('button', { class: 'back', type: 'button', onClick: () => ctx.go(back) }, `‹ ${ctx.text('app.back')}`) : h('span'),
    h('h1', {}, title),
    action ?? h('span'),
  );
}
