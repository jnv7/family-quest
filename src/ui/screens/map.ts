import { boardAlert } from '../../core/alerts';
import { mooredBoats } from '../../core/moorings';
import type { Profile, ProfileId, Task, TaskDef, World } from '../../core/model';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import type { Route } from '../routes';
import { createMenu } from '../menu';
import { observeSelf } from '../self';
import type { PlaceRole } from '../../theme/types';
import { playTransition } from '../transition';

/** The share of its size each symbol keeps when one, two or three of them share a sail. */
const PLACE_SYMBOL_SCALES = [1, 0.78, 0.58] as const;

const PLACES: readonly PlaceRole[] = ['board', 'checkin', 'home', 'vault', 'showcase'];

/** Places that already lead somewhere; the others appear on the map but wait for their release. */
const DESTINATIONS: Partial<Record<PlaceRole, Route>> = {
  board: { name: 'board' },
  checkin: { name: 'checkin' },
  vault: { name: 'vault' },
  home: { name: 'home' },
  showcase: { name: 'showcase' },
};

/** The main screen: a map with five places, laid out by the theme (SPEC.md §7). */
export const renderMap: WorldScreen = (ctx, root, { worldId }) => {
  const { theme } = ctx;
  const title = h('h1');
  const menu = createMenu(ctx, worldId);
  const map = h('div', { class: 'map', style: `--ratio: ${theme.map.aspectRatio}` },
    artElement(theme, theme.map.background, 'map-art'),
  );
  let cancelTransition = () => {};
  let boardButton: HTMLElement | null = null;
  const placeSlots = new Map<PlaceRole, HTMLElement>();

  // Boats come before the places in the DOM, so a place always receives its own taps.
  const moorings = theme.map.moorings;
  const boats = moorings ? h('div', { class: 'boats' }) : null;
  if (boats) map.append(boats);

  for (const role of PLACES) {
    const place = theme.places[role];
    const destination = DESTINATIONS[role];
    // A place may carry the active profile's symbol (the big ship at the pier): its art then sits in a
    // slot the symbol is positioned in.
    const art = artElement(theme, place.art, 'place-art');
    const slot = place.symbolAt ? h('span', { class: 'place-slot' }, art) : null;
    if (slot) placeSlots.set(role, slot);
    const button = h('button', {
      class: `place${destination ? '' : ' soon'}`,
      disabled: !destination,
      title: destination ? undefined : ctx.text('map.soon'),
      style: `left:${place.x}%;top:${place.y}%;width:${place.width}%;height:${place.height}%`,
    },
      slot ?? art,
      h('span', { class: 'place-name' }, ctx.text(`map.${role}`)),
    );
    if (destination) {
      button.addEventListener('click', () => {
        cancelTransition();
        cancelTransition = playTransition(map, button, place.transition, () => ctx.go(destination));
      });
    }
    if (role === 'board') boardButton = button;
    map.append(button);
  }

  root.append(h('header', { class: 'bar' }, title, menu.button), map);

  /**
   * One boat per profile at the theme's moorings (SPEC.md §7). Only the active profile's own boat
   * is a button, and it opens their home like the home place does; the others are decoration, so
   * they show who is on the island and never open anyone else's home or party.
   */
  const drawBoats = (profiles: readonly Profile[], activeId: ProfileId | null) => {
    if (!boats || !moorings) return;
    boats.replaceChildren(
      ...mooredBoats(profiles, moorings, activeId).map((boat) => {
        const kind = moorings[boat.kind]!;
        const spot = kind.spots[boat.spotIndex]!;
        const style = `left:${spot.x}%;top:${spot.y}%;width:${spot.width}%;height:${spot.height}%`;
        const content = [
          artElement(theme, theme.homeVariants[boat.kind], 'boat-art'),
          boat.symbol
            ? h('span', { class: 'boat-symbol', 'aria-hidden': 'true', style: `left:${kind.symbolAt.x}%;top:${kind.symbolAt.y}%;--symbol-size:${kind.symbolAt.size}` }, boat.symbol)
            : null,
        ];
        if (!boat.own) return h('div', { class: 'boat', 'aria-hidden': 'true', style }, ...content);
        const button = h('button', { class: 'boat own', style, 'aria-label': ctx.text('map.ownBoat') }, ...content);
        button.addEventListener('click', () => {
          cancelTransition();
          cancelTransition = playTransition(map, button, theme.places.home.transition, () => ctx.go({ name: 'home' }));
        });
        return button;
      }),
    );
  };

  /**
   * The symbols over a place's art, when the art is the look of a profile kind (the big ship at the
   * pier is the adults' ship): those of every non-archived profile of that kind, in creation order,
   * so everyone sees whose ship it is. Up to three share the sail, smaller as they grow in number.
   */
  const drawPlaceSymbols = (profiles: readonly Profile[]) => {
    for (const [role, slot] of placeSlots) {
      const place = theme.places[role];
      const at = place.symbolAt!;
      slot.querySelectorAll('.boat-symbol').forEach((symbol) => symbol.remove());
      const kinds = (['adult', 'child'] as const).filter((kind) => JSON.stringify(place.art) === JSON.stringify(theme.homeVariants[kind]));
      const symbols = profiles
        .filter((profile) => kinds.includes(profile.kind) && !profile.archived && profile.avatar.symbol)
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
        .slice(0, PLACE_SYMBOL_SCALES.length)
        .map((profile) => profile.avatar.symbol!);
      const scale = PLACE_SYMBOL_SCALES[symbols.length - 1] ?? 1;
      const step = at.size * scale * 1.1;
      slot.append(
        ...symbols.map((symbol, i) =>
          h('span', {
            class: 'boat-symbol',
            'aria-hidden': 'true',
            style: `left:${at.x + (i - (symbols.length - 1) / 2) * step}%;top:${at.y}%;--symbol-size:${at.size * scale}`,
          }, symbol),
        ),
      );
    }
  };

  // The board lights up for a task due (today or past), new, or soon (tomorrow): a neutral effect,
  // the same for every theme (ADR 0006), with no text and no number (SPEC.md §2).
  let world: World | null = null;
  let tasks: Task[] = [];
  let defs = new Map<string, TaskDef>();
  let activeProfile: ProfileId | null = null;
  const light = () => {
    const lastSeen = activeProfile === null ? null : ctx.world.getLastSeen(worldId, activeProfile);
    const alert = world ? boardAlert(tasks, defs, ctx.clock(), world.ruleset.timezone, lastSeen) : null;
    if (alert) boardButton?.setAttribute('data-alert', alert);
    else boardButton?.removeAttribute('data-alert');
  };
  // The light is decoration: if it cannot load, the map still works, so errors are only logged.
  const unlit = (error: unknown) => console.warn('The plan alert could not load', error);
  const stopWorld = ctx.store.worlds.observeWorld(worldId, (value) => ((world = value), light()), unlit);
  const stopDefs = ctx.store.taskDefs.observeTaskDefs(worldId, (value) => ((defs = new Map(value.map((d) => [d.id, d]))), light()), unlit);
  let watchedProfile: ProfileId | null = null;
  let stopTasks = () => {};

  const stopSelf = observeSelf(ctx, worldId, ({ profile, profiles }) => {
    if (!profile) {
      // No active profile (yet, or the choice was refused): pick one.
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    if (profile.id !== watchedProfile) {
      stopTasks();
      watchedProfile = profile.id;
      activeProfile = profile.id;
      tasks = [];
      stopTasks = ctx.store.tasks.observeTasks(worldId, profile.id, (value) => ((tasks = value), light()), unlit);
    }
    drawBoats(profiles, profile.id);
    drawPlaceSymbols(profiles);
    title.textContent = ctx.text('map.hello', { name: profile.displayName });
  });
  return () => {
    cancelTransition();
    stopTasks();
    stopDefs();
    stopWorld();
    stopSelf();
    menu.dispose();
  };
};
