/** Showing the version and loading a newer one (ADR 0012). */
import { isNewerBuild, type Build } from '../core/build';

export interface Updater {
  /** Looks for a newer build. Never throws, and does nothing more than once a minute. */
  check(): Promise<void>;
  /** Whether the last check found a newer build. */
  available(): boolean;
  /** Loads the newer build: updates the service worker if there is one, then reloads. */
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
const WORKER_WAIT_MS = 10_000;

/** What of a window the updater uses, so tests pass a fake. */
export type UpdaterWindow = Pick<Window, 'fetch' | 'navigator' | 'location'>;

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
      const container = win.navigator.serviceWorker;
      try {
        const registration = await container?.getRegistration();
        if (registration) {
          const taken = new Promise<void>((resolve) => container.addEventListener('controllerchange', () => resolve(), { once: true }));
          await registration.update();
          if (registration.installing || registration.waiting) {
            await Promise.race([taken, new Promise<void>((resolve) => setTimeout(resolve, WORKER_WAIT_MS))]);
          }
        }
      } catch {
        // Without the worker's help it still reloads: the network serves the new files.
      }
      win.location.reload();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
