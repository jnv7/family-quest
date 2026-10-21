import type { Profile, ProfileId, ProfileKind } from './model';
import type { ThemeMoorings } from '../theme/types';

/**
 * A boat at a mooring. It carries no profile id and no name on purpose: the map needs only the
 * kind, the spot, the symbol, and whether the boat is the active profile's own (SPEC.md §7).
 */
export interface MooredBoat {
  kind: ProfileKind;
  spotIndex: number;
  symbol: string | null;
  own: boolean;
}

const KINDS: readonly ProfileKind[] = ['adult', 'child'];

/**
 * The non-archived profiles of each kind that has moorings, in creation order (`createdAt`, then
 * `id`, so every device draws the same layout), one per spot. Profiles beyond the spots are left
 * out: that is a limit of the theme, not an error.
 */
export function mooredBoats(
  profiles: readonly Profile[],
  moorings: ThemeMoorings | undefined,
  activeProfileId: ProfileId | null,
): MooredBoat[] {
  return KINDS.flatMap((kind) => {
    const kindMoorings = moorings?.[kind];
    if (!kindMoorings) return [];
    return profiles
      .filter((profile) => profile.kind === kind && !profile.archived)
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, kindMoorings.spots.length)
      .map((profile, spotIndex) => ({ kind, spotIndex, symbol: profile.avatar.symbol, own: profile.id === activeProfileId }));
  });
}
