import { createRandomInt } from '../../core/random';
import { runDataStoreContract } from '../datastore.contract';
import { createMemoryBackend, createMemoryStore, type MemoryDataStore } from './index';

runDataStoreContract('memory', async ({ clock }) => {
  const backend = createMemoryBackend();
  const randomInt = createRandomInt((array) => crypto.getRandomValues(array));
  const connect = async (uid: string) => {
    const store = createMemoryStore(backend, { uid, clock, randomInt });
    await store.session.signIn();
    return store;
  };
  return {
    admin: await connect('device-admin'),
    child: await connect('device-child'),
    child2: await connect('device-child-2'),
    newcomer: await connect('device-newcomer'),
    setOnline: (device, online) => (device as MemoryDataStore).setOnline(online),
    seedLegacyReward: ({ worldId, id, ...reward }) => {
      // Committed like any write, so the devices' observers hear of it.
      backend.commit({ ops: [{ worldId, collection: 'rewards', id, create: { schemaVersion: 1, id, openedAt: null, ...reward } }], check: () => null });
    },
  };
});
