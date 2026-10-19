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
});
