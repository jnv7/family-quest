import { activeProfileOf } from '../core/access';
import type { Collectible, Member, Profile, ProfileId, Ruleset, World, WorldId } from '../core/model';
import { pendingToReserve } from '../core/party';
import type { Unsubscribe } from '../data/DataStore';
import type { AppContext } from './context';

type Deps = Pick<AppContext, 'store' | 'clock' | 'settle'>;

/**
 * Moves the profile's old pending collectibles to the reserve, silently (SPEC.md §6). The party
 * is sent as it is, so nothing in it changes. Safe to call again: once the write is applied the
 * collectibles are no longer pending, so the next call finds nothing to do.
 */
export function moveOldPendingToReserve(
  ctx: Deps,
  worldId: WorldId,
  profile: Profile,
  collectibles: readonly Collectible[],
  ruleset: Ruleset,
): void {
  const toReserve = pendingToReserve(collectibles, profile.partyIds, ctx.clock(), ruleset);
  if (toReserve.length === 0) return;
  ctx.settle(ctx.store.collectibles.arrangeParty(worldId, profile.id, { partyIds: [...profile.partyIds], toReserve, fromReserve: [] }).settled);
}

export interface ReserveKeeper {
  /** Follows a world (or none). Calling it again with the same world does nothing. */
  follow(worldId: WorldId | null): void;
  stop(): void;
}

/**
 * Tidies the reserve when the app opens and after every profile switch, whichever screen is
 * showing: it waits for the first list of the active profile's collectibles, tidies once, and
 * stops watching it. The vault tidies again when it opens.
 */
export function createReserveKeeper(ctx: Deps & Pick<AppContext, 'uid'>): ReserveKeeper {
  let worldId: WorldId | null = null;
  let stops: Unsubscribe[] = [];
  let stopCollectibles: Unsubscribe = () => {};
  let generation = 0;

  let members: Member[] | null = null;
  let profiles: Profile[] | null = null;
  let world: World | null = null;
  let activeId: ProfileId | null = null;
  let collectibles: Collectible[] | null = null;
  let done = false;

  const ignore = () => {};

  function tidy(): void {
    if (done || worldId === null || !profiles || !world || !collectibles || activeId === null) return;
    const profile = profiles.find((candidate) => candidate.id === activeId);
    if (!profile) return;
    done = true;
    stopCollectibles();
    moveOldPendingToReserve(ctx, worldId, profile, collectibles, world.ruleset);
  }

  function refreshActive(): void {
    if (!members || !profiles || worldId === null) return;
    const id = activeProfileOf(ctx.uid, members, profiles)?.id ?? null;
    if (id === activeId) {
      tidy();
      return;
    }
    activeId = id;
    generation++;
    stopCollectibles();
    stopCollectibles = () => {};
    collectibles = null;
    done = false;
    if (id === null) return;
    const mine = generation;
    stopCollectibles = ctx.store.collectibles.observeCollectibles(
      worldId,
      id,
      (value) => {
        if (mine !== generation) return;
        collectibles = value;
        tidy();
      },
      ignore,
    );
  }

  return {
    follow(next) {
      if (next === worldId) return;
      this.stop();
      worldId = next;
      if (next === null) return;
      stops = [
        ctx.store.worlds.observeMembers(next, (value) => ((members = value), refreshActive()), ignore),
        ctx.store.worlds.observeProfiles(next, (value) => ((profiles = value), refreshActive()), ignore),
        ctx.store.worlds.observeWorld(next, (value) => ((world = value), tidy()), ignore),
      ];
    },
    stop() {
      generation++;
      for (const stop of stops) stop();
      stopCollectibles();
      stops = [];
      stopCollectibles = () => {};
      worldId = null;
      members = profiles = world = collectibles = null;
      activeId = null;
      done = false;
    },
  };
}
