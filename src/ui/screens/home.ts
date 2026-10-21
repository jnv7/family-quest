import { collectionOf } from '../../core/collection';
import type { Collectible, Profile, ProfileId, Ruleset } from '../../core/model';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { createPartyControls, createRenamer, entryOf, nameOf } from '../party';
import { observeSelf } from '../self';
import emojiGroups from '../emoji.json';

/**
 * The home: the active profile's own place (SPEC.md §7.5). It shows the profile with the
 * theme's look for its kind with its symbol on the sail, and a button that opens a panel of emoji
 * (the theme's suggestions, then the animals and plants) to choose it from, then the party and the pending collectibles. A collectible sent away leaves the
 * profile and is seen in the showcase with the others (SPEC.md §6); it is not deleted. Nothing here
 * is counted or compared (SPEC.md §2).
 */
export const renderHome: WorldScreen = (ctx, root, { worldId }) => {
  const problem = h('div');
  const header = h('section', { class: 'home-header' });
  const symbolPanel = h('section', { class: 'symbol-panel', hidden: true });
  const partySection = h('section', { class: 'stack' });
  const pendingSection = h('section', { class: 'stack' });

  let ruleset: Ruleset | null = null;
  let profile: Profile | null = null;
  let collectibles: Collectible[] | null = null;
  const controls = createPartyControls(ctx, worldId, () =>
    profile && ruleset && collectibles ? { profile, ruleset, owned: collectibles } : null,
  );

  const renamer = createRenamer(ctx, worldId, () => draw());
  const nameLine = (collectible: Collectible): HTMLElement => renamer.control(collectible.id, collectible.nickname);

  const card = (collectible: Collectible, extras: Array<HTMLElement | null>): HTMLElement => {
    // A slot the theme lacks is a bug, reported by `entryOf` and `nameOf`; the card still shows, with the tier name.
    const entry = entryOf(ctx, collectible);
    return h('li', { class: 'collectible-card' },
      entry ? artElement(ctx.theme, entry.art, 'recent-art') : null,
      h('p', { class: 'reveal-name' }, nameOf(ctx, collectible)),
      h('small', {}, ctx.theme.tiers[collectible.tier]),
      ...extras,
    );
  };

  const section = (target: HTMLElement, title: string, hint: string | null, empty: string | null, items: HTMLElement[]) => {
    const body = items.length === 0 ? (empty ? h('p', { class: 'message' }, empty) : null) : h('ul', { class: 'collectible-list' }, ...items);
    target.replaceChildren(...[h('h2', {}, title), hint ? h('p', { class: 'hint' }, hint) : null, body].flatMap((part) => (part ? [part] : [])));
  };

  /**
   * The boat on the home: the theme's art for the profile's kind, with the symbol on its sail where
   * the theme says (`homeSymbolAt`), or next to the name when it does not say.
   */
  const boat = (active: Profile): HTMLElement => {
    const at = ctx.theme.homeSymbolAt?.[active.kind];
    const symbol = active.avatar.symbol;
    return h('div', { class: 'home-boat' },
      artElement(ctx.theme, ctx.theme.homeVariants[active.kind], 'home-art'),
      symbol && at
        ? h('span', { class: 'boat-symbol', 'aria-hidden': 'true', style: `left:${at.x}%;top:${at.y}%;--symbol-size:${at.size}` }, symbol)
        : null,
    );
  };

  const choose = (symbol: string | null) => {
    if (!profile) return;
    ctx.settle(ctx.store.worlds.setProfileSymbol(worldId, profile.id, symbol).settled);
    symbolPanel.hidden = true;
  };

  /** Every emoji, grouped, with the theme's suggestions first; built once, the first time it opens. */
  const buildPanel = () => {
    const grid = (emojis: readonly string[]) =>
      h('div', { class: 'symbol-grid' }, ...emojis.map((emoji) => h('button', { class: 'symbol', type: 'button', 'data-emoji': emoji }, emoji)));
    symbolPanel.replaceChildren(
      h('div', { class: 'symbol-bar' },
        h('h2', {}, ctx.text('home.symbolPanel')),
        h('button', { type: 'button', onClick: () => choose(null) }, ctx.text('home.symbolNone')),
        h('button', { type: 'button', onClick: () => (symbolPanel.hidden = true) }, ctx.text('home.symbolClose')),
      ),
      h('h3', {}, ctx.text('home.symbolSuggested')),
      grid(ctx.theme.profileSymbols),
      ...emojiGroups.flatMap((group) => [h('h3', {}, ctx.text(`emoji.group.${group.id}`)), grid(group.emojis)]),
    );
    symbolPanel.addEventListener('click', (event) => {
      const emoji = (event.target as HTMLElement).closest<HTMLElement>('[data-emoji]')?.dataset.emoji;
      if (emoji) choose(emoji);
    });
  };

  function draw(): void {
    if (!profile) return;
    const beside = profile.avatar.symbol && !ctx.theme.homeSymbolAt?.[profile.kind] ? ` ${profile.avatar.symbol}` : '';
    header.replaceChildren(
      boat(profile),
      h('p', { class: 'reveal-name' }, `${profile.displayName}${beside}`),
      h('button', {
        onClick: () => {
          if (symbolPanel.childElementCount === 0) buildPanel();
          symbolPanel.hidden = !symbolPanel.hidden;
        },
      }, ctx.text('home.chooseSymbol')),
    );
    if (collectibles === null || ruleset === null) return;
    const { party, pending } = collectionOf(collectibles, profile.partyIds);
    const list = (items: Collectible[], extras: (c: Collectible) => Array<HTMLElement | null>) =>
      items.map((collectible) => card(collectible, extras(collectible)));

    section(partySection, ctx.text('home.party'), ctx.text('home.partyHint'), ctx.text('home.partyEmpty'),
      list(party, (c) => [
        nameLine(c),
        h('button', { onClick: () => controls.toReserve(c) }, ctx.text('home.toReserve')),
      ]),
    );
    section(pendingSection, ctx.text('home.pending'), null, null, list(pending, (c) => [controls.choices(c)]));
    pendingSection.hidden = pending.length === 0;
  }

  root.append(
    h('h1', {}, ctx.text('home.title')),
    problem,
    header,
    symbolPanel,
    partySection,
    pendingSection,
    h('div', { class: 'stack' }, h('button', { onClick: () => ctx.go({ name: 'map' }) }, ctx.text('app.back'))),
  );

  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((ruleset = value.ruleset), draw()), onError),
  );
  let watched: ProfileId | null = null;
  let stopData = () => {};
  const stopSelf = observeSelf(ctx, worldId, ({ profile: active }) => {
    if (!active) {
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    profile = active;
    if (active.id === watched) {
      draw();
      return;
    }
    stopData();
    watched = active.id;
    collectibles = null;
    renamer.reset();
    stopData = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.collectibles.observeCollectibles(worldId, active.id, (value) => ((collectibles = value), draw()), onError),
    );
    draw();
  });
  return () => {
    stopData();
    stopWorld();
    stopSelf();
  };
};
