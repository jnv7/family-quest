import type { Uid, WorldId } from '../core/model';
import { DataStoreError, type DataStore } from '../data/DataStore';
import type { MessageParams, Theme } from '../theme';
import type { Route } from './routes';
import type { WorldMemory } from './worldMemory';

/** Stops a screen's observers and listeners. */
export type Dispose = () => void;

export interface AppContext {
  store: DataStore;
  theme: Theme;
  /** The signed-in device. */
  uid: Uid;
  /** The app's own URL without the hash, used to build join links. */
  baseUrl: string;
  world: WorldMemory;
  /** Interface text: a neutral message filled with the theme's names. */
  text(key: string, params?: MessageParams): string;
  go(route: Route, options?: { replace?: boolean }): void;
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
