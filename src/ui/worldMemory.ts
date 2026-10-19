import type { WorldId } from '../core/model';

export interface WorldMemory {
  get(): WorldId | null;
  set(worldId: WorldId): void;
  /** The world's theme id, remembered so the next launch looks right before anything loads. */
  getTheme(): string | null;
  setTheme(themeId: string): void;
  /** Forgets the world and its theme. */
  clear(): void;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'familyQuest.worldId';
const THEME_KEY = 'familyQuest.themeId';

/**
 * Remembers which world this device is in (several worlds per device are out of
 * scope, SPEC.md §14). Storage can be missing or throw, for example in a private
 * window; the id is then kept in memory for the life of the page.
 */
export function createWorldMemory(storage: StorageLike | null): WorldMemory {
  let current: WorldId | null = null;
  let theme: string | null = null;
  try {
    current = storage?.getItem(KEY) ?? null;
    theme = storage?.getItem(THEME_KEY) ?? null;
  } catch {
    // Unreadable storage: start empty.
  }
  const persist = (action: (s: StorageLike) => void) => {
    try {
      if (storage) action(storage);
    } catch {
      // Unwritable storage: the in-memory value still works.
    }
  };
  return {
    get: () => current,
    set(worldId) {
      current = worldId;
      persist((s) => s.setItem(KEY, worldId));
    },
    getTheme: () => theme,
    setTheme(themeId) {
      theme = themeId;
      persist((s) => s.setItem(THEME_KEY, themeId));
    },
    clear() {
      current = null;
      theme = null;
      persist((s) => {
        s.removeItem(KEY);
        s.removeItem(THEME_KEY);
      });
    },
  };
}
