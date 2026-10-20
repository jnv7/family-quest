import { isoWeekday, weekKey } from './calendar';
import type { Millis, Reward, Ruleset } from './model';

/**
 * Whether a reward can be opened now (SPEC.md §6): it is unopened, and either its week is
 * closed, or it is the current week and the Lisbon weekday is on or after `ruleset.openingDay`.
 * Week keys compare as strings (`2026-W53` < `2027-W01`), so a skipped opening day is never lost.
 */
export function canOpen(reward: Reward, now: Millis, ruleset: Ruleset): boolean {
  if (reward.openedAt !== null) return false;
  const current = weekKey(now, ruleset.timezone);
  if (reward.weekKey < current) return true;
  if (reward.weekKey > current) return false;
  return isoWeekday(now, ruleset.timezone) >= ruleset.openingDay;
}
