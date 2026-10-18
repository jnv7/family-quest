/** The only place that picks an adapter and wires the app together (docs/architecture.md §1). */
import './style.css';
import { createRandomInt } from './core/random';
import type { DataStore } from './data/DataStore';
import { formatMessage, loadTheme } from './theme';
import { startApp } from './ui/app';
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
document.title = formatMessage(theme, 'app.name');

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

void startApp({
  root,
  store: await createStore(),
  theme,
  baseUrl: `${location.origin}${location.pathname}`,
  world: createWorldMemory(localStorageOrNull()),
  clock: Date.now,
  navigation: browserNavigation(),
});
