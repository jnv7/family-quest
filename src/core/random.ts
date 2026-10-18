import type { RandomInt, WorldId } from './model';

/** Source of random bits. Production: `(a) => crypto.getRandomValues(a)`. */
export type FillRandom = (array: Uint32Array<ArrayBuffer>) => void;

const UINT32_RANGE = 2 ** 32;
const WORLD_ID_LENGTH = 28;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Builds an unbiased `RandomInt` by rejection sampling over 32-bit values. */
export function createRandomInt(fill: FillRandom): RandomInt {
  const buffer = new Uint32Array(1);
  return (maxExclusive) => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new RangeError(`maxExclusive must be an integer from 1 to 2^32, got ${maxExclusive}`);
    }
    // Largest multiple of maxExclusive that fits; values at or above it would bias the result.
    const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
    for (;;) {
      fill(buffer);
      const value = buffer[0]!;
      if (value < limit) return value % maxExclusive;
    }
  };
}

/** A random id of `length` characters from `[A-Za-z0-9]`. */
export function randomId(randomInt: RandomInt, length: number): string {
  let id = '';
  for (let i = 0; i < length; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

/** A world id doubles as the access code (SPEC.md §4), so it is long and random. */
export function randomWorldId(randomInt: RandomInt): WorldId {
  return randomId(randomInt, WORLD_ID_LENGTH);
}
