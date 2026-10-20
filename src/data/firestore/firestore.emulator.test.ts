/**
 * Runs the DataStore contract against the Firestore and Auth emulators.
 * Run with `npm run test:emulator` (needs Java; CI runs it).
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, doc, setDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRandomInt } from '../../core/random';
import { EMULATOR_PROJECT_ID } from './config';
import { runDataStoreContract } from '../datastore.contract';
import { createFirebaseServices, createFirestoreStore, type FirebaseServices } from './index';

const services: FirebaseServices[] = [];
let counter = 0;

const randomInt = createRandomInt((array) => crypto.getRandomValues(array));

/** A device: its own Firebase app, so its own anonymous user and its own cache. */
async function connect(clock: () => number) {
  const device = createFirebaseServices({ name: `device-${counter++}`, emulator: true, persistent: false });
  services.push(device);
  const store = createFirestoreStore({ firestore: device.firestore, auth: device.auth, clock, randomInt });
  await store.session.signIn();
  return { store, device };
}

afterAll(async () => {
  await Promise.all(services.map((s) => s.dispose()));
});

runDataStoreContract('firestore', async ({ clock }) => ({
  admin: (await connect(clock)).store,
  child: (await connect(clock)).store,
  child2: (await connect(clock)).store,
  newcomer: (await connect(clock)).store,
}));

describe('documents with an unknown schemaVersion', () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: EMULATOR_PROJECT_ID,
      firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8') },
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('are skipped and reported, and the observer keeps working', async () => {
    const { store } = await connect(() => Date.now());
    const created = store.worlds.createWorld({ name: 'Home', themeId: 'minimal', creatorDisplayName: 'Alex' });
    await created.settled;
    const { worldId, profileId } = created.result;

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'worlds', worldId, 'profiles', 'from-the-future'), {
        displayName: 'Future',
        kind: 'child',
        avatar: {},
        partyIds: [],
        archived: false,
        schemaVersion: 99,
        createdAt: Timestamp.now(),
      });
    });

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const emissions: string[][] = [];
    const stop = store.worlds.observeProfiles(worldId, (profiles) => emissions.push(profiles.map((p) => p.id)));

    await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));
    stop();

    expect(emissions.at(-1)).toEqual([profileId]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('profiles/from-the-future'));
    errors.mockRestore();
  });

  it('reads a profile written before symbols existed with a null symbol', async () => {
    const { store } = await connect(() => Date.now());
    const created = store.worlds.createWorld({ name: 'Home', themeId: 'minimal', creatorDisplayName: 'Alex' });
    await created.settled;
    const { worldId } = created.result;
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore() as unknown as Firestore;
      await setDoc(doc(db, 'worlds', worldId, 'profiles', 'legacy'), {
        displayName: 'Old',
        kind: 'child',
        avatar: { body: 0, hair: 0, outfit: 0, accessory: 0 },
        partyIds: [],
        archived: false,
        schemaVersion: 1,
        createdAt: Timestamp.now(),
      });
    });
    const seen: Array<string | null | undefined> = [];
    const stop = store.worlds.observeProfiles(worldId, (profiles) => seen.push(profiles.find((p) => p.id === 'legacy')?.avatar.symbol));
    await vi.waitFor(() => expect(seen.at(-1)).toBeNull());
    stop();
  });
});
