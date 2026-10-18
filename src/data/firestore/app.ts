/** Creates the Firebase services the store needs. Only `src/main.ts` calls this (docs/architecture.md §1). */
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { EMULATOR_PORTS, EMULATOR_PROJECT_ID, firebaseConfig } from './config';

export interface FirebaseServicesOptions {
  /** Distinguishes several apps in one process (tests). */
  name?: string;
  /** Use the local emulators and the emulator project id. */
  emulator?: boolean;
  /** Keep the data cache in IndexedDB. Needs a browser; tests turn it off. Default true. */
  persistent?: boolean;
}

export interface FirebaseServices {
  firestore: Firestore;
  auth: Auth;
  dispose(): Promise<void>;
}

export function createFirebaseServices(options: FirebaseServicesOptions = {}): FirebaseServices {
  const { name, emulator = false, persistent = true } = options;
  const app: FirebaseApp = initializeApp(
    emulator ? { ...firebaseConfig, projectId: EMULATOR_PROJECT_ID, apiKey: 'fake-api-key' } : firebaseConfig,
    name,
  );
  const firestore = initializeFirestore(app, {
    localCache: persistent
      ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      : memoryLocalCache(),
  });
  const auth = getAuth(app);
  if (emulator) {
    connectFirestoreEmulator(firestore, '127.0.0.1', EMULATOR_PORTS.firestore);
    connectAuthEmulator(auth, `http://127.0.0.1:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
  }
  return { firestore, auth, dispose: () => deleteApp(app) };
}
