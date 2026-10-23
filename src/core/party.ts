import { addDays, dateKey } from './calendar';
import type { Collectible, Millis, Profile, Ruleset, TaskId } from './model';

/** The three states of a collectible (SPEC.md §6). */
export type CollectibleState = 'party' | 'pending' | 'reserve';

/** The party is the source of truth: a collectible whose id is in `partyIds` is in the party. */
export function collectibleState(collectible: Collectible, partyIds: readonly TaskId[]): CollectibleState {
  if (partyIds.includes(collectible.id)) return 'party';
  return collectible.reserveAt === null ? 'pending' : 'reserve';
}

/**
 * The pending collectibles that move to the reserve now: those whose obtaining day, in the
 * world's time zone, is at least `pendingDays` days behind today (SPEC.md §6). A collectible in
 * the party, or already in the reserve, never appears.
 */
export function pendingToReserve(
  collectibles: readonly Collectible[],
  partyIds: readonly TaskId[],
  now: Millis,
  ruleset: Ruleset,
): TaskId[] {
  const today = dateKey(now, ruleset.timezone);
  return collectibles
    .filter((collectible) => collectibleState(collectible, partyIds) === 'pending')
    .filter((collectible) => today >= addDays(dateKey(collectible.obtainedAt, ruleset.timezone), ruleset.pendingDays))
    .map((collectible) => collectible.id);
}

export interface PartyChange {
  /** The new party, in order. */
  partyIds: TaskId[];
  /** Collectibles that go to the reserve: `reserveAt := now`. */
  toReserve: TaskId[];
  /** Collectibles that leave the reserve to join the party: `reserveAt := null`. */
  fromReserve: TaskId[];
}

export type PartyProblem = 'too-many' | 'duplicate' | 'not-owned' | 'inconsistent';

const hasDuplicates = (ids: readonly string[]): boolean => new Set(ids).size !== ids.length;

/**
 * Checks a change before anything is written: every id is the profile's own, the party has no
 * repeats and fits `partySize` (a party above a lowered size may only lose members), and `toReserve` and `fromReserve` say exactly what the new party
 * implies. Whoever leaves the party goes to the reserve; whoever joins from the reserve leaves it;
 * a pending collectible may also go to the reserve on its own.
 */
export function checkPartyChange(
  profile: Profile,
  owned: readonly Collectible[],
  change: PartyChange,
  partySize: number,
): PartyProblem | null {
  const ownedById = new Map(owned.map((collectible) => [collectible.id, collectible]));
  const everyId = [...change.partyIds, ...change.toReserve, ...change.fromReserve, ...profile.partyIds];
  if (everyId.some((id) => !ownedById.has(id))) return 'not-owned';
  if (hasDuplicates(change.partyIds) || hasDuplicates(change.toReserve) || hasDuplicates(change.fromReserve)) return 'duplicate';

  const before = new Set(profile.partyIds);
  // A party above a lowered size may lose members and be reordered, but nobody joins it (firestore.rules).
  if (change.partyIds.length > partySize && change.partyIds.some((id) => !before.has(id))) return 'too-many';
  const after = new Set(change.partyIds);
  const toReserve = new Set(change.toReserve);
  const fromReserve = new Set(change.fromReserve);

  const leaving = profile.partyIds.filter((id) => !after.has(id));
  if (leaving.some((id) => !toReserve.has(id))) return 'inconsistent';
  if (change.toReserve.some((id) => after.has(id) || ownedById.get(id)!.reserveAt !== null)) return 'inconsistent';
  const joining = change.partyIds.filter((id) => !before.has(id));
  const joiningFromReserve = joining.filter((id) => ownedById.get(id)!.reserveAt !== null);
  if (joiningFromReserve.some((id) => !fromReserve.has(id))) return 'inconsistent';
  if (change.fromReserve.some((id) => !after.has(id) || ownedById.get(id)!.reserveAt === null)) return 'inconsistent';
  return null;
}
