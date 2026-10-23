import { displayName, nicknameTooLong, normaliseNickname } from '../core/collection';
import { LIMITS, type Collectible, type Profile, type Ruleset, type TaskId, type WorldId } from '../core/model';
import { collectibleState } from '../core/party';
import { DataStoreError } from '../data/DataStore';
import type { CatalogSlot } from '../theme/types';
import type { AppContext } from './context';
import { artElement } from './art';
import { h } from './dom';

type Deps = Pick<AppContext, 'store' | 'theme' | 'text' | 'settle' | 'notify'>;

/** What the party controls need to know; null while the data has not arrived. */
export interface PartyState {
  profile: Profile;
  ruleset: Ruleset;
  owned: readonly Collectible[];
}

/** The theme's entry for a collectible, or null (reported) if the theme does not have its slot. */
export function entryOf(ctx: Pick<AppContext, 'theme'>, collectible: Pick<Collectible, 'slot'>): CatalogSlot | null {
  const entry = ctx.theme.catalog.slots.find((slot) => slot.slot === collectible.slot);
  if (!entry) console.warn(`The theme has no collectible "${collectible.slot}"`);
  return entry ?? null;
}

/**
 * The name shown for a collectible: its nickname, or the theme's name. Slots are permanent, so a
 * slot the theme lacks is a bug: it is reported and the tier name stands in, so the screen
 * does not crash.
 */
export function nameOf(ctx: Pick<AppContext, 'theme'>, collectible: Pick<Collectible, 'slot' | 'nickname' | 'tier'>): string {
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

  /** Takes a collectible from the reserve into the party, whoever owned it (ADR 0010). */
  const take = (takenId: TaskId, partyIds: TaskId[], toReserve: TaskId[], fromReserve: TaskId[]) => {
    ctx.store.collectibles.takeFromReserve(worldId, takenId, { partyIds, toReserve, fromReserve }).settled.catch((error: unknown) => {
      // Someone took it first: the server refused, and the screen already shows the reserve as it is.
      if (error instanceof DataStoreError && error.code === 'permission-denied') ctx.notify('notice.tookFirst');
      else ctx.settle(Promise.reject(error));
    });
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
     * full, choose who leaves it. Null for a collectible already in the party. With `taking`, the collectible
     * is one in the reserve that may belong to someone else, and the person takes it (ADR 0010).
     */
    choices(collectible: Pick<Collectible, 'id' | 'reserveAt'>, taking = false): HTMLElement | null {
      const current = state();
      if (!current || collectibleState(collectible, current.profile.partyIds) === 'party') return null;
      const { profile, ruleset, owned } = current;
      const party = profile.partyIds;
      const fromReserve = collectible.reserveAt === null ? [] : [collectible.id];
      const join = (partyIds: TaskId[], toReserve: TaskId[]) =>
        taking ? take(collectible.id, partyIds, toReserve, fromReserve) : arrange(profile, partyIds, toReserve, fromReserve);
      // A party above a lowered size can only lose members: nobody joins until it is back within the size.
      if (party.length > ruleset.partySize) return h('div', { class: 'choices' }, h('p', {}, ctx.text('party.overFull')));
      if (party.length < ruleset.partySize) {
        return h('div', { class: 'choices' },
          h('button', { class: 'primary', onClick: () => join([...party, collectible.id], []) }, ctx.text(collectible.reserveAt === null ? 'party.join' : 'party.bringBack')),
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
              onClick: () => join(party.map((id) => (id === memberId ? collectible.id : id)), [memberId]),
            }, artElement(ctx.theme, entry.art, 'swap-art'), ctx.text('party.swap', { name: nameOf(ctx, member) })),
          ];
        }),
      );
    },
  };
}

/**
 * The name of a collectible as a tag attached to its art, shared by the `home`, the vault and the
 * `showcase` (SPEC.md §4). The nickname is shown with the catalogue name small under it; without a
 * nickname the catalogue name is shown, and whoever may name it sees a dashed "give a name" tag.
 * Tapping the tag edits it in place: Enter or leaving the field saves, Escape cancels, and empty
 * text clears the name (back to the catalogue name). The text is limited to `LIMITS.nickname`.
 * It keeps what is being typed, so a redraw caused by incoming data does not lose it.
 */
export function createRenamer(ctx: Deps, worldId: WorldId, redraw: () => void) {
  let editing: TaskId | null = null;
  let draft = '';
  let tooLong = false;

  const stop = () => {
    editing = null;
    tooLong = false;
  };

  return {
    /** Forgets any rename in progress. */
    reset(): void {
      stop();
    },

    /**
     * `editable` is whether this person may name it (the owner, or an admin in the showcase).
     * `prompt` replaces the dashed tag's words, for example at the reveal of a new creature.
     */
    tag(collectible: Pick<Collectible, 'id' | 'slot' | 'nickname' | 'tier'>, editable: boolean, prompt?: string): HTMLElement {
      const { id, nickname } = collectible;
      const catalogue = nameOf(ctx, { ...collectible, nickname: null });
      if (editing !== id) {
        const label = nickname
          ? [h('span', { class: 'tag-name' }, nickname), h('small', { class: 'tag-catalogue' }, catalogue)]
          : [h('span', { class: 'tag-name' }, catalogue), editable ? h('small', { class: 'tag-prompt' }, prompt ?? ctx.text('collectible.giveName')) : null];
        if (!editable) return h('div', { class: 'name-tag' }, ...label);
        return h('button', {
          class: `name-tag${nickname ? '' : ' unnamed'}`,
          type: 'button',
          onClick: () => ((editing = id), (draft = nickname ?? ''), redraw()),
        }, ...label);
      }

      const input = h('input', { type: 'text', value: draft, maxLength: LIMITS.nickname, autocomplete: 'off' });
      input.addEventListener('input', () => (draft = input.value));
      let finished = false;
      const save = () => {
        if (finished) return;
        const value = normaliseNickname(input.value);
        if (nicknameTooLong(value)) {
          tooLong = true;
          redraw();
          return;
        }
        finished = true;
        stop();
        if (value !== nickname) ctx.settle(ctx.store.collectibles.setNickname(worldId, id, value).settled);
        redraw();
      };
      const cancel = () => {
        finished = true;
        stop();
        redraw();
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') cancel();
      });
      // Leaving the field saves. A field that was only replaced by a redraw is not "left".
      input.addEventListener('blur', () => queueMicrotask(() => input.isConnected && save()));
      queueMicrotask(() => input.focus());
      return h('form', {
        class: 'name-tag editing',
        onSubmit: (event: Event) => {
          event.preventDefault();
          save();
        },
      },
        h('label', {}, h('span', { class: 'visually-hidden' }, ctx.text('collectible.renameLabel')), input),
        h('small', { class: 'tag-catalogue' }, catalogue),
        tooLong ? h('p', { class: 'message', role: 'alert' }, ctx.text('collectible.renameTooLong')) : null,
      );
    },
  };
}
