import { displayName } from '../core/collection';
import type { Collectible, Profile, Ruleset, TaskId, WorldId } from '../core/model';
import { collectibleState } from '../core/party';
import type { CatalogSlot } from '../theme/types';
import type { AppContext } from './context';
import { artElement } from './art';
import { h } from './dom';

type Deps = Pick<AppContext, 'store' | 'theme' | 'text' | 'settle'>;

/** What the party controls need to know; null while the data has not arrived. */
export interface PartyState {
  profile: Profile;
  ruleset: Ruleset;
  owned: readonly Collectible[];
}

/** The theme's entry for a collectible, or null (reported) if the theme does not have its slot. */
export function entryOf(ctx: Pick<AppContext, 'theme'>, collectible: Collectible): CatalogSlot | null {
  const entry = ctx.theme.catalog.slots.find((slot) => slot.slot === collectible.slot);
  if (!entry) console.warn(`The theme has no collectible "${collectible.slot}"`);
  return entry ?? null;
}

/**
 * The name shown for a collectible: its nickname, or the theme's name. Slots are permanent, so a
 * slot the theme lacks is a bug: it is reported and the tier name stands in, so the screen
 * does not crash.
 */
export function nameOf(ctx: Pick<AppContext, 'theme'>, collectible: Collectible): string {
  try {
    return displayName(collectible, (slot) => {
      const entry = ctx.theme.catalog.slots.find((candidate) => candidate.slot === slot);
      if (!entry) throw new Error(`The theme has no collectible "${slot}"`);
      return entry.name;
    });
  } catch (error) {
    console.error(error);
    return ctx.theme.tiers[collectible.tier];
  }
}

/**
 * The controls that move a collectible between the party, the reserve and "pending" (SPEC.md §6),
 * shared by the vault and the home. Every move is one `arrangeParty`; nothing is deleted.
 */
export function createPartyControls(ctx: Deps, worldId: WorldId, state: () => PartyState | null) {
  const arrange = (profile: Profile, partyIds: TaskId[], toReserve: TaskId[], fromReserve: TaskId[]) => {
    ctx.settle(ctx.store.collectibles.arrangeParty(worldId, profile.id, { partyIds, toReserve, fromReserve }).settled);
  };

  return {
    /** Sends a collectible to the reserve, whether it is in the party or pending. */
    toReserve(collectible: Collectible): void {
      const current = state();
      if (!current) return;
      const party = current.profile.partyIds.filter((id) => id !== collectible.id);
      arrange(current.profile, party, [collectible.id], []);
    },

    /**
     * What can be done with a pending or reserved collectible: join the party, or, when it is
     * full, choose who leaves it. Null for a collectible already in the party.
     */
    choices(collectible: Collectible): HTMLElement | null {
      const current = state();
      if (!current || collectibleState(collectible, current.profile.partyIds) === 'party') return null;
      const { profile, ruleset, owned } = current;
      const party = profile.partyIds;
      const fromReserve = collectible.reserveAt === null ? [] : [collectible.id];
      if (party.length < ruleset.partySize) {
        return h('div', { class: 'choices' },
          h('button', { class: 'primary', onClick: () => arrange(profile, [...party, collectible.id], [], fromReserve) }, ctx.text('party.join')),
        );
      }
      const byId = new Map(owned.map((c) => [c.id, c]));
      return h('div', { class: 'choices' },
        h('p', {}, ctx.text('party.full')),
        ...party.flatMap((memberId) => {
          const member = byId.get(memberId);
          const entry = member ? entryOf(ctx, member) : null;
          if (!member || !entry) return [];
          return [
            h('button', {
              class: 'swap',
              onClick: () => arrange(profile, party.map((id) => (id === memberId ? collectible.id : id)), [memberId], fromReserve),
            }, artElement(ctx.theme, entry.art, 'swap-art'), ctx.text('party.swap', { name: nameOf(ctx, member) })),
          ];
        }),
      );
    },
  };
}
