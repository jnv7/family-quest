import { activeProfileOf, isAdmin } from '../core/access';
import type { Member, Profile, WorldId } from '../core/model';
import { DataStoreError } from '../data/DataStore';
import type { AppContext, Dispose } from './context';

export interface Self {
  profiles: Profile[];
  /** The device's active profile, if it has one. */
  profile: Profile | null;
  isAdmin: boolean;
}

/**
 * Watches the world's profiles and memberships and reports who this device is.
 * Reports only once both have arrived, and again on every change.
 */
export function observeSelf(ctx: AppContext, worldId: WorldId, onChange: (self: Self) => void): Dispose {
  let members: Member[] | null = null;
  let profiles: Profile[] | null = null;

  const report = () => {
    if (!members || !profiles) return;
    const profile = activeProfileOf(ctx.uid, members, profiles);
    onChange({ profiles, profile, isAdmin: isAdmin(profile) });
  };
  const onError = (error: DataStoreError) => {
    if (error.code === 'permission-denied') {
      // This device can no longer read the world (it is not a member).
      ctx.world.clear();
      ctx.go({ name: 'start' }, { replace: true });
      return;
    }
    // Anything else is about the connection or the server: keep the world and say so.
    console.error('Could not load the world', error);
    ctx.notify('notice.connection');
  };

  const stopMembers = ctx.store.worlds.observeMembers(worldId, (value) => ((members = value), report()), onError);
  const stopProfiles = ctx.store.worlds.observeProfiles(worldId, (value) => ((profiles = value), report()), onError);
  return () => {
    stopMembers();
    stopProfiles();
  };
}

/**
 * Whether this device is fixed on its active profile: it entered the world by that child's own link (ADR 0015, amended
 * in 0.10.13), so it offers no way to switch profile. A fixed device frees itself when the profile is archived or is
 * no longer the active one, so it is never left with no way out. Only clearing the app's data frees it otherwise.
 */
export function isFixedOn(ctx: AppContext, worldId: WorldId, profile: Profile | null): boolean {
  const locked = ctx.world.getLockedProfile(worldId);
  if (locked === null) return false;
  if (profile !== null && profile.id === locked && !profile.archived) return true;
  ctx.world.unlockProfile(worldId);
  return false;
}
