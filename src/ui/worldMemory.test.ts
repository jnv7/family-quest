import { describe, expect, it } from 'vitest';
import { createWorldMemory } from './worldMemory';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('createWorldMemory', () => {
  it('stores, reads back and clears the world id', () => {
    const storage = fakeStorage();
    const memory = createWorldMemory(storage);
    expect(memory.get()).toBeNull();
    memory.set('abc');
    expect(createWorldMemory(storage).get()).toBe('abc');
    memory.clear();
    expect(createWorldMemory(storage).get()).toBeNull();
  });

  it('remembers the theme with the world, and forgets both together', () => {
    const storage = fakeStorage();
    const memory = createWorldMemory(storage);
    memory.set('abc');
    memory.setTheme('minimal-farm');
    expect(createWorldMemory(storage).getTheme()).toBe('minimal-farm');
    memory.clear();
    expect(createWorldMemory(storage).getTheme()).toBeNull();
  });

  it('keeps working in memory when storage is missing or throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    for (const storage of [null, broken]) {
      const memory = createWorldMemory(storage);
      expect(memory.get()).toBeNull();
      memory.set('abc');
      expect(memory.get()).toBe('abc');
      memory.clear();
      expect(memory.get()).toBeNull();
    }
  });

  it('remembers when a profile last saw its list, per world and profile, even without writable storage', () => {
    const storage = fakeStorage();
    const memory = createWorldMemory(storage);
    expect(memory.getLastSeen('w', 'p')).toBeNull();
    memory.setLastSeen('w', 'p', 1234);
    expect(createWorldMemory(storage).getLastSeen('w', 'p')).toBe(1234);
    expect(createWorldMemory(storage).getLastSeen('w', 'q')).toBeNull();
    expect(createWorldMemory(storage).getLastSeen('x', 'p')).toBeNull();

    const broken = createWorldMemory({ getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => {} });
    broken.setLastSeen('w', 'p', 99);
    expect(broken.getLastSeen('w', 'p')).toBe(99);
  });

  it('remembers per world and profile that "Como jogar" opened, and says when it cannot be written', () => {
    const storage = fakeStorage();
    const memory = createWorldMemory(storage);
    expect(memory.hasSeenHowTo('w', 'a')).toBe(false);
    expect(memory.setSeenHowTo('w', 'a')).toBe(true);
    expect(memory.hasSeenHowTo('w', 'a')).toBe(true);
    expect(memory.hasSeenHowTo('w', 'b')).toBe(false);
    expect(createWorldMemory(storage).hasSeenHowTo('w', 'a')).toBe(true);
    expect(storage.data.has('fq.howToSeen.w.a')).toBe(true);

    const blocked = createWorldMemory({ getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => {} });
    expect(blocked.setSeenHowTo('w', 'a')).toBe(false);
    expect(blocked.hasSeenHowTo('w', 'a')).toBe(true); // not twice in one session either
    expect(createWorldMemory(null).setSeenHowTo('w', 'a')).toBe(false);
  });

  it('fixes a device on a profile of a world, keeps it across launches, and lifts it', () => {
    const storage = fakeStorage();
    const memory = createWorldMemory(storage);
    expect(memory.getLockedProfile('w')).toBeNull();
    memory.lockProfile('w', 'kid');
    expect(memory.getLockedProfile('w')).toBe('kid');
    expect(memory.getLockedProfile('other')).toBeNull();
    expect(createWorldMemory(storage).getLockedProfile('w')).toBe('kid');
    memory.unlockProfile('w');
    expect(memory.getLockedProfile('w')).toBeNull();
    expect(createWorldMemory(storage).getLockedProfile('w')).toBeNull();
  });

  it('takes the lock away with the world it leaves, and works when storage cannot be written', () => {
    const storage = fakeStorage();
    const memory = createWorldMemory(storage);
    memory.set('w');
    memory.lockProfile('w', 'kid');
    memory.clear();
    expect(createWorldMemory(storage).getLockedProfile('w')).toBeNull();

    const blocked = createWorldMemory({ getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('full'); } });
    blocked.lockProfile('w', 'kid');
    expect(blocked.getLockedProfile('w')).toBe('kid');
    blocked.unlockProfile('w');
    expect(blocked.getLockedProfile('w')).toBeNull();
  });
});
