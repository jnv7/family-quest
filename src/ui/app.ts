/** Router and boot of the interface (docs/architecture.md §9). Screens render only from observers. */
import type { Build } from '../core/build';
import type { Clock, RandomInt } from '../core/model';
import type { DataStore } from '../data/DataStore';
import type { Theme } from '../theme';
import { formatMessage, hasTheme, loadTheme } from '../theme';
import { reportSettleError, type AppContext, type Dispose, type Screen, type WorldScreen } from './context';
import { h } from './dom';
import { createCarryKeeper, type CarryWriter } from './carry';
import { createGenerator } from './generation';
import type { Installer } from './install';
import type { Navigation } from './navigation';
import { createReserveKeeper } from './reserve';
import { applyThemeToPage } from './pageTheme';
import { hashFor, parseHash, type Carry, type Route } from './routes';
import { renderCreate } from './screens/create';
import { renderBoard } from './screens/board';
import { renderCheckin } from './screens/checkin';
import type { Updater } from './updates';
import { renderInstall } from './screens/install';
import { renderJoin } from './screens/join';
import { renderPeople } from './screens/people';
import { renderRules } from './screens/rules';
import { renderTasks } from './screens/tasks';
import { renderMap } from './screens/map';
import { renderTaskForm } from './screens/taskForm';
import { renderProfiles } from './screens/profiles';
import { renderShare } from './screens/share';
import { renderStart } from './screens/start';
import { renderHome } from './screens/home';
import { renderShowcase } from './screens/showcase';
import { renderVault } from './screens/vault';
import type { WorldMemory } from './worldMemory';

export interface AppOptions {
  root: HTMLElement;
  store: DataStore;
  theme: Theme;
  /** The app's URL without the hash. */
  baseUrl: string;
  world: WorldMemory;
  clock: Clock;
  randomInt: RandomInt;
  navigation: Navigation;
  installer: Installer;
  /** The running build, shown in the menu. */
  build: Build;
  /** Looks for a newer build (ADR 0012). */
  updater: Updater;
  /** What the launch address carries (ADR 0014): the world and profile a home screen app starts in. */
  carry?: Carry | null;
  /** Puts the carry in the page's address (on iOS, in a browser tab). Defaults to doing nothing. */
  writeCarry?: CarryWriter;
  /** The theme the app was launched with (`?theme=` in the address of an installed app), if any. */
  launchTheme: string | null;
  /** Schedules a delayed call; defaults to `setTimeout`. Tests pass their own. */
  later?: (run: () => void, ms: number) => () => void;
  /** The app's base path, such as `/family-quest/`, where the per-theme manifests and icons are. */
  assetBase: string;
}

const NOTICE_MS = 5000;

/** Starts the interface and returns a function that stops it. */
export async function startApp(options: AppOptions): Promise<() => void> {
  const { root, store, baseUrl, world, clock, randomInt, navigation, installer, assetBase, launchTheme, build, updater } = options;
  const carry = options.carry ?? null;
  const later = options.later ?? ((run, ms) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  });
  let theme = options.theme;
  let themeKnown = false;
  const text = (key: string, params?: Record<string, string | number>) => formatMessage(theme, key, params);

  const uid = await signInWithRetry(root, store, (key) => text(key));

  const notify = (messageKey: string) => {
    const notice = h('div', { class: 'notice', role: 'status' }, text(messageKey));
    document.body.append(notice);
    setTimeout(() => notice.remove(), NOTICE_MS);
  };

  let dispose: Dispose = () => {};

  /** Switches to a bundled theme and makes the page look like it. Returns whether anything changed. */
  function useTheme(themeId: string): boolean {
    if (!hasTheme(themeId)) {
      console.warn(`Unknown theme "${themeId}"; keeping "${theme.id}"`);
      return false;
    }
    const changed = themeId !== theme.id || !themeKnown;
    theme = loadTheme(themeId);
    themeKnown = true;
    applyThemeToPage(document, theme, assetBase, { manifest: !installer.platform.isIos });
    return changed;
  }

  const ctx: AppContext = {
    store,
    get theme() {
      return theme;
    },
    get themeKnown() {
      return themeKnown;
    },
    setTheme(themeId) {
      if (useTheme(themeId)) render();
    },
    installer,
    build,
    updater,
    clock,
    randomInt,
    uid,
    baseUrl,
    world,
    text,
    later,
    notify,
    pushOverlay: (onBack) => navigation.pushOverlay(onBack),
    settle: (settled) => void settled.catch((error: unknown) => reportSettleError(error, notify)),
    go(route, { replace = false } = {}) {
      const hash = hashFor(route);
      if (replace) {
        navigation.replace(hash);
        render();
      } else if (navigation.hash() === hash) {
        render();
      } else {
        navigation.push(hash);
      }
    },
  };

  const needsWorld = (screen: WorldScreen): Screen => (c, r) => {
    const worldId = world.get();
    if (worldId === null) {
      c.go({ name: 'start' }, { replace: true });
      return () => {};
    }
    return screen(c, r, { worldId });
  };

  function screenFor(route: Route): Screen {
    switch (route.name) {
      case 'start':
        return renderStart;
      case 'create':
        return renderCreate;
      case 'join':
        return renderJoin(route.worldId);
      case 'install':
        return needsWorld(renderInstall);
      case 'profiles':
        return needsWorld(renderProfiles);
      case 'map':
        return needsWorld(renderMap);
      case 'board':
        return needsWorld(renderBoard);
      case 'checkin':
        return needsWorld(renderCheckin);
      case 'vault':
        return needsWorld(renderVault);
      case 'home':
        return needsWorld(renderHome);
      case 'showcase':
        return needsWorld(renderShowcase);
      case 'newTask':
        return needsWorld(renderTaskForm(route.defId, route.from));
      case 'people':
        return needsWorld(renderPeople);
      case 'tasks':
        return needsWorld(renderTasks);
      case 'rules':
        return needsWorld(renderRules);
      case 'manage':
        return (c) => {
          c.go({ name: 'map' }, { replace: true }); // the screen is gone; old links land on the map
          return () => {};
        };
      case 'share':
        return needsWorld(renderShare);
    }
  }

  // Recurring tasks are generated for the active profile, whichever screen is showing.
  const generator = createGenerator(ctx);
  // Old pending collectibles go to the reserve when the app opens, whichever screen is showing.
  const keeper = createReserveKeeper(ctx);
  // A browser tab on iOS keeps its address ready to start a home screen app in this world (ADR 0014).
  const carrier = createCarryKeeper(ctx, options.writeCarry ?? (() => {}));

  // The world's own theme is the truth: follow it, and remember it for the next launch.
  let watchedWorld: string | null = null;
  let stopWatchingWorld: Dispose = () => {};
  function followWorldTheme(): void {
    const worldId = world.get();
    if (worldId === watchedWorld) return;
    stopWatchingWorld();
    watchedWorld = worldId;
    if (worldId === null) return;
    stopWatchingWorld = store.worlds.observeWorld(
      worldId,
      (value) => {
        world.setTheme(value.themeId);
        ctx.setTheme(value.themeId);
      },
      () => {}, // not a member (yet): the screens deal with it
    );
  }

  function render(): void {
    dispose();
    root.replaceChildren();
    const route = parseHash(navigation.hash());
    if (route.name === 'join' && route.themeId) useTheme(route.themeId); // a join link is themed before joining
    followWorldTheme();
    generator.follow(world.get());
    keeper.follow(world.get());
    carrier.follow(world.get());
    dispose = screenFor(route)(ctx, root);
  }

  const stopListening = navigation.onChange(render);
  const rememberedTheme = world.getTheme();
  if (launchTheme) useTheme(launchTheme); // an installed app starts with its own theme
  if (world.get() !== null && rememberedTheme) useTheme(rememberedTheme); // the world's theme wins, from the first frame
  await adoptCarry(ctx, carry, options.writeCarry);
  await resumeSession(ctx, navigation);
  void updater.check();
  render();
  return () => {
    stopListening();
    stopWatchingWorld();
    generator.stop();
    keeper.stop();
    carrier.stop();
    dispose();
    root.replaceChildren();
  };
}

/** Signs in; on failure (first launch offline) offers a retry instead of a broken screen. */
async function signInWithRetry(
  root: HTMLElement,
  store: DataStore,
  text: (key: string) => string,
): Promise<string> {
  for (;;) {
    root.replaceChildren(h('p', { role: 'status' }, text('app.loading')));
    try {
      return await store.session.signIn();
    } catch (error) {
      console.error('Sign-in failed', error);
      await new Promise<void>((resolve) => {
        root.replaceChildren(
          h('p', { role: 'alert' }, text('error.signIn')),
          h('button', { class: 'primary', onClick: () => resolve() }, text('app.retry')),
        );
      });
    }
  }
}

/** A device that already belongs to a world skips the start page. */
async function resumeSession(ctx: AppContext, navigation: Navigation): Promise<void> {
  const worldId = ctx.world.get();
  if (worldId === null) return;
  const route = parseHash(navigation.hash());
  // A home screen app starts at the address it was added from, which may be a join link to the world it is already in.
  if (route.name !== 'start' && !(route.name === 'join' && route.worldId === worldId)) return;
  try {
    const membership = await ctx.store.worlds.getMembership(worldId);
    if (membership === null) {
      ctx.world.clear(); // this device is no longer a member of that world
      return;
    }
    navigation.replace(hashFor({ name: membership.profileId ? 'map' : 'profiles' }));
  } catch (error) {
    // Offline with nothing cached: trust the saved world; the screens read from the cache.
    console.warn('Could not check the membership', error);
    navigation.replace(hashFor({ name: 'map' }));
  }
}

/**
 * A home screen app added on an iPhone from a browser tab where the world was already open starts with that world
 * and profile in its address (ADR 0014): it joins and takes the profile by itself, so nobody does it twice. Only a
 * device with no world does this, and only outside an iPhone's browser tab. Any failure leaves the usual start.
 */
async function adoptCarry(ctx: AppContext, carry: Carry | null, write?: CarryWriter): Promise<void> {
  if (!carry) return;
  const { platform } = ctx.installer;
  const inBrowserTab = platform.isIos && !platform.isStandalone;
  if (ctx.world.get() === null && !inBrowserTab) {
    try {
      await ctx.store.worlds.joinWorld(carry.worldId);
      await ctx.store.worlds.chooseProfile(carry.worldId, carry.profileId).settled;
      ctx.world.set(carry.worldId);
    } catch (error) {
      console.warn('Could not start in the carried world', error);
    }
  }
  if (!inBrowserTab) write?.(null); // the address goes back to what it was
}
