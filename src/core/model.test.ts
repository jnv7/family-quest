import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, TIERS, recurringTaskId } from './model';

describe('recurringTaskId', () => {
  it('joins definition, period and profile', () => {
    expect(recurringTaskId('defA', '2026-W53', 'p1')).toBe('defA_2026-W53_p1');
  });
});

describe('DEFAULT_RULESET', () => {
  it('has tier odds that are integers summing to 100 for every level', () => {
    for (const level of TIERS) {
      const odds = DEFAULT_RULESET.tierOdds[level];
      const values = TIERS.map((tier) => odds[tier]);
      expect(values.every(Number.isInteger)).toBe(true);
      expect(values.reduce((a, b) => a + b, 0)).toBe(100);
    }
  });
});
