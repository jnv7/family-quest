import type { RandomInt, Slot, Tier } from './model';

/** Uniform among the catalogue slots of that tier (SPEC.md §6). */
export function drawSlot(slots: readonly { slot: Slot; tier: Tier }[], tier: Tier, randomInt: RandomInt): Slot {
  const candidates = slots.filter((entry) => entry.tier === tier);
  if (candidates.length === 0) throw new Error(`The catalogue has no slot of tier "${tier}"`);
  return candidates[randomInt(candidates.length)]!.slot;
}
