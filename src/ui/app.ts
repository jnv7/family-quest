/** Router and boot of the interface (docs/architecture.md §9). Screens render only from observers. */
import type { DataStore } from '../data/DataStore';
import type { Theme } from '../theme';
import { formatMessage } from '../theme';
import { reportSettleError, type AppContext, type Dispose, type Screen, type WorldScreen } from './context';
import { h } from './dom';
import { hashFor, parseHash, type Route } from './routes';
import { renderCreate } from './screens/create';
import { renderHome } from './screens/home';
import { renderJoin } from './screens/join';
import { renderManage } from './screens/manage';
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
}

const NOTICE_MS = 5000;

/** Starts the interface and returns a function that stops it. */
export async function startApp(options: AppOptions): Promise<() => void> {
  const { root, store, theme, baseUrl, world } = options;
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
    uid,
    baseUrl,
    world,
    text,
    notify,
    settle: (settled) => void settled.catch((error: unknown) => reportSettleError(error, notify)),
    go(route, { replace = false } = {}) {
      const hash = hashFor(route);
      if (replace) {
        history.replaceState(null, '', hash);
        render();
      } else if (location.hash === hash) {
        render();
      } else {
        location.hash = hash;
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
      case 'home':
        return needsWorld(renderHome);
      case 'manage':
        return needsWorld(renderManage);
      case 'share':
        return needsWorld(renderShare);
    }
  }

  function render(): void {
    dispose();
    root.replaceChildren();
    dispose = screenFor(parseHash(location.hash))(ctx, root);
  }

  window.addEventListener('hashchange', render);
  await resumeSession(ctx);
  render();
  return () => {
    window.removeEventListener('hashchange', render);
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
async function resumeSession(ctx: AppContext): Promise<void> {
  const worldId = ctx.world.get();
  if (worldId === null || parseHash(location.hash).name !== 'start') return;
  try {
    const membership = await ctx.store.worlds.getMembership(worldId);
    if (membership === null) {
      ctx.world.clear(); // this device is no longer a member of that world
      return;
    }
    history.replaceState(null, '', hashFor({ name: membership.profileId ? 'home' : 'profiles' }));
  } catch (error) {
    // Offline with nothing cached: trust the saved world; the screens read from the cache.
    console.warn('Could not check the membership', error);
    history.replaceState(null, '', hashFor({ name: 'home' }));
  }
}
