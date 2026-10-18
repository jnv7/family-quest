import { describe, expect, it } from 'vitest';
import { extractWorldId, hashFor, joinLink, parseHash, type Route } from './routes';

const ID = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4';

describe('parseHash', () => {
  it.each<[string, Route]>([
    ['', { name: 'start' }],
    ['#/', { name: 'start' }],
    ['#/nonsense', { name: 'start' }],
    ['#/create', { name: 'create' }],
    ['#/profiles', { name: 'profiles' }],
    ['#/map', { name: 'map' }],
    ['#/board', { name: 'board' }],
    ['#/new-task', { name: 'newTask' }],
    ['#/home', { name: 'start' }],
    ['#/manage', { name: 'manage' }],
    ['#/share', { name: 'share' }],
    ['#/join', { name: 'join', worldId: null }],
    [`#/join/${ID}`, { name: 'join', worldId: ID }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('round-trips with hashFor', () => {
    const routes: Route[] = [{ name: 'start' }, { name: 'map' }, { name: 'newTask' }, { name: 'join', worldId: ID }, { name: 'join', worldId: null }];
    for (const route of routes) expect(parseHash(hashFor(route))).toEqual(route);
  });
});

describe('joinLink and extractWorldId', () => {
  it('builds the link with the code in the fragment', () => {
    expect(joinLink('https://example.org/family-quest/', ID)).toBe(`https://example.org/family-quest/#/join/${ID}`);
  });

  it('reads a bare code or a whole link, with surrounding spaces', () => {
    expect(extractWorldId(ID)).toBe(ID);
    expect(extractWorldId(`  ${ID} \n`)).toBe(ID);
    expect(extractWorldId(joinLink('https://example.org/family-quest/', ID))).toBe(ID);
  });

  it('rejects text that cannot be a world id', () => {
    expect(extractWorldId('')).toBeNull();
    expect(extractWorldId('short')).toBeNull();
    expect(extractWorldId(`${ID}!`)).toBeNull();
    expect(extractWorldId('not a code at all, not a code at all')).toBeNull();
  });
});
