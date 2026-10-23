import { LIMITS, TIERS, type Ruleset, type Tier, type TaskLevel } from './model';

/**
 * Tokens a task of this level earns now. This is the extension point for `ruleset.guarantee`
 * (SPEC.md §4): while it is off (null) the answer is the ruleset's own value.
 */
export function tokensFor(level: TaskLevel, ruleset: Ruleset): number {
  if (ruleset.guarantee !== null) throw new Error('ruleset.guarantee is not implemented');
  return ruleset.tokensPerLevel[level];
}

/** The price of a reward of this tier. */
export const priceOf = (tier: Tier, ruleset: Ruleset): number => ruleset.tokenPrices[tier];

/** Whether a balance covers a reward of this tier. */
export const canAfford = (balance: number, tier: Tier, ruleset: Ruleset): boolean => balance >= priceOf(tier, ruleset);

/** Whether `tokens` is what a completed task can carry: a whole number from 1 to `LIMITS.tokensPerLevelMax`. */
export const isTokenAmount = (tokens: number): boolean => Number.isInteger(tokens) && tokens >= 1 && tokens <= LIMITS.tokensPerLevelMax;

/** Whether `price` is what a reward can cost: a whole number from 1 to `LIMITS.tokenPriceMax`. */
export const isTokenPrice = (price: number): boolean => Number.isInteger(price) && price >= 1 && price <= LIMITS.tokenPriceMax;

export type TokenRulesProblem = 'not-integer' | 'out-of-range' | 'prices-not-increasing';

/** Whole numbers within `LIMITS`, and prices strictly increasing from low to high. */
export function tokenRulesProblem(rules: Pick<Ruleset, 'tokensPerLevel' | 'tokenPrices'>): TokenRulesProblem | null {
  const amounts = TIERS.map((level) => rules.tokensPerLevel[level]);
  const prices = TIERS.map((tier) => rules.tokenPrices[tier]);
  if (![...amounts, ...prices].every(Number.isInteger)) return 'not-integer';
  if (!amounts.every(isTokenAmount) || !prices.every(isTokenPrice)) return 'out-of-range';
  if (!(prices[0]! < prices[1]! && prices[1]! < prices[2]!)) return 'prices-not-increasing';
  return null;
}

/** Whether `size` is a valid `partySize`: a whole number from 1 to `LIMITS.partySizeMax`. */
export const isPartySize = (size: number): boolean => Number.isInteger(size) && size >= 1 && size <= LIMITS.partySizeMax;
