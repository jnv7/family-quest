import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET, type Collectible, type Profile } from './model';
import { checkPartyChange, collectibleState, pendingToReserve, type PartyChange } from './party';

const at = (iso: string) => Date.parse(iso);

const collectible = (id: string, obtainedAt = 0, reserveAt: number | null = null): Collectible => ({
  schemaVersion: 1,
  createdAt: obtainedAt,
  id,
  profileId: 'p1',
  slot: 'cat',
  tier: 'low',
  nickname: null,
  obtainedWeekKey: '2026-W43',
  obtainedAt,
  reserveAt,
});

const profile = (partyIds: string[]): Profile => ({
  schemaVersion: 1,
  createdAt: 0,
  id: 'p1',
  displayName: 'Sam',
  kind: 'child',
  avatar: { body: 0, hair: 0, outfit: 0, accessory: 0, symbol: null },
  partyIds,
  archived: false,
});

describe('collectibleState', () => {
  it('is party, pending or reserve', () => {
    expect(collectibleState(collectible('a'), ['a'])).toBe('party');
    expect(collectibleState(collectible('a'), [])).toBe('pending');
    expect(collectibleState(collectible('a', 0, 5), [])).toBe('reserve');
  });
});

describe('pendingToReserve', () => {
  const cases: Array<[string, string, string, boolean, number?]> = [
    ['the same day', '2026-10-25T20:00:00Z', '2026-10-25T23:59:00Z', false],
    ['the next day', '2026-10-25T20:00:00Z', '2026-10-26T00:00:00Z', true],
    ['the next day in Lisbon, though the same date in UTC', '2026-10-18T22:30:00Z', '2026-10-18T23:00:00Z', true],
    ['two pending days, one day later', '2026-10-25T20:00:00Z', '2026-10-26T12:00:00Z', false, 2],
    ['two pending days, two days later', '2026-10-25T20:00:00Z', '2026-10-27T00:00:00Z', true, 2],
    ['across the change to winter time', '2026-10-24T22:30:00Z', '2026-10-25T22:59:00Z', true],
  ];
  it.each(cases)('%s', (_label, obtained, now, expected, pendingDays = 1) => {
    const result = pendingToReserve([collectible('a', at(obtained))], [], at(now), { ...DEFAULT_RULESET, pendingDays });
    expect(result).toEqual(expected ? ['a'] : []);
  });

  it('never moves one in the party, and does not list one already in the reserve', () => {
    const long = at('2026-10-01T10:00:00Z');
    const now = at('2026-11-01T10:00:00Z');
    expect(pendingToReserve([collectible('a', long)], ['a'], now, DEFAULT_RULESET)).toEqual([]);
    expect(pendingToReserve([collectible('b', long, long + 1)], [], now, DEFAULT_RULESET)).toEqual([]);
  });

  it('lists every pending one that is due, in the order given', () => {
    const old = at('2026-10-01T10:00:00Z');
    const fresh = at('2026-11-01T09:00:00Z');
    const result = pendingToReserve([collectible('b', old), collectible('c', fresh), collectible('a', old)], [], at('2026-11-01T10:00:00Z'), DEFAULT_RULESET);
    expect(result).toEqual(['b', 'a']);
  });
});

describe('checkPartyChange', () => {
  const owned = [
    collectible('a'),
    collectible('b'),
    collectible('c'),
    collectible('d'),
    collectible('e'),
    collectible('f'),
    collectible('r', 0, 9), // in the reserve
  ];
  const change = (overrides: Partial<PartyChange>): PartyChange => ({ partyIds: [], toReserve: [], fromReserve: [], ...overrides });
  const check = (partyIds: string[], c: PartyChange, size = 5) => checkPartyChange(profile(partyIds), owned, c, size);

  it('accepts adding to a party with room', () => {
    expect(check(['a', 'b'], change({ partyIds: ['a', 'b', 'c'] }))).toBeNull();
  });

  it('accepts adding to a full party when someone leaves for the reserve', () => {
    expect(check(['a', 'b', 'c', 'd', 'e'], change({ partyIds: ['a', 'b', 'c', 'd', 'f'], toReserve: ['e'] }))).toBeNull();
  });

  it('accepts bringing one back from the reserve', () => {
    expect(check(['a'], change({ partyIds: ['a', 'r'], fromReserve: ['r'] }))).toBeNull();
  });

  it('accepts a pending one going to the reserve on its own', () => {
    expect(check(['a'], change({ partyIds: ['a'], toReserve: ['b'] }))).toBeNull();
  });

  it('accepts reordering the party', () => {
    expect(check(['a', 'b'], change({ partyIds: ['b', 'a'] }))).toBeNull();
  });

  it('reports too-many when the party outgrows its size', () => {
    expect(check(['a', 'b', 'c', 'd', 'e'], change({ partyIds: ['a', 'b', 'c', 'd', 'e', 'f'] }))).toBe('too-many');
    expect(check([], change({ partyIds: ['a', 'b'] }), 1)).toBe('too-many');
  });

  it('reports duplicate when an id repeats', () => {
    expect(check([], change({ partyIds: ['a', 'a'] }))).toBe('duplicate');
    expect(check(['a'], change({ partyIds: ['a'], toReserve: ['b', 'b'] }))).toBe('duplicate');
  });

  it('reports not-owned for an id the profile does not have', () => {
    expect(check([], change({ partyIds: ['zzz'] }))).toBe('not-owned');
    expect(check([], change({ partyIds: [], toReserve: ['zzz'] }))).toBe('not-owned');
  });

  describe('inconsistent', () => {
    it('when someone leaves the party without going to the reserve', () => {
      expect(check(['a', 'b'], change({ partyIds: ['a'] }))).toBe('inconsistent');
    });
    it('when one in the new party is also sent to the reserve', () => {
      expect(check(['a'], change({ partyIds: ['a', 'b'], toReserve: ['b'] }))).toBe('inconsistent');
    });
    it('when one already in the reserve is sent there again', () => {
      expect(check(['a'], change({ partyIds: ['a'], toReserve: ['r'] }))).toBe('inconsistent');
    });
    it('when one joins from the reserve without leaving it', () => {
      expect(check(['a'], change({ partyIds: ['a', 'r'] }))).toBe('inconsistent');
    });
    it('when fromReserve names one that is not joining or is not in the reserve', () => {
      expect(check(['a'], change({ partyIds: ['a'], fromReserve: ['r'] }))).toBe('inconsistent');
      expect(check([], change({ partyIds: ['b'], fromReserve: ['b'] }))).toBe('inconsistent');
    });
  });
});
