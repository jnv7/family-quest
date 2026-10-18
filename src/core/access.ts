import type { Member, Profile, Uid } from './model';

/** Admin rights come from the active profile: any non-archived adult profile (SPEC.md §4). */
export function isAdmin(profile: Profile | null): boolean {
  return profile !== null && profile.kind === 'adult' && !profile.archived;
}

/** The device's active profile, or null while it has none. */
export function activeProfileOf(uid: Uid, members: readonly Member[], profiles: readonly Profile[]): Profile | null {
  const profileId = members.find((member) => member.uid === uid)?.profileId;
  if (!profileId) return null;
  return profiles.find((profile) => profile.id === profileId) ?? null;
}
