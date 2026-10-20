import { TIERS, type RandomInt, type Ruleset, type Slot, type Tier, type TaskLevel, type TierOdds } from './model';

/**
 * The odds for a task's level. This is the extension point for `ruleset.guarantee`
 * (SPEC.md §4): while it is off (null) the answer is the ruleset's own row.
 */
export function tierOddsFor(level: TaskLevel, ruleset: Ruleset): TierOdds {
  if (ruleset.guarantee !== null) throw new Error('ruleset.guarantee is not implemented');
  return ruleset.tierOdds[level];
}

/** Whether the odds are integers that sum to 100: the rule `drawTier` and the reward-odds form share. */
export function oddsProblem(odds: TierOdds): 'not-integer' | 'not-100' | null {
  const values = TIERS.map((tier) => odds[tier]);
  if (!values.every((value) => Number.isInteger(value) && value >= 0)) return 'not-integer';
  return values.reduce((sum, value) => sum + value, 0) === 100 ? null : 'not-100';
}

/** r = randomInt(100); r < low → low; r < low + mid → mid; otherwise high. */
export function drawTier(odds: TierOdds, randomInt: RandomInt): Tier {
  const problem = oddsProblem(odds);
  if (problem) throw new RangeError(`Tier odds must be non-negative integers that sum to 100 (${problem})`);
  const r = randomInt(100);
  if (r < odds.low) return 'low';
  if (r < odds.low + odds.mid) return 'mid';
  return 'high';
}

/** Uniform among the catalogue slots of that tier (SPEC.md §6). */
export function drawSlot(slots: readonly { slot: Slot; tier: Tier }[], tier: Tier, randomInt: RandomInt): Slot {
  const candidates = slots.filter((entry) => entry.tier === tier);
  if (candidates.length === 0) throw new Error(`The catalogue has no slot of tier "${tier}"`);
  return candidates[randomInt(candidates.length)]!.slot;
}
