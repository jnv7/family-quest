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
