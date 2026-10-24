import type { World } from '../../core/model';
import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';
import { screenBar } from '../bar';

/** The sections everyone reads, in order; the adults' one comes after them. */
const SECTIONS = ['tasks', 'doing', 'earn', 'open', 'party', 'showcase', 'home'] as const;

/**
 * "Como jogar" (SPEC.md §7.9): read-only text from the locale files, with the theme's terms and the numbers
 * of the world's `ruleset`, so they are always the real ones. It shows no count about people.
 */
export const renderHowTo: WorldScreen = (ctx, root, { worldId }) => {
  const problem = h('div');
  const body = h('div', { class: 'how-to' });
  let world: World | null = null;
  let isAdmin = false;

  root.append(screenBar(ctx, { title: ctx.text('howTo.title'), back: { name: 'map' } }), problem, body);

  function draw(): void {
    if (!world) return;
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
    const keys = isAdmin ? [...SECTIONS, 'adults' as const] : SECTIONS;
    body.replaceChildren(
      ...keys.map((key) =>
        h('section', { class: 'how-to-section' },
          h('h2', {}, ctx.text(`howTo.${key}.title`, params)),
          h('p', {}, ctx.text(`howTo.${key}.body`, params)),
        ),
      ),
    );
  }

  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((world = value), draw()), onError),
  );
  const stopSelf = observeSelf(ctx, worldId, (self) => ((isAdmin = self.isAdmin), draw()));
  return () => {
    stopWorld();
    stopSelf();
  };
};
