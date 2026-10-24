import type { Millis, ProfileId, WorldId } from '../core/model';

export interface WorldMemory {
  get(): WorldId | null;
  set(worldId: WorldId): void;
  /** The world's theme id, remembered so the next launch looks right before anything loads. */
  getTheme(): string | null;
  setTheme(themeId: string): void;
  /**
   * When the profile last opened its task list on this device (a viewer convenience, never shared),
   * or null before the first time.
   */
  getLastSeen(worldId: WorldId, profileId: ProfileId): Millis | null;
  setLastSeen(worldId: WorldId, profileId: ProfileId, at: Millis): void;
  /** Whether "Como jogar" already opened by itself for this profile on this device. */
  hasSeenHowTo(worldId: WorldId, profileId: ProfileId): boolean;
  /**
   * Remembers that it did. Returns false when storage cannot be written, so the caller does not open it by
   * itself: a private window is not nagged on every start.
   */
  setSeenHowTo(worldId: WorldId, profileId: ProfileId): boolean;
  /** Forgets the world and its theme. */
  clear(): void;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'familyQuest.worldId';
const THEME_KEY = 'familyQuest.themeId';
const howToKey = (worldId: WorldId, profileId: ProfileId) => `fq.howToSeen.${worldId}.${profileId}`;
const lastSeenKey = (worldId: WorldId, profileId: ProfileId) => `fq.lastSeen.${worldId}.${profileId}`;

/**
 * Remembers which world this device is in (several worlds per device are out of
 * scope, SPEC.md §14). Storage can be missing or throw, for example in a private
 * window; the id is then kept in memory for the life of the page.
 */
export function createWorldMemory(storage: StorageLike | null): WorldMemory {
  let current: WorldId | null = null;
  let theme: string | null = null;
  /** Last-seen times kept in memory too, for storage that cannot be written. */
  const lastSeen = new Map<string, Millis>();
  const seenHowTo = new Set<string>();
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
    getLastSeen(worldId, profileId) {
      const key = lastSeenKey(worldId, profileId);
      if (lastSeen.has(key)) return lastSeen.get(key)!;
      try {
        const value = Number(storage?.getItem(key));
        return storage?.getItem(key) != null && Number.isFinite(value) ? value : null;
      } catch {
        return null;
      }
    },
    setLastSeen(worldId, profileId, at) {
      const key = lastSeenKey(worldId, profileId);
      lastSeen.set(key, at);
      persist((s) => s.setItem(key, String(at)));
    },
    hasSeenHowTo(worldId, profileId) {
      const key = howToKey(worldId, profileId);
      if (seenHowTo.has(key)) return true;
      try {
        return storage?.getItem(key) != null;
      } catch {
        return false;
      }
    },
    setSeenHowTo(worldId, profileId) {
      const key = howToKey(worldId, profileId);
      seenHowTo.add(key);
      try {
        if (!storage) return false;
        storage.setItem(key, '1');
        return true;
      } catch {
        return false;
      }
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
