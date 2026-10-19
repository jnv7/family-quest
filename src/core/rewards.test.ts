import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, type Reward, type Ruleset } from './model';
import { canOpen } from './rewards';

const reward = (weekKey: string, openedAt: number | null = null): Reward => ({
  schemaVersion: 1,
  createdAt: 0,
  id: 'r1',
  profileId: 'p1',
  weekKey,
  tier: 'mid',
  openedAt,
});

const at = (iso: string) => Date.parse(iso);

describe('canOpen', () => {
  const cases: Array<[string, string, string, boolean, Partial<Ruleset>?]> = [
    ['Saturday before the opening day', '2026-10-24T10:00:00Z', '2026-W43', false],
    ['Sunday 01:30 in summer time', '2026-10-25T00:30:00Z', '2026-W43', true],
    ['Sunday 10:00 in winter time', '2026-10-25T10:00:00Z', '2026-W43', true],
    ['a closed week, on a Saturday', '2026-10-24T10:00:00Z', '2026-W42', true],
    ['a skipped Sunday, on Monday 00:00', '2026-10-26T00:00:00Z', '2026-W43', true],
    ['the turn of the year', '2027-01-04T00:00:00Z', '2026-W53', true],
    ['another opening day, reached', '2026-10-24T10:00:00Z', '2026-W43', true, { openingDay: 6 }],
    ['another opening day, not reached', '2026-10-23T10:00:00Z', '2026-W43', false, { openingDay: 6 }],
  ];
  it.each(cases)('%s', (_label, now, week, expected, ruleset = {}) => {
    expect(canOpen(reward(week), at(now), { ...DEFAULT_RULESET, ...ruleset })).toBe(expected);
  });

  it('is false for a reward already opened, whatever the day', () => {
    expect(canOpen(reward('2026-W42', 1), at('2026-10-26T00:00:00Z'), DEFAULT_RULESET)).toBe(false);
  });

  it('is false for a week that has not started', () => {
    expect(canOpen(reward('2026-W44'), at('2026-10-25T10:00:00Z'), DEFAULT_RULESET)).toBe(false);
  });

  it('judges the day in Lisbon, not in UTC', () => {
    // Saturday 23:30 UTC is Sunday 00:30 in Lisbon in summer time (UTC+1).
    expect(canOpen(reward('2026-W43'), at('2026-10-24T23:30:00Z'), DEFAULT_RULESET)).toBe(true);
    // Saturday 23:30 UTC is still Saturday in Lisbon in winter time (UTC+0).
    expect(canOpen(reward('2026-W44'), at('2026-10-31T23:30:00Z'), DEFAULT_RULESET)).toBe(false);
  });
});
