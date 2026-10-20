import { collectionOf, nicknameTooLong, normaliseNickname } from '../../core/collection';
import type { Collectible, Profile, ProfileId, Ruleset, TaskId } from '../../core/model';
import { LIMITS } from '../../core/model';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { createPartyControls, entryOf, nameOf } from '../party';
import { observeSelf } from '../self';

/**
 * The home: the active profile's own place (SPEC.md §7.5). It shows the profile with the
 * theme's look for its kind, an empty place for the avatar (0.8), the party, the pending
 * collectibles and the reserve. Nothing here is counted or compared (SPEC.md §2), and nothing can
 * be deleted: a collectible only moves between the party and the reserve.
 */
export const renderHome: WorldScreen = (ctx, root, { worldId }) => {
  const problem = h('div');
  const header = h('section', { class: 'home-header' });
  const partySection = h('section', { class: 'stack' });
  const pendingSection = h('section', { class: 'stack' });
  const reserveSection = h('section', { class: 'stack' });

  let ruleset: Ruleset | null = null;
  let profile: Profile | null = null;
  let collectibles: Collectible[] | null = null;
  /** The collectible being renamed, and the text typed so far (a redraw must not lose it). */
  let editing: TaskId | null = null;
  let draft = '';
  let renameError = false;

  const controls = createPartyControls(ctx, worldId, () =>
    profile && ruleset && collectibles ? { profile, ruleset, owned: collectibles } : null,
  );

  const rename = (collectible: Collectible, text: string) => {
    const nickname = normaliseNickname(text);
    if (nicknameTooLong(nickname)) {
      renameError = true;
      draw();
      return;
    }
    editing = null;
    renameError = false;
    ctx.settle(ctx.store.collectibles.setNickname(worldId, collectible.id, nickname).settled);
    draw();
  };

  const nameLine = (collectible: Collectible): HTMLElement => {
    if (editing !== collectible.id) {
      return h('button', { onClick: () => ((editing = collectible.id), (draft = collectible.nickname ?? ''), draw()) }, ctx.text('home.rename'));
    }
    const input = h('input', { type: 'text', value: draft, maxLength: LIMITS.nickname });
    input.addEventListener('input', () => (draft = input.value));
    return h('form', {
      class: 'rename',
      onSubmit: (event: Event) => {
        event.preventDefault();
        rename(collectible, input.value);
      },
    },
      h('label', {}, ctx.text('home.renameLabel'), input),
      h('button', { class: 'primary', type: 'submit' }, ctx.text('home.renameSave')),
      h('button', { type: 'button', onClick: () => ((editing = null), (renameError = false), draw()) }, ctx.text('home.renameCancel')),
      renameError ? h('p', { class: 'message', role: 'alert' }, ctx.text('home.renameTooLong')) : null,
    );
  };

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

  const section = (target: HTMLElement, title: string, empty: string | null, items: HTMLElement[]) => {
    const body = items.length === 0 ? (empty ? h('p', { class: 'message' }, empty) : null) : h('ul', { class: 'collectible-list' }, ...items);
    target.replaceChildren(...(body ? [h('h2', {}, title), body] : [h('h2', {}, title)]));
  };

  function draw(): void {
    if (!profile) return;
    header.replaceChildren(
      artElement(ctx.theme, ctx.theme.homeVariants[profile.kind], 'home-art'),
      h('p', { class: 'reveal-name' }, profile.displayName),
      h('p', { class: 'avatar-place' }, ctx.text('home.avatarSoon')),
    );
    if (collectibles === null || ruleset === null) return;
    const { party, pending, reserve } = collectionOf(collectibles, profile.partyIds);
    const list = (items: Collectible[], extras: (c: Collectible) => Array<HTMLElement | null>) =>
      items.map((collectible) => card(collectible, extras(collectible)));

    section(partySection, ctx.text('home.party'), ctx.text('home.partyEmpty'),
      list(party, (c) => [
        nameLine(c),
        h('button', { onClick: () => controls.toReserve(c) }, ctx.text('home.toReserve')),
      ]),
    );
    section(pendingSection, ctx.text('home.pending'), null, list(pending, (c) => [controls.choices(c)]));
    pendingSection.hidden = pending.length === 0;
    section(reserveSection, ctx.text('home.reserve'), ctx.text('home.reserveEmpty'),
      list(reserve, (c) => [nameLine(c), controls.choices(c)]),
    );
  }

  root.append(
    h('h1', {}, ctx.text('home.title')),
    problem,
    header,
    partySection,
    pendingSection,
    reserveSection,
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
    editing = null;
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
