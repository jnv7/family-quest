import type { Build } from '../core/build';
import type { Clock, RandomInt, Uid, WorldId } from '../core/model';
import { DataStoreError, type DataStore } from '../data/DataStore';
import type { MessageParams, Theme } from '../theme';
import type { Installer } from './install';
import type { Navigation } from './navigation';
import type { Route } from './routes';
import type { WorldMemory } from './worldMemory';

/** Stops a screen's observers and listeners. */
export type Dispose = () => void;

export interface AppContext {
  store: DataStore;
  /** The current theme. It changes when the theme becomes known (see `setTheme`). */
  readonly theme: Theme;
  /**
   * True once the theme comes from somewhere reliable: a join link, the choice made
   * when creating a world, or the world itself. The app offers to install itself
   * only then, never from the bare address (ADR 0005).
   */
  readonly themeKnown: boolean;
  /** Uses another theme, makes the page look like it, and redraws the current screen. */
  setTheme(themeId: string): void;
  installer: Installer;
  /** The running build, for the version in the menu. */
  build: Build;
  clock: Clock;
  randomInt: RandomInt;
  /** The signed-in device. */
  uid: Uid;
  /** The app's own URL without the hash, used to build join links. */
  baseUrl: string;
  world: WorldMemory;
  /** Interface text: a neutral message filled with the theme's names. */
  text(key: string, params?: MessageParams): string;
  /** Adds a history entry for an overlay (see `Navigation.pushOverlay`). */
  pushOverlay: Navigation['pushOverlay'];
  go(route: Route, options?: { replace?: boolean }): void;
  /** Runs `run` after `ms`; the returned function cancels it. Injected so tests control time. */
  later(run: () => void, ms: number): () => void;
  /** Shows a short, non-blocking notice. */
  notify(messageKey: string): void;
  /**
   * Handles the server's late verdict on a write (docs/architecture.md §2).
   * The screen never waits for it; the observers already show the true state.
   */
  settle(settled: Promise<unknown>): void;
}

/** Screens that need a world get it from the router, which has checked it exists. */
export type WorldScreen = (ctx: AppContext, root: HTMLElement, params: { worldId: WorldId }) => Dispose;
export type Screen = (ctx: AppContext, root: HTMLElement) => Dispose;

/** What to do with a rejected write, by error code (docs/architecture.md §2). */
export function reportSettleError(error: unknown, notify: (messageKey: string) => void): void {
  const code = error instanceof DataStoreError ? error.code : 'unknown';
  if (code === 'already-exists') return; // another device got there first
  if (code === 'permission-denied') {
    console.warn('Write refused; the screen already shows the server state', error);
    return;
  }
  console.error('Write failed', error);
  if (code === 'unavailable' || code === 'unknown') notify('notice.connection');
}
