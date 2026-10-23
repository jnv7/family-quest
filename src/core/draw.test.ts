import { describe, expect, it } from 'vitest';
import { drawSlot } from './draw';
import type { Tier } from './model';

const returning = (value: number) => () => value;
const scripted = (...values: number[]) => {
  let call = 0;
  return () => values[call++]!;
};

describe('drawSlot', () => {
  const slots = [
    { slot: 'a', tier: 'low' as Tier },
    { slot: 'b', tier: 'mid' as Tier },
    { slot: 'c', tier: 'low' as Tier },
    { slot: 'd', tier: 'low' as Tier },
  ];

  it('returns only slots of the requested tier, each once for 0, 1 and 2', () => {
    const randomInt = scripted(0, 1, 2);
    expect([randomInt, randomInt, randomInt].map((draw) => drawSlot(slots, 'low', draw))).toEqual(['a', 'c', 'd']);
  });

  it('asks for a number below the count of that tier', () => {
    let asked = 0;
    drawSlot(slots, 'mid', (max) => ((asked = max), 0));
    expect(asked).toBe(1);
  });

  it('throws when the tier has no slot', () => {
    expect(() => drawSlot(slots, 'high', returning(0))).toThrow(/no slot/);
  });
});
