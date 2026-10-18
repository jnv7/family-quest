import { describe, expect, it, vi } from 'vitest';

const persistent = { kind: 'persistent' };
const tabManager = { kind: 'multi-tab' };

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  initializeFirestore: vi.fn(() => ({})),
  persistentLocalCache: vi.fn(() => persistent),
  persistentMultipleTabManager: vi.fn(() => tabManager),
}));

import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import { createFirebaseServices } from './app';

describe('createFirebaseServices', () => {
  it('keeps the data in a persistent cache shared by several tabs', async () => {
    const services = createFirebaseServices({ name: 'persistence-check' });

    expect(persistentLocalCache).toHaveBeenCalledWith({ tabManager });
    expect(initializeFirestore).toHaveBeenCalledWith(expect.anything(), { localCache: persistent });
    await services.dispose();
  });
});
