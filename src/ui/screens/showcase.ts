import type { Collectible, Profile, ProfileId, Ruleset } from '../../core/model';
import type { ShowcaseItem } from '../../data/DataStore';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { createPartyControls, createRenamer, entryOf, nameOf } from '../party';
import { observeSelf } from '../self';
import { screenBar } from '../bar';

/**
 * The showcase: the latest collectibles that went to the reserve, from everyone (SPEC.md §6).
 * It shows art and name, and tapping one shows it larger with its tier name. It never shows the
 * owner, a date or a count (SPEC.md §2), and the store does not hand over the owner at all.
 * An admin can also rename any of them (moderation). Anyone can take one into their own party from here,
 * whoever it came from, and it becomes theirs with its name (ADR 0010); nothing here deletes.
 */
export const renderShowcase: WorldScreen = (ctx, root, { worldId }) => {
  const problem = h('div');
  const content = h('div', { class: 'stack' });
  const detail = h('section', { class: 'reveal', hidden: true, role: 'dialog' });

  let ruleset: Ruleset | null = null;
  let items: ShowcaseItem[] | null = null;
  let isAdmin = false;
  let selected: string | null = null;
  let profile: Profile | null = null;
  /** The active profile's own collectibles: the party's members, which are who may leave when it is full. */
  let owned: Collectible[] | null = null;
  const controls = createPartyControls(ctx, worldId, () => (profile && ruleset && owned ? { profile, ruleset, owned } : null));
  const renamer = createRenamer(ctx, worldId, () => draw());

  const close = () => {
    selected = null;
    renamer.reset();
    draw();
  };

  /** The choices to take the item into the party: anyone may, whoever it came from (ADR 0010). */
  const takeChoices = (item: ShowcaseItem): HTMLElement | null => controls.choices(item, true);

  function draw(): void {
    if (items === null) return;
    const shown = items.find((item) => item.id === selected) ?? null;
    detail.hidden = shown === null;
    if (shown) {
      const entry = entryOf(ctx, shown);
      const parts = [
        entry ? artElement(ctx.theme, entry.art, 'reveal-art') : null,
        renamer.tag(shown, isAdmin),
        h('p', { class: 'reveal-tier' }, ctx.theme.tiers[shown.tier]),
        takeChoices(shown),
        h('button', { onClick: close }, ctx.text('showcase.close')),
      ];
      detail.replaceChildren(...parts.flatMap((part) => (part ? [part] : [])));
    } else {
      detail.replaceChildren();
    }

    if (items.length === 0) {
      content.replaceChildren(h('p', { class: 'message' }, ctx.text('showcase.empty')));
      return;
    }
    content.replaceChildren(
      h('ul', { class: 'showcase-grid' },
        ...items.map((item) => {
          const entry = entryOf(ctx, item);
          return h('li', {},
            h('button', { class: 'showcase-item', 'data-id': item.id, onClick: () => ((selected = item.id), draw()) },
              entry ? artElement(ctx.theme, entry.art, 'recent-art') : null,
              h('span', {}, nameOf(ctx, item)),
            ),
          );
        }),
      ),
    );
  }

  root.append(
    screenBar(ctx, { title: ctx.text('showcase.title'), back: { name: 'map' } }),
    problem,
    detail,
    content,
  );

  let stopItems = () => {};
  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => {
      const size = value.ruleset.showcaseSize;
      const unchanged = ruleset?.showcaseSize === size;
      ruleset = value.ruleset;
      if (unchanged) return;
      stopItems();
      stopItems = ctx.store.collectibles.observeShowcase(worldId, size, (list) => ((items = list), draw()), (error) => {
        console.error('Could not load the showcase', error);
        ctx.notify('notice.connection');
      });
    }, onError),
  );
  let watched: ProfileId | null = null;
  let stopOwned = () => {};
  const stopSelf = observeSelf(ctx, worldId, ({ profile: active, isAdmin: admin }) => {
    isAdmin = admin;
    profile = active;
    if (active?.id !== watched) {
      stopOwned();
      watched = active?.id ?? null;
      owned = null;
      stopOwned = active
        ? ctx.store.collectibles.observeCollectibles(worldId, active.id, (value) => ((owned = value), draw()), (error) => console.error('Could not load the collectibles', error))
        : () => {};
    }
    draw();
  });
  return () => {
    stopItems();
    stopOwned();
    stopWorld();
    stopSelf();
  };
};
