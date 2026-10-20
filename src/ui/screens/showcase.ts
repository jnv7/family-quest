import type { Ruleset } from '../../core/model';
import type { ShowcaseItem } from '../../data/DataStore';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { createRenamer, entryOf, nameOf } from '../party';
import { observeSelf } from '../self';

/**
 * The showcase: the latest collectibles that went to the reserve, from everyone (SPEC.md §6).
 * It shows art and name, and tapping one shows it larger with its tier name. It never shows the
 * owner, a date or a count (SPEC.md §2), and the store does not hand over the owner at all.
 * An admin can also rename any of them (moderation); nothing here deletes.
 */
export const renderShowcase: WorldScreen = (ctx, root, { worldId }) => {
  const problem = h('div');
  const content = h('div', { class: 'stack' });
  const detail = h('section', { class: 'reveal', hidden: true, role: 'dialog' });

  let ruleset: Ruleset | null = null;
  let items: ShowcaseItem[] | null = null;
  let isAdmin = false;
  let selected: string | null = null;
  const renamer = createRenamer(ctx, worldId, () => draw());

  const close = () => {
    selected = null;
    renamer.reset();
    draw();
  };

  function draw(): void {
    if (items === null) return;
    const shown = items.find((item) => item.id === selected) ?? null;
    detail.hidden = shown === null;
    if (shown) {
      const entry = entryOf(ctx, shown);
      const parts = [
        entry ? artElement(ctx.theme, entry.art, 'reveal-art') : null,
        h('p', { class: 'reveal-name' }, nameOf(ctx, shown)),
        h('p', { class: 'reveal-tier' }, ctx.theme.tiers[shown.tier]),
        isAdmin ? renamer.control(shown.id, shown.nickname) : null,
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
            h('button', { class: 'showcase-item', onClick: () => ((selected = item.id), draw()) },
              entry ? artElement(ctx.theme, entry.art, 'recent-art') : null,
              h('span', {}, nameOf(ctx, item)),
            ),
          );
        }),
      ),
    );
  }

  root.append(
    h('h1', {}, ctx.text('showcase.title')),
    problem,
    detail,
    content,
    h('div', { class: 'stack' }, h('button', { onClick: () => ctx.go({ name: 'map' }) }, ctx.text('app.back'))),
  );

  let stopItems = () => {};
  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => {
      const size = value.ruleset.showcaseSize;
      if (ruleset?.showcaseSize === size) return;
      ruleset = value.ruleset;
      stopItems();
      stopItems = ctx.store.collectibles.observeShowcase(worldId, size, (list) => ((items = list), draw()), (error) => {
        console.error('Could not load the showcase', error);
        ctx.notify('notice.connection');
      });
    }, onError),
  );
  const stopSelf = observeSelf(ctx, worldId, ({ isAdmin: admin }) => {
    isAdmin = admin;
    draw();
  });
  return () => {
    stopItems();
    stopWorld();
    stopSelf();
  };
};
