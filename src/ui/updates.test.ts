import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Build } from '../core/build';
import { createUpdater, type UpdaterWindow } from './updates';

const running: Build = { version: '0.10.5', builtAt: 1_000, commit: 'aaaaaaa' };

function fakeWindow(options: { fetch?: (url: string, init: RequestInit) => Promise<Response>; worker?: boolean; failing?: boolean; href?: string } = {}) {
  const replace = vi.fn();
  const fetch = vi.fn(options.fetch ?? (async () => new Response(JSON.stringify({ ...running, builtAt: 2_000 }))));
  const unregister = vi.fn(async () => {
    if (options.failing) throw new Error('refused');
    return true;
  });
  const deleted: string[] = [];
  const serviceWorker = options.worker ? { getRegistrations: async () => [{ unregister }] } : undefined;
  const caches = options.worker
    ? {
        keys: async () => {
          if (options.failing) throw new Error('refused');
          return ['workbox-precache', 'runtime'];
        },
        delete: async (name: string) => (deleted.push(name), true),
      }
    : undefined;
  const win = { fetch, location: { href: options.href ?? 'https://example.org/family-quest/#/map', replace }, navigator: { serviceWorker }, caches } as unknown as UpdaterWindow;
  return { win, fetch, replace, unregister, deleted };
}

const respond = (build: unknown) => async () => new Response(JSON.stringify(build));

let clock = 100_000;
const now = () => clock;
beforeEach(() => (clock = 100_000));
afterEach(() => vi.useRealTimers());

describe('the updater', () => {
  it('finds a newer build, reading version.json without any cache', async () => {
    const { win, fetch } = fakeWindow();
    const updater = createUpdater(win, '/family-quest/', running, now);
    const changes = vi.fn();
    updater.onChange(changes);
    await updater.check();
    expect(updater.available()).toBe(true);
    expect(changes).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`/family-quest/version.json?t=${clock}`);
    expect(init.cache).toBe('no-store');
  });

  it('finds nothing for the same build, and nothing for an older one', async () => {
    for (const builtAt of [1_000, 500]) {
      const { win } = fakeWindow({ fetch: respond({ ...running, builtAt }) });
      const updater = createUpdater(win, '/', running, now);
      await updater.check();
      expect(updater.available()).toBe(false);
    }
  });

  it('is silent when offline, on a bad response and on broken JSON', async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => Promise.reject(new TypeError('Failed to fetch')),
      async () => new Response('nope', { status: 404 }),
      async () => new Response('{ not json'),
      respond({ builtAt: 'yesterday' }),
    ];
    for (const fetch of cases) {
      const { win } = fakeWindow({ fetch });
      const updater = createUpdater(win, '/', running, now);
      await expect(updater.check()).resolves.toBeUndefined();
      expect(updater.available()).toBe(false);
    }
  });

  it('gives up after 5 seconds', async () => {
    vi.useFakeTimers();
    const { win } = fakeWindow({ fetch: (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))) });
    const updater = createUpdater(win, '/', running, now);
    const done = updater.check();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(done).resolves.toBeUndefined();
    expect(updater.available()).toBe(false);
  });

  it('checks at most once a minute, and tries again after an offline failure', async () => {
    const { win, fetch } = fakeWindow({ fetch: async () => Promise.reject(new TypeError('offline')) });
    const updater = createUpdater(win, '/', running, now);
    await updater.check();
    await updater.check();
    expect(fetch).toHaveBeenCalledTimes(1);
    clock += 60_000;
    await updater.check();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('removes the worker and its caches, then loads the page again under a new address, keeping the hash and the theme', async () => {
    const { win, replace, unregister, deleted } = fakeWindow({ worker: true, href: 'https://example.org/family-quest/?theme=minimal#/map' });
    await createUpdater(win, '/', running, now).apply();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual(['workbox-precache', 'runtime']);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0]![0]).toBe(`https://example.org/family-quest/?theme=minimal&v=${clock}#/map`);
  });

  it('still loads the page again when there is no worker and no caches, or when removing them fails', async () => {
    const plain = fakeWindow();
    await createUpdater(plain.win, '/', running, now).apply();
    expect(plain.replace).toHaveBeenCalledTimes(1);

    const broken = fakeWindow({ worker: true, failing: true });
    await createUpdater(broken.win, '/', running, now).apply();
    expect(broken.replace).toHaveBeenCalledTimes(1);
  });
});
