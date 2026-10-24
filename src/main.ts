/** The only place that picks an adapter and wires the app together (docs/architecture.md §1). */
import './style.css';
import { createRandomInt } from './core/random';
import type { DataStore } from './data/DataStore';
import { loadTheme } from './theme';
import { startApp } from './ui/app';
import { createInstaller } from './ui/install';
import { createUpdater, noUpdater, RELOAD_PARAM } from './ui/updates';
import { browserNavigation } from './ui/navigation';
import { createWorldMemory } from './ui/worldMemory';

/** Only one theme exists for now; later releases read the theme from the world. */
const DEFAULT_THEME_ID = 'minimal';

/** `VITE_DATA=memory` runs without Firebase; `VITE_DATA=emulator` uses the local emulators. */
async function createStore(): Promise<DataStore> {
  const mode = import.meta.env.VITE_DATA as string | undefined;
  const clock = Date.now;
  const randomInt = createRandomInt((array) => crypto.getRandomValues(array));

  if (mode === 'memory') {
    const { createMemoryBackend, createMemoryStore } = await import('./data/memory');
    return createMemoryStore(createMemoryBackend(), { uid: 'dev-device', clock, randomInt });
  }
  const { createFirebaseServices, createFirestoreStore } = await import('./data/firestore');
  const services = createFirebaseServices({ emulator: mode === 'emulator', persistent: mode !== 'emulator' });
  return createFirestoreStore({ firestore: services.firestore, auth: services.auth, clock, randomInt });
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const theme = loadTheme(DEFAULT_THEME_ID);

// "Atualizar" loads the page under a new address (`?v=`); once it is loaded, the address goes back to what it was.
const reloaded = new URL(location.href);
if (reloaded.searchParams.has(RELOAD_PARAM)) {
  reloaded.searchParams.delete(RELOAD_PARAM);
  history.replaceState(null, '', reloaded.toString());
}

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

void startApp({
  root,
  store: await createStore(),
  theme,
  baseUrl: `${location.origin}${location.pathname}`,
  world: createWorldMemory(localStorageOrNull()),
  clock: Date.now,
  randomInt: createRandomInt((array) => crypto.getRandomValues(array)),
  navigation: browserNavigation(),
  installer: createInstaller(window),
  build: __APP_BUILD__,
  // In `vite dev` there is no version.json to compare with.
  updater: import.meta.env.DEV ? noUpdater : createUpdater(window, import.meta.env.BASE_URL, __APP_BUILD__),
  launchTheme: new URLSearchParams(location.search).get('theme'),
  assetBase: import.meta.env.BASE_URL,
});
