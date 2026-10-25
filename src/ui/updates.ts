/** Showing the version and loading a newer one (ADR 0012). */
import { isNewerBuild, type Build } from '../core/build';

export interface Updater {
  /** Looks for a newer build. Never throws, and does nothing more than once a minute. */
  check(): Promise<void>;
  /** Whether the last check found a newer build. */
  available(): boolean;
  /** Loads the newer build: clears the service worker and its caches, then loads the page again from the network. */
  apply(): Promise<void>;
  onChange(listener: () => void): () => void;
}

/** An updater that never finds anything: for `vite dev` and for tests that do not care. */
export const noUpdater: Updater = {
  check: async () => {},
  available: () => false,
  apply: async () => {},
  onChange: () => () => {},
};

const MIN_GAP_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;
/** The query parameter that makes the address new, so no cache in between can answer for the old page. */
export const RELOAD_PARAM = 'v';

/** What of a window the updater uses, so tests pass a fake. */
export type UpdaterWindow = Pick<Window, 'fetch' | 'navigator' | 'location' | 'caches'>;

export function createUpdater(win: UpdaterWindow, assetBase: string, running: Build, now: () => number = Date.now): Updater {
  const listeners = new Set<() => void>();
  let found = false;
  let lastCheck = Number.NEGATIVE_INFINITY;
  const changed = () => listeners.forEach((listener) => listener());

  return {
    async check() {
      if (now() - lastCheck < MIN_GAP_MS) return;
      lastCheck = now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        // `no-store` skips the browser cache; `?t=` skips the cache in front of GitHub Pages.
        const response = await win.fetch(`${assetBase}version.json?t=${now()}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const published = (await response.json()) as Partial<Build>;
        if (typeof published.builtAt !== 'number' || typeof published.version !== 'string') return;
        const next = isNewerBuild(running, published as Build);
        if (next !== found) {
          found = next;
          changed();
        }
      } catch {
        // Offline, a timeout, a bad response or broken JSON: silent. The next check tries again.
      } finally {
        clearTimeout(timer);
      }
    },
    available: () => found,
    async apply() {
      // Throw away what the old worker cached and the worker itself, then load the page again from the network
      // under a new address. Asking the worker to update is not enough: GitHub Pages may still serve the old
      // `sw.js` and `index.html` for a few minutes after a deploy, and the page would come back as it was.
      try {
        const registrations = (await win.navigator.serviceWorker?.getRegistrations()) ?? [];
        await Promise.all(registrations.map((registration) => registration.unregister()));
      } catch {
        // No worker to remove, or it cannot be: the page still loads from the network below.
      }
      try {
        const names = (await win.caches?.keys()) ?? [];
        await Promise.all(names.map((name) => win.caches.delete(name)));
      } catch {
        // Caches may be unavailable (a private window): nothing to clear.
      }
      const next = new URL(win.location.href);
      next.searchParams.set(RELOAD_PARAM, String(now()));
      win.location.replace(next.toString());
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
