/** Router and boot of the interface (docs/architecture.md §9). Screens render only from observers. */
import type { Clock } from '../core/model';
import type { DataStore } from '../data/DataStore';
import type { Theme } from '../theme';
import { formatMessage } from '../theme';
import { reportSettleError, type AppContext, type Dispose, type Screen, type WorldScreen } from './context';
import { h } from './dom';
import type { Navigation } from './navigation';
import { hashFor, parseHash, type Route } from './routes';
import { renderCreate } from './screens/create';
import { renderBoard } from './screens/board';
import { renderJoin } from './screens/join';
import { renderManage } from './screens/manage';
import { renderMap } from './screens/map';
import { renderNewTask } from './screens/newTask';
import { renderProfiles } from './screens/profiles';
import { renderShare } from './screens/share';
import { renderStart } from './screens/start';
import type { WorldMemory } from './worldMemory';

export interface AppOptions {
  root: HTMLElement;
  store: DataStore;
  theme: Theme;
  /** The app's URL without the hash. */
  baseUrl: string;
  world: WorldMemory;
  clock: Clock;
  navigation: Navigation;
}

const NOTICE_MS = 5000;

/** Starts the interface and returns a function that stops it. */
export async function startApp(options: AppOptions): Promise<() => void> {
  const { root, store, theme, baseUrl, world, clock, navigation } = options;
  const text = (key: string, params?: Record<string, string | number>) => formatMessage(theme, key, params);

  const uid = await signInWithRetry(root, store, text);

  const notify = (messageKey: string) => {
    const notice = h('div', { class: 'notice', role: 'status' }, text(messageKey));
    document.body.append(notice);
    setTimeout(() => notice.remove(), NOTICE_MS);
  };

  let dispose: Dispose = () => {};

  const ctx: AppContext = {
    store,
    theme,
    clock,
    uid,
    baseUrl,
    world,
    text,
    notify,
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
      case 'profiles':
        return needsWorld(renderProfiles);
      case 'map':
        return needsWorld(renderMap);
      case 'board':
        return needsWorld(renderBoard);
      case 'newTask':
        return needsWorld(renderNewTask);
      case 'manage':
        return needsWorld(renderManage);
      case 'share':
        return needsWorld(renderShare);
    }
  }

  function render(): void {
    dispose();
    root.replaceChildren();
    dispose = screenFor(parseHash(navigation.hash()))(ctx, root);
  }

  const stopListening = navigation.onChange(render);
  await resumeSession(ctx, navigation);
  render();
  return () => {
    stopListening();
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
  if (worldId === null || parseHash(navigation.hash()).name !== 'start') return;
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
