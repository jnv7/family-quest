import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, SCHEMA_VERSION, type Profile } from './model';
import { mooredBoats } from './moorings';
import type { ThemeMoorings } from '../theme/types';

const spot = (x: number) => ({ x, y: 80, width: 8, height: 6 });
const moorings: ThemeMoorings = { child: { spots: [spot(10), spot(20), spot(30)], symbolAt: { x: 50, y: 40, size: 30 } } };

const profile = (id: string, extra: Partial<Profile> = {}): Profile => ({
  schemaVersion: SCHEMA_VERSION,
  createdAt: 1000,
  id,
  displayName: `Name ${id}`,
  kind: 'child',
  avatar: { ...DEFAULT_AVATAR },
  partyIds: [],
  archived: false,
  ...extra,
});

describe('mooredBoats', () => {
  it('has no boat for no children', () => {
    expect(mooredBoats([profile('a', { kind: 'adult' })], moorings, null)).toEqual([]);
  });

  it('moors one boat per child, in creation order, then id', () => {
    const boats = mooredBoats(
      [profile('c', { createdAt: 3000 }), profile('b', { createdAt: 2000 }), profile('a', { createdAt: 2000 })],
      moorings,
      'b',
    );
    expect(boats.map((boat) => [boat.spotIndex, boat.own])).toEqual([[0, false], [1, true], [2, false]]);
  });

  it('shows the symbol of each profile, or none', () => {
    const boats = mooredBoats(
      [profile('a', { createdAt: 1, avatar: { ...DEFAULT_AVATAR, symbol: '🐬' } }), profile('b', { createdAt: 2 })],
      moorings,
      null,
    );
    expect(boats.map((boat) => boat.symbol)).toEqual(['🐬', null]);
  });

  it('leaves out the children beyond the spots, without failing', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id, i) => profile(id, { createdAt: i }));
    expect(mooredBoats(many, moorings, null).map((boat) => boat.spotIndex)).toEqual([0, 1, 2]);
  });

  it('skips an archived child, so the next one moves up', () => {
    const boats = mooredBoats(
      [profile('a', { createdAt: 1, archived: true }), profile('b', { createdAt: 2 }), profile('c', { createdAt: 3 })],
      moorings,
      'c',
    );
    expect(boats.map((boat) => [boat.spotIndex, boat.own])).toEqual([[0, false], [1, true]]);
  });

  it('draws nothing for a kind without moorings, and nothing at all without moorings', () => {
    const adult = profile('a', { kind: 'adult' });
    expect(mooredBoats([adult, profile('b')], moorings, null).every((boat) => boat.kind === 'child')).toBe(true);
    expect(mooredBoats([adult, profile('b')], undefined, null)).toEqual([]);
  });

  it('carries no profile id or name', () => {
    const [boat] = mooredBoats([profile('a')], moorings, 'a');
    expect(Object.keys(boat!).sort()).toEqual(['kind', 'own', 'spotIndex', 'symbol']);
  });

  it('gives the same layout whatever the order the profiles arrive in', () => {
    const list = ['a', 'b', 'c'].map((id, i) => profile(id, { createdAt: i }));
    expect(mooredBoats([...list].reverse(), moorings, null)).toEqual(mooredBoats(list, moorings, null));
  });
});
