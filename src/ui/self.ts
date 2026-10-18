import { activeProfileOf, isAdmin } from '../core/access';
import type { Member, Profile, WorldId } from '../core/model';
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
  const onError = () => {
    // Lost read access (for example a world that no longer exists for this device).
    ctx.world.clear();
    ctx.go({ name: 'start' }, { replace: true });
  };

  const stopMembers = ctx.store.worlds.observeMembers(worldId, (value) => ((members = value), report()), onError);
  const stopProfiles = ctx.store.worlds.observeProfiles(worldId, (value) => ((profiles = value), report()), onError);
  return () => {
    stopMembers();
    stopProfiles();
  };
}
