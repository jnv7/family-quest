import { describe, expect, it } from 'vitest';
import { createRandomInt, randomWorldId } from './random';

describe('createRandomInt', () => {
  it('skips values in the rejected zone instead of using modulo', () => {
    const script = [0xffffffff, 4];
    let calls = 0;
    const randomInt = createRandomInt((array) => {
      array[0] = script[calls++]!;
    });
    expect(randomInt(3)).toBe(1);
    expect(calls).toBe(2);
  });

  it('accepts any value when maxExclusive is 2^32', () => {
    const randomInt = createRandomInt((array) => {
      array[0] = 0xffffffff;
    });
    expect(randomInt(2 ** 32)).toBe(0xffffffff);
  });

  it('returns 0 when maxExclusive is 1', () => {
    expect(createRandomInt((array) => (array[0] = 123))(1)).toBe(0);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 2 ** 32 + 1])('throws RangeError for %s', (bad) => {
    const randomInt = createRandomInt(() => {
      throw new Error('must not draw');
    });
    expect(() => randomInt(bad)).toThrow(RangeError);
  });

  it('is evenly distributed with the real crypto source', () => {
    const randomInt = createRandomInt((array) => crypto.getRandomValues(array));
    const draws = 30_000;
    const counts = [0, 0, 0];
    for (let i = 0; i < draws; i++) counts[randomInt(3)]!++;
    for (const count of counts) expect(Math.abs(count / draws - 1 / 3)).toBeLessThan(0.015);
  });
});

describe('randomWorldId', () => {
  const randomInt = createRandomInt((array) => crypto.getRandomValues(array));

  it('has 28 alphanumeric characters', () => {
    expect(randomWorldId(randomInt)).toMatch(/^[A-Za-z0-9]{28}$/);
  });

  it('gives distinct ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomWorldId(randomInt)));
    expect(ids.size).toBe(1000);
  });
});
