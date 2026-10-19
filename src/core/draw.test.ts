import { describe, expect, it } from 'vitest';
import { drawSlot, drawTier, oddsProblem, tierOddsFor } from './draw';
import { DEFAULT_RULESET, TIERS, type Tier, type TierOdds } from './model';
import { createRandomInt } from './random';

const odds: TierOdds = { low: 80, mid: 17, high: 3 };
const returning = (value: number) => () => value;
const scripted = (...values: number[]) => {
  let call = 0;
  return () => values[call++]!;
};

describe('drawTier', () => {
  it.each([
    [0, 'low'],
    [79, 'low'],
    [80, 'mid'],
    [96, 'mid'],
    [97, 'high'],
    [99, 'high'],
  ] as const)('maps r = %i to %s', (r, tier) => {
    expect(drawTier(odds, returning(r))).toBe(tier);
  });

  it('draws in the range 0 to 99', () => {
    let asked = 0;
    drawTier(odds, (max) => ((asked = max), 0));
    expect(asked).toBe(100);
  });

  it.each([
    ['99', { low: 80, mid: 17, high: 2 }],
    ['101', { low: 80, mid: 17, high: 4 }],
    ['a non-integer value', { low: 80.5, mid: 16.5, high: 3 }],
    ['a negative value', { low: 110, mid: -10, high: 0 }],
  ])('throws when the odds sum to %s', (_label, bad) => {
    expect(() => drawTier(bad, returning(0))).toThrow(RangeError);
  });
});

describe('oddsProblem', () => {
  it('names what is wrong', () => {
    expect(oddsProblem(odds)).toBeNull();
    expect(oddsProblem({ low: 50, mid: 40, high: 9 })).toBe('not-100');
    expect(oddsProblem({ low: 50, mid: 40, high: 10.5 })).toBe('not-integer');
  });
});

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

describe('tierOddsFor', () => {
  it('returns the ruleset row of the level', () => {
    expect(tierOddsFor('high', DEFAULT_RULESET)).toEqual({ low: 45, mid: 35, high: 20 });
  });

  it('throws when a guarantee is set', () => {
    const ruleset = { ...DEFAULT_RULESET, guarantee: {} as never };
    expect(() => tierOddsFor('low', ruleset)).toThrow(/not implemented/);
  });
});

describe('draw simulation (SPEC.md §11)', () => {
  // Chi-square critical value for 2 degrees of freedom at significance 0.001.
  const CRITICAL = 13.82;
  const DRAWS = 10_000;
  const randomInt = createRandomInt((array) => crypto.getRandomValues(array));

  it.each(['low', 'mid', 'high'] as const)('keeps the distribution of level %s within the margin', (level) => {
    const expected = DEFAULT_RULESET.tierOdds[level];
    const counts: Record<Tier, number> = { low: 0, mid: 0, high: 0 };
    for (let i = 0; i < DRAWS; i++) counts[drawTier(expected, randomInt)]++;
    const chiSquare = TIERS.reduce((sum, tier) => {
      const want = (DRAWS * expected[tier]) / 100;
      return sum + (counts[tier] - want) ** 2 / want;
    }, 0);
    expect(chiSquare).toBeLessThan(CRITICAL);
  });
});
