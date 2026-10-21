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
  /** `defId` is set when editing a recurring definition. */
  | { name: 'newTask'; defId: string | null }
  | { name: 'manage' }
  | { name: 'share' }
  | { name: 'install' };

/** Route name → path segment, for the routes that carry no parameter. */
const SEGMENTS = {
  create: 'create',
  profiles: 'profiles',
  map: 'map',
  board: 'board',
  checkin: 'checkin',
  vault: 'vault',
  home: 'home',
  showcase: 'showcase',
  manage: 'manage',
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
  if (first === 'new-task') return { name: 'newTask', defId: second ? decodeURIComponent(second) : null };
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
  if (route.name === 'newTask') return route.defId ? `#/new-task/${encodeURIComponent(route.defId)}` : '#/new-task';
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
