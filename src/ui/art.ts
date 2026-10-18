import { assetUrl } from '../theme';
import type { Art, Theme } from '../theme/types';
import { h } from './dom';

/** Draws a piece of theme art: an emoji (minimal themes) or an image from the theme's folder. */
export function artElement(theme: Theme, art: Art, className: string): HTMLElement {
  if ('emoji' in art) return h('span', { class: className, 'aria-hidden': 'true' }, art.emoji);
  return h('img', { class: className, src: assetUrl(theme.id, art.image), alt: '' });
}
