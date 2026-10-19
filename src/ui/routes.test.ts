import { describe, expect, it } from 'vitest';
import { hashFor, joinLink, parseHash, parseJoinInput, type Route } from './routes';

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
    ['#/join', { name: 'join', worldId: null, themeId: null }],
    [`#/join/${ID}`, { name: 'join', worldId: ID, themeId: null }],
    [`#/join/${ID}/minimal-farm`, { name: 'join', worldId: ID, themeId: 'minimal-farm' }],
    ['#/install', { name: 'install' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('round-trips with hashFor', () => {
    const routes: Route[] = [{ name: 'start' }, { name: 'map' }, { name: 'newTask' }, { name: 'join', worldId: ID, themeId: null }, { name: 'join', worldId: ID, themeId: 'minimal-farm' }, { name: 'join', worldId: null, themeId: null }];
    for (const route of routes) expect(parseHash(hashFor(route))).toEqual(route);
  });
});

describe('joinLink and parseJoinInput', () => {
  const BASE = 'https://example.org/family-quest/';

  it('builds the link with the code and the theme in the fragment', () => {
    expect(joinLink(BASE, ID, 'minimal-farm')).toBe(`${BASE}#/join/${ID}/minimal-farm`);
    expect(joinLink(BASE, ID, null)).toBe(`${BASE}#/join/${ID}`);
  });

  it('reads a bare code, or a whole link with or without a theme, with surrounding spaces', () => {
    expect(parseJoinInput(ID)).toEqual({ worldId: ID, themeId: null });
    expect(parseJoinInput(`  ${ID} \n`)).toEqual({ worldId: ID, themeId: null });
    expect(parseJoinInput(joinLink(BASE, ID, null))).toEqual({ worldId: ID, themeId: null });
    expect(parseJoinInput(joinLink(BASE, ID, 'minimal-farm'))).toEqual({ worldId: ID, themeId: 'minimal-farm' });
  });

  it('rejects text that cannot be a world id', () => {
    expect(parseJoinInput('')).toBeNull();
    expect(parseJoinInput('short')).toBeNull();
    expect(parseJoinInput(`${ID}!`)).toBeNull();
    expect(parseJoinInput('not a code at all, not a code at all')).toBeNull();
  });
});
