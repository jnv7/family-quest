import { formatBuildDate } from '../core/calendar';
import { DEFAULT_RULESET, type WorldId } from '../core/model';
import type { AppContext, Dispose } from './context';
import { h } from './dom';
import type { Route } from './routes';
import { observeSelf } from './self';

/** One row of the menu. */
interface Item {
  label: string;
  route: Route;
}

/**
 * The settings menu (SPEC.md §7): the panel behind ⚙ on the map. It is a modal `<dialog>`, which gives
 * focus handling and Escape for free. It closes with ✕, a tap outside it, and the system back gesture.
 * Tapping an item closes it and opens that screen in place of the overlay's history entry, so back from
 * that screen returns to the map in one step.
 */
export function createMenu(ctx: AppContext, worldId: WorldId): { button: HTMLElement; dispose: Dispose } {
  const dialog = h('dialog', { class: 'menu', 'aria-label': ctx.text('menu.title') });
  const button = h('button', { class: 'menu-button', type: 'button', 'aria-label': ctx.text('menu.open'), onClick: () => open() }, '⚙');
  let isAdmin = false;
  let endOverlay: ((options?: { keepEntry?: boolean }) => void) | null = null;

  const itemsFor = (): Array<Item | { heading: string }> => {
    const items: Array<Item | { heading: string }> = [
      { label: ctx.text('menu.howTo'), route: { name: 'howTo' } },
      { label: ctx.text('menu.install'), route: { name: 'install' } },
    ];
    if (isAdmin) {
      items.push(
        { heading: ctx.text('menu.settings') },
        { label: ctx.text('menu.people'), route: { name: 'people' } },
        { label: ctx.text('menu.tasks'), route: { name: 'tasks' } },
        { label: ctx.text('menu.rules'), route: { name: 'rules' } },
      );
    }
    items.push({ label: ctx.text('map.switch'), route: { name: 'profiles' } });
    return items;
  };

  const draw = () => {
    if (!dialog.open) return;
    dialog.replaceChildren(
      h('div', { class: 'menu-panel' },
        h('header', { class: 'menu-head' },
          h('h2', {}, ctx.text('menu.title')),
          h('button', { class: 'menu-close', type: 'button', 'aria-label': ctx.text('menu.close'), onClick: () => close() }, '✕'),
        ),
        h('nav', { class: 'menu-items' },
          ...itemsFor().map((item) =>
            'heading' in item
              ? h('h3', { class: 'menu-heading' }, item.heading)
              : h('button', { type: 'button', class: 'menu-item', onClick: () => choose(item.route) }, item.label),
          ),
        ),
        h('footer', { class: 'menu-foot' },
          h('p', { class: 'version' }, ctx.text('menu.version', { version: ctx.build.version, date: formatBuildDate(ctx.build.builtAt, DEFAULT_RULESET.timezone) })),
          ctx.updater.available() && h('button', { type: 'button', class: 'menu-update', onClick: () => void ctx.updater.apply() }, ctx.text('menu.update')),
        ),
      ),
    );
  };

  const hide = () => {
    if (dialog.open) dialog.close();
    dialog.replaceChildren();
  };

  function open(): void {
    if (dialog.open) return;
    dialog.showModal();
    endOverlay = ctx.pushOverlay(() => {
      endOverlay = null; // the person went back: the entry is already gone
      hide();
    });
    draw();
    void ctx.updater.check();
  }

  /** Closed from the app (✕, the backdrop): the history entry goes too. */
  function close(): void {
    const end = endOverlay;
    endOverlay = null;
    end?.();
    hide();
  }

  function choose(route: Route): void {
    const end = endOverlay;
    endOverlay = null;
    end?.({ keepEntry: true });
    hide();
    ctx.go(route, { replace: true });
  }

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  // Escape closes a modal dialog by itself; the history entry goes with it.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });

  const stopSelf = observeSelf(ctx, worldId, (self) => {
    isAdmin = self.isAdmin;
    draw();
  });
  const stopUpdater = ctx.updater.onChange(draw);
  const host = h('span', { class: 'menu-host' }, button, dialog);

  return {
    button: host,
    dispose() {
      stopSelf();
      stopUpdater();
      const end = endOverlay;
      endOverlay = null;
      end?.({ keepEntry: true }); // the screen is going away: leave the history to whoever navigates
      hide();
    },
  };
}
