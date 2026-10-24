import { describe, expect, it } from 'vitest';
import { carrySearch, hashFor, parseCarry, joinLink, parseHash, parseJoinInput, type Route } from './routes';

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
    ['#/checkin', { name: 'checkin' }],
    ['#/new-task', { name: 'newTask', defId: null, from: 'board' }],
    ['#/tasks/new', { name: 'newTask', defId: null, from: 'tasks' }],
    ['#/new-task/abc123', { name: 'newTask', defId: 'abc123', from: 'tasks' }],
    ['#/people', { name: 'people' }],
    ['#/tasks', { name: 'tasks' }],
    ['#/rules', { name: 'rules' }],
    ['#/home', { name: 'home' }],
    ['#/nowhere', { name: 'start' }],
    ['#/manage', { name: 'manage' }],
    ['#/share', { name: 'share' }],
    ['#/join', { name: 'join', worldId: null, themeId: null, profileId: null }],
    [`#/join/${ID}`, { name: 'join', worldId: ID, themeId: null, profileId: null }],
    [`#/join/${ID}/minimal-farm`, { name: 'join', worldId: ID, themeId: 'minimal-farm', profileId: null }],
    [`#/join/${ID}/minimal-farm/kid42`, { name: 'join', worldId: ID, themeId: 'minimal-farm', profileId: 'kid42' }],
    [`#/join/${ID}/minimal-farm/kid42/later/parts`, { name: 'join', worldId: ID, themeId: 'minimal-farm', profileId: 'kid42' }],
    [`#/join/${ID}/minimal-farm/ki%20d`, { name: 'join', worldId: ID, themeId: 'minimal-farm', profileId: null }],
    [`#/join/${ID}/minimal-farm/`, { name: 'join', worldId: ID, themeId: 'minimal-farm', profileId: null }],
    [`#/join/${ID}//kid42`, { name: 'join', worldId: ID, themeId: null, profileId: null }],
    ['#/install', { name: 'install' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('round-trips with hashFor', () => {
    const routes: Route[] = [{ name: 'start' }, { name: 'map' }, { name: 'newTask', defId: null, from: 'board' }, { name: 'newTask', defId: null, from: 'tasks' }, { name: 'checkin' }, { name: 'newTask', defId: 'abc123', from: 'tasks' }, { name: 'people' }, { name: 'tasks' }, { name: 'rules' }, { name: 'join', worldId: ID, themeId: null, profileId: null }, { name: 'join', worldId: ID, themeId: 'minimal-farm', profileId: null }, { name: 'join', worldId: null, themeId: null, profileId: null }, { name: 'join', worldId: ID, themeId: 'minimal-farm', profileId: 'kid42' }];
    for (const route of routes) expect(parseHash(hashFor(route))).toEqual(route);
  });
});

describe('joinLink and parseJoinInput', () => {
  const BASE = 'https://example.org/family-quest/';

  it('builds the link with the code and the theme in the fragment', () => {
    expect(joinLink(BASE, ID, 'minimal-farm')).toBe(`${BASE}#/join/${ID}/minimal-farm`);
    expect(joinLink(BASE, ID, null)).toBe(`${BASE}#/join/${ID}`);
    expect(joinLink(BASE, ID, 'minimal-farm', 'kid42')).toBe(`${BASE}#/join/${ID}/minimal-farm/kid42`);
  });

  it('never writes a profile without its theme part', () => {
    expect(() => joinLink(BASE, ID, null, 'kid42')).toThrow('theme part');
  });

  it('reads a bare code, or a whole link with or without a theme, with surrounding spaces', () => {
    expect(parseJoinInput(ID)).toEqual({ worldId: ID, themeId: null, profileId: null });
    expect(parseJoinInput(`  ${ID} \n`)).toEqual({ worldId: ID, themeId: null, profileId: null });
    expect(parseJoinInput(joinLink(BASE, ID, null))).toEqual({ worldId: ID, themeId: null, profileId: null });
    expect(parseJoinInput(joinLink(BASE, ID, 'minimal-farm'))).toEqual({ worldId: ID, themeId: 'minimal-farm', profileId: null });
    expect(parseJoinInput(joinLink(BASE, ID, 'minimal-farm', 'kid42'))).toEqual({ worldId: ID, themeId: 'minimal-farm', profileId: 'kid42' });
    expect(parseJoinInput(`${joinLink(BASE, ID, 'minimal-farm', 'kid42')}/later/parts`)).toEqual({ worldId: ID, themeId: 'minimal-farm', profileId: 'kid42' });
    expect(parseJoinInput(`${joinLink(BASE, ID, 'minimal-farm')}/not-a-profile`)).toEqual({ worldId: ID, themeId: 'minimal-farm', profileId: null });
  });

  it('rejects text that cannot be a world id', () => {
    expect(parseJoinInput('')).toBeNull();
    expect(parseJoinInput('short')).toBeNull();
    expect(parseJoinInput(`${ID}!`)).toBeNull();
    expect(parseJoinInput('not a code at all, not a code at all')).toBeNull();
  });
});

describe('the carry for a home screen app', () => {
  const PROFILE = 'p1Q2w3E4r5T6y7U8i9O0';

  it('is read from the query, and only when it looks like a world code and a profile', () => {
    expect(parseCarry(`?theme=minimal&join=${ID}.${PROFILE}`)).toEqual({ worldId: ID, profileId: PROFILE });
    for (const search of ['', '?join=', '?join=short.abc', `?join=${ID}`, `?join=${ID}.`, `?join=${ID}.a/b`, `?join=${ID}.a.b`]) {
      expect(parseCarry(search), search).toBeNull();
    }
  });

  it('is written with the theme, keeps other parameters, and is taken out again', () => {
    const written = carrySearch('?x=1', { worldId: ID, profileId: PROFILE, themeId: 'minimal-farm' });
    expect(parseCarry(written)).toEqual({ worldId: ID, profileId: PROFILE });
    expect(new URLSearchParams(written).get('theme')).toBe('minimal-farm');
    expect(new URLSearchParams(written).get('x')).toBe('1');
    expect(carrySearch(written, null)).toBe('?x=1&theme=minimal-farm');
    expect(carrySearch('?join=abc', null)).toBe('');
  });
});
