/** Hash routes (docs/architecture.md §7): GitHub Pages cannot rewrite paths, so there is no History API. */
import { LIMITS, type WorldId } from '../core/model';

export type Route =
  | { name: 'start' }
  | { name: 'create' }
  /** `worldId` is null when the person still has to type the code. */
  | { name: 'join'; worldId: WorldId | null; themeId: string | null }
  | { name: 'profiles' }
  | { name: 'map' }
  | { name: 'board' }
  | { name: 'checkin' }
  | { name: 'vault' }
  | { name: 'home' }
  | { name: 'showcase' }
  /** `defId` is set when editing a recurring definition. `from` is where back and save return to. */
  | { name: 'newTask'; defId: string | null; from: 'board' | 'tasks' }
  | { name: 'people' }
  | { name: 'tasks' }
  | { name: 'rules' }
  /** Only redirects to the map, so old bookmarks and history entries still work. */
  | { name: 'manage' }
  | { name: 'share' }
  | { name: 'install' };

/** Route name → path segment, for the routes that carry no parameter. */
const SEGMENTS = {
  create: 'create',
  profiles: 'profiles',
  map: 'map',
  board: 'board',
  vault: 'vault',
  checkin: 'checkin',
  home: 'home',
  showcase: 'showcase',
  manage: 'manage',
  people: 'people',
  tasks: 'tasks',
  rules: 'rules',
  share: 'share',
  install: 'install',
} as const;

/** Anything unknown is the start page. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [first = '', second, third] = path.split('/');
  if (first === 'join') {
    return { name: 'join', worldId: second ? decodeURIComponent(second) : null, themeId: third ? decodeURIComponent(third) : null };
  }
  if (first === 'new-task') return { name: 'newTask', defId: second ? decodeURIComponent(second) : null, from: second ? 'tasks' : 'board' };
  if (first === 'tasks' && second === 'new') return { name: 'newTask', defId: null, from: 'tasks' };
  const simple = (Object.keys(SEGMENTS) as Array<keyof typeof SEGMENTS>).find((name) => SEGMENTS[name] === first);
  return simple ? { name: simple } : { name: 'start' };
}

export function hashFor(route: Route): string {
  if (route.name === 'start') return '#/';
  if (route.name === 'join') {
    if (!route.worldId) return '#/join';
    const world = `#/join/${encodeURIComponent(route.worldId)}`;
    return route.themeId ? `${world}/${encodeURIComponent(route.themeId)}` : world;
  }
  if (route.name === 'newTask') {
    if (route.defId) return `#/new-task/${encodeURIComponent(route.defId)}`;
    return route.from === 'tasks' ? '#/tasks/new' : '#/new-task';
  }
  return `#/${SEGMENTS[route.name]}`;
}

/**
 * `<app URL>#/join/<worldId>/<themeId>` (SPEC.md §5). The code sits in the fragment, so no
 * server log sees it. The theme id is not secret: it lets the page look like the world
 * before anyone joins, and lets the app offer to install itself with the right name and icon.
 */
export function joinLink(baseUrl: string, worldId: WorldId, themeId: string | null): string {
  return `${baseUrl}${hashFor({ name: 'join', worldId, themeId })}`;
}

export interface JoinTarget {
  worldId: WorldId;
  themeId: string | null;
}

/** Accepts a bare code or a whole join link; returns null if it cannot be a world id. */
export function parseJoinInput(input: string): JoinTarget | null {
  const text = input.trim();
  const link = /#\/join\/([A-Za-z0-9]+)(?:\/([a-z][a-z0-9-]*))?\s*$/.exec(text);
  const worldId = link?.[1] ?? text;
  const themeId = link?.[2] ?? null;
  return /^[A-Za-z0-9]+$/.test(worldId) && worldId.length >= LIMITS.worldIdMinLength ? { worldId, themeId } : null;
}

/**
 * What an iPhone's home screen app is given to start already in its world (ADR 0014): the world code and the profile
 * of the device it was added from, in the query of the address (`?join=<worldId>.<profileId>`). The ids are
 * letters and digits. The code is no more exposed than in a join link: anyone who has it can already join and
 * choose any profile (ADR 0003).
 */
export interface Carry {
  worldId: WorldId;
  profileId: string;
}

const CARRY_PARAM = 'join';

export function parseCarry(search: string): Carry | null {
  const match = /^([A-Za-z0-9]+)\.([A-Za-z0-9]+)$/.exec(new URLSearchParams(search).get(CARRY_PARAM) ?? '');
  return match && match[1]!.length >= LIMITS.worldIdMinLength ? { worldId: match[1]!, profileId: match[2]! } : null;
}

/** `search` with the carry and the theme set, or, for `null`, with the carry taken out. Other parameters stay. */
export function carrySearch(search: string, carry: (Carry & { themeId: string }) | null): string {
  const params = new URLSearchParams(search);
  if (carry) {
    params.set(CARRY_PARAM, `${carry.worldId}.${carry.profileId}`);
    params.set('theme', carry.themeId);
  } else {
    params.delete(CARRY_PARAM);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
