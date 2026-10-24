import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Build } from '../core/build';
import { createUpdater, type UpdaterWindow } from './updates';

const running: Build = { version: '0.10.5', builtAt: 1_000, commit: 'aaaaaaa' };

function fakeWindow(options: { fetch?: (url: string, init: RequestInit) => Promise<Response>; worker?: boolean } = {}) {
  const reload = vi.fn();
  const fetch = vi.fn(options.fetch ?? (async () => new Response(JSON.stringify({ ...running, builtAt: 2_000 }))));
  let controllerChange: (() => void) | null = null;
  const registration = { installing: {}, waiting: null, update: vi.fn(async () => {}) };
  const serviceWorker = options.worker
    ? { getRegistration: async () => registration, addEventListener: (_: string, listener: () => void) => (controllerChange = listener) }
    : undefined;
  const win = { fetch, location: { reload }, navigator: { serviceWorker } } as unknown as UpdaterWindow;
  return { win, fetch, reload, registration, takeOver: () => controllerChange?.() };
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

  it('only reloads when there is no service worker', async () => {
    const { win, reload } = fakeWindow();
    await createUpdater(win, '/', running, now).apply();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('updates the worker, waits for it to take over, then reloads', async () => {
    const { win, reload, registration, takeOver } = fakeWindow({ worker: true });
    const done = createUpdater(win, '/', running, now).apply();
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
    takeOver();
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads after 10 seconds even if the worker never takes over', async () => {
    vi.useFakeTimers();
    const { win, reload } = fakeWindow({ worker: true });
    const done = createUpdater(win, '/', running, now).apply();
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
