import { createRandomInt } from '../../core/random';
import { runDataStoreContract } from '../datastore.contract';
import { createMemoryBackend, createMemoryStore } from './index';

runDataStoreContract('memory', async ({ clock, profileSymbols }) => {
  const backend = createMemoryBackend();
  const randomInt = createRandomInt((array) => crypto.getRandomValues(array));
  const connect = async (uid: string) => {
    const store = createMemoryStore(backend, { uid, clock, randomInt, profileSymbols });
    await store.session.signIn();
    return store;
  };
  return {
    admin: await connect('device-admin'),
    child: await connect('device-child'),
    child2: await connect('device-child-2'),
    newcomer: await connect('device-newcomer'),
  };
});
