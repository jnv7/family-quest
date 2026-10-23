import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, type Ruleset } from './model';
import { canAfford, isPartySize, priceOf, tokenRulesProblem, tokensFor } from './tokens';

const rules = (tokensPerLevel: Ruleset['tokensPerLevel'], tokenPrices: Ruleset['tokenPrices']) => ({ tokensPerLevel, tokenPrices });

describe('tokensFor and priceOf', () => {
  it('read the ruleset', () => {
    expect(tokensFor('low', DEFAULT_RULESET)).toBe(1);
    expect(tokensFor('mid', DEFAULT_RULESET)).toBe(2);
    expect(tokensFor('high', DEFAULT_RULESET)).toBe(4);
    expect(priceOf('low', DEFAULT_RULESET)).toBe(5);
    expect(priceOf('mid', DEFAULT_RULESET)).toBe(12);
    expect(priceOf('high', DEFAULT_RULESET)).toBe(25);
  });

  it('follow a changed ruleset', () => {
    const changed: Ruleset = { ...DEFAULT_RULESET, tokensPerLevel: { low: 2, mid: 3, high: 5 }, tokenPrices: { low: 6, mid: 10, high: 30 } };
    expect(tokensFor('mid', changed)).toBe(3);
    expect(priceOf('high', changed)).toBe(30);
  });

  it('tokensFor fails while the guarantee is not implemented', () => {
    expect(() => tokensFor('mid', { ...DEFAULT_RULESET, guarantee: 'x' as unknown as null })).toThrow();
  });
});

describe('canAfford', () => {
  it('is true from the exact price', () => {
    expect(canAfford(12, 'mid', DEFAULT_RULESET)).toBe(true);
    expect(canAfford(11, 'mid', DEFAULT_RULESET)).toBe(false);
    expect(canAfford(12, 'high', DEFAULT_RULESET)).toBe(false);
    expect(canAfford(0, 'low', DEFAULT_RULESET)).toBe(false);
  });
});

describe('tokenRulesProblem', () => {
  const ok = rules({ low: 1, mid: 2, high: 4 }, { low: 5, mid: 12, high: 25 });

  it('accepts the defaults and the limits', () => {
    expect(tokenRulesProblem(ok)).toBeNull();
    expect(tokenRulesProblem(rules({ low: 1, mid: 1, high: 10 }, { low: 1, mid: 2, high: 200 }))).toBeNull();
  });

  it('refuses amounts that are not whole numbers', () => {
    expect(tokenRulesProblem(rules({ low: 1.5, mid: 2, high: 4 }, ok.tokenPrices))).toBe('not-integer');
    expect(tokenRulesProblem(rules(ok.tokensPerLevel, { low: 5, mid: Number.NaN, high: 25 }))).toBe('not-integer');
  });

  it('refuses amounts outside the limits', () => {
    expect(tokenRulesProblem(rules({ low: 0, mid: 2, high: 4 }, ok.tokenPrices))).toBe('out-of-range');
    expect(tokenRulesProblem(rules({ low: 1, mid: 2, high: 11 }, ok.tokenPrices))).toBe('out-of-range');
    expect(tokenRulesProblem(rules(ok.tokensPerLevel, { low: 0, mid: 12, high: 25 }))).toBe('out-of-range');
    expect(tokenRulesProblem(rules(ok.tokensPerLevel, { low: 5, mid: 12, high: 201 }))).toBe('out-of-range');
  });

  it('refuses prices that do not increase', () => {
    expect(tokenRulesProblem(rules(ok.tokensPerLevel, { low: 5, mid: 5, high: 25 }))).toBe('prices-not-increasing');
    expect(tokenRulesProblem(rules(ok.tokensPerLevel, { low: 12, mid: 5, high: 25 }))).toBe('prices-not-increasing');
    expect(tokenRulesProblem(rules(ok.tokensPerLevel, { low: 5, mid: 12, high: 12 }))).toBe('prices-not-increasing');
  });
});

describe('isPartySize', () => {
  it('is a whole number from 1 to 10', () => {
    expect(isPartySize(1)).toBe(true);
    expect(isPartySize(10)).toBe(true);
    expect(isPartySize(0)).toBe(false);
    expect(isPartySize(11)).toBe(false);
    expect(isPartySize(2.5)).toBe(false);
  });
});
