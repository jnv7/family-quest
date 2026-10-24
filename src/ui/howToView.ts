import { TIERS, type TaskLevel, type World } from '../core/model';
import type { AppContext } from './context';
import { artElement } from './art';
import { h } from './dom';

/** The sections everyone reads, in order; the adults' one comes after them. */
const SECTIONS = ['tasks', 'doing', 'earn', 'open', 'party', 'showcase', 'home'] as const;
type Section = (typeof SECTIONS)[number] | 'adults';

/**
 * The body of "Como jogar" (SPEC.md §7.9): a heading, a paragraph and a picture per section, all from the locale
 * files and the theme, with the numbers of the world's `ruleset`, so they are always the real ones. The pictures
 * are the theme's own art, as the game shows it, and are decoration only: the text says everything. It shows
 * no count about people.
 */
export function howToView(ctx: AppContext, world: World, isAdmin: boolean): HTMLElement {
  const { theme } = ctx;
  const { tokensPerLevel: tokens, tokenPrices: prices, partySize, showcaseSize } = world.ruleset;
  const params = {
    low: tokens.low,
    mid: tokens.mid,
    high: tokens.high,
    lowPrice: prices.low,
    midPrice: prices.mid,
    highPrice: prices.high,
    partySize,
    showcaseSize,
  };
  const tokenIcons = (count: number) => Array.from({ length: count }, () => artElement(theme, theme.tokenArt, 'token-art'));

  /** The picture of a section: a place or a home, or a row of what the section talks about. */
  const pictureFor = (key: Section): HTMLElement => {
    switch (key) {
      case 'tasks':
        return h('div', { class: 'how-to-art' }, artElement(theme, theme.places.board.art, 'how-to-image'));
      case 'doing':
        return h('div', { class: 'how-to-art' }, artElement(theme, theme.places.checkin.art, 'how-to-image'));
      case 'earn':
        return h('div', { class: 'how-to-art how-to-row' },
          ...TIERS.map((level: TaskLevel) =>
            h('span', { class: 'how-to-chip' }, h('span', {}, ctx.text(`level.${level}`)), h('span', { class: 'how-to-tokens' }, ...tokenIcons(tokens[level]))),
          ),
        );
      case 'open':
        return h('div', { class: 'how-to-art how-to-row' },
          ...TIERS.map((tier) =>
            h('span', { class: 'how-to-chip' },
              artElement(theme, theme.rewardArt[tier], 'how-to-reward'),
              h('span', { class: 'how-to-tokens' }, String(prices[tier]), ...tokenIcons(1)),
            ),
          ),
        );
      case 'party':
        return h('div', { class: 'how-to-art' }, artElement(theme, theme.homeVariants.child, 'how-to-image'));
      case 'showcase':
        return h('div', { class: 'how-to-art' }, artElement(theme, theme.places.showcase.art, 'how-to-image'));
      case 'home':
        return h('div', { class: 'how-to-art' }, artElement(theme, theme.places.home.art, 'how-to-image'));
      case 'adults':
        return h('div', { class: 'how-to-art' }, artElement(theme, theme.homeVariants.adult, 'how-to-image'));
    }
  };

  const keys: Section[] = isAdmin ? [...SECTIONS, 'adults'] : [...SECTIONS];
  return h('div', { class: 'how-to' },
    ...keys.map((key) =>
      h('section', { class: `how-to-section how-to-${key}` },
        pictureFor(key),
        h('h3', {}, ctx.text(`howTo.${key}.title`, params)),
        h('p', {}, ctx.text(`howTo.${key}.body`, params)),
      ),
    ),
  );
}
