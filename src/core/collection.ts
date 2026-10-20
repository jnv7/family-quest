import { LIMITS } from './model';
import type { Collectible, Slot, TaskId } from './model';

/** The name to show: the nickname, or else the catalogue slot's name in the active theme. */
export function displayName(collectible: Collectible, slotName: (slot: Slot) => string): string {
  return collectible.nickname ?? slotName(collectible.slot);
}

/**
 * The profile's collectibles split by state (SPEC.md §6). The party follows the order of
 * `partyIds`; pending and reserve come newest first. A `partyIds` entry the profile does not own
 * is ignored and reported, because it means the data is wrong.
 */
export function collectionOf(
  owned: readonly Collectible[],
  partyIds: readonly TaskId[],
): { party: Collectible[]; pending: Collectible[]; reserve: Collectible[] } {
  const byId = new Map(owned.map((collectible) => [collectible.id, collectible]));
  const party: Collectible[] = [];
  for (const id of partyIds) {
    const collectible = byId.get(id);
    if (collectible) party.push(collectible);
    else console.error(`The party holds "${id}", which the profile does not own`);
  }
  const inParty = new Set(party.map((collectible) => collectible.id));
  const rest = owned.filter((collectible) => !inParty.has(collectible.id)).sort(newestFirst);
  return {
    party,
    pending: rest.filter((collectible) => collectible.reserveAt === null),
    reserve: rest.filter((collectible) => collectible.reserveAt !== null).sort((a, b) => b.reserveAt! - a.reserveAt! || newestFirst(a, b)),
  };
}

const newestFirst = (a: Collectible, b: Collectible): number => b.obtainedAt - a.obtainedAt || (a.id < b.id ? -1 : 1);

/** A nickname as it is stored: trimmed, and null when empty. */
export function normaliseNickname(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/** True when the (trimmed) nickname is longer than `LIMITS.nickname`. */
export const nicknameTooLong = (nickname: string | null): boolean => nickname !== null && nickname.length > LIMITS.nickname;
