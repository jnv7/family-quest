import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectionOf, displayName, nicknameTooLong, normaliseNickname } from './collection';
import type { Collectible } from './model';

const make = (id: string, extra: Partial<Collectible> = {}): Collectible => ({
  schemaVersion: 1,
  createdAt: 0,
  id,
  profileId: 'p1',
  slot: `slot-${id}`,
  tier: 'low',
  nickname: null,
  obtainedWeekKey: '2026-W40',
  obtainedAt: 1000,
  reserveAt: null,
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('displayName', () => {
  const names = (slot: string) => {
    if (slot === 'slot-a') return 'Catalogue A';
    throw new Error(`no ${slot}`);
  };

  it('returns the nickname when there is one', () => {
    expect(displayName(make('a', { nickname: 'Bolinhas' }), names)).toBe('Bolinhas');
  });

  it('returns the catalogue name when the nickname is null', () => {
    expect(displayName(make('a'), names)).toBe('Catalogue A');
  });

  it('throws when the slot is missing from the catalogue', () => {
    expect(() => displayName(make('b'), names)).toThrow();
  });
});

describe('collectionOf', () => {
  it('splits the three states, the party in partyIds order', () => {
    const a = make('a', { obtainedAt: 1 });
    const b = make('b', { obtainedAt: 2 });
    const c = make('c', { obtainedAt: 3, reserveAt: 50 });
    const d = make('d', { obtainedAt: 4, reserveAt: 60 });
    const e = make('e', { obtainedAt: 5 });
    const f = make('f', { obtainedAt: 6 });
    const result = collectionOf([a, b, c, d, e, f], ['b', 'a']);
    expect(result.party.map((x) => x.id)).toEqual(['b', 'a']);
    expect(result.pending.map((x) => x.id)).toEqual(['f', 'e']);
    expect(result.reserve.map((x) => x.id)).toEqual(['d', 'c']);
  });

  it('ignores a party entry the profile does not own, and reports it', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = collectionOf([make('a')], ['ghost', 'a']);
    expect(result.party.map((x) => x.id)).toEqual(['a']);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('nicknames', () => {
  it('trims, and turns empty text into null', () => {
    expect(normaliseNickname('  Rex ')).toBe('Rex');
    expect(normaliseNickname('   ')).toBeNull();
  });

  it('flags only more than the limit', () => {
    expect(nicknameTooLong('x'.repeat(30))).toBe(false);
    expect(nicknameTooLong('x'.repeat(31))).toBe(true);
    expect(nicknameTooLong(null)).toBe(false);
  });
});
