/** Hash routes (docs/architecture.md §7): GitHub Pages cannot rewrite paths, so there is no History API. */
import { LIMITS, type WorldId } from '../core/model';

export type Route =
  | { name: 'start' }
  | { name: 'create' }
  /** `worldId` is null when the person still has to type the code. */
  | { name: 'join'; worldId: WorldId | null }
  | { name: 'profiles' }
  | { name: 'home' }
  | { name: 'manage' }
  | { name: 'share' };

const SIMPLE_ROUTES = ['create', 'profiles', 'home', 'manage', 'share'] as const;

/** Anything unknown is the start page. */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [first = '', second] = path.split('/');
  if (first === 'join') return { name: 'join', worldId: second ? decodeURIComponent(second) : null };
  const simple = SIMPLE_ROUTES.find((name) => name === first);
  return simple ? { name: simple } : { name: 'start' };
}

export function hashFor(route: Route): string {
  if (route.name === 'start') return '#/';
  if (route.name === 'join') return route.worldId ? `#/join/${encodeURIComponent(route.worldId)}` : '#/join';
  return `#/${route.name}`;
}

/** `<app URL>#/join/<worldId>` (SPEC.md §5). The code sits in the fragment, so no server log sees it. */
export function joinLink(baseUrl: string, worldId: WorldId): string {
  return `${baseUrl}${hashFor({ name: 'join', worldId })}`;
}

/** Accepts a bare code or a whole join link; returns null if it cannot be a world id. */
export function extractWorldId(input: string): WorldId | null {
  const text = input.trim();
  const fromLink = /#\/join\/([A-Za-z0-9]+)\s*$/.exec(text)?.[1];
  const candidate = fromLink ?? text;
  return /^[A-Za-z0-9]+$/.test(candidate) && candidate.length >= LIMITS.worldIdMinLength ? candidate : null;
}
