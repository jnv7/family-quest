import type { ProfileId, WorldId } from '../core/model';
import type { AppContext } from './context';

/**
 * Joins `worldId` and, if `profileId` qualifies, makes it the active profile (ADR 0015 §3, §4). One mechanism for a
 * join link, a pasted link and the carry of an app added to an iPhone's home screen (ADR 0014). Resolves to where the
 * app should go next: the map when the device ends with an active profile, the picker otherwise.
 *
 * The profile is used only when all of these hold; otherwise it is ignored, with no message:
 * 1. the device has no active profile in that world (a sibling's link never switches anyone);
 * 2. the profile exists, is not archived, and, with `childOnly`, is a child profile (an adult's link would hand out
 *    admin rights directly, ADR 0003; the carry is the same device's own profile, so it passes `childOnly: false`);
 * 3. choosing it succeeds.
 *
 * With `fix`, the device is then fixed on that profile (a child's own link: no "Trocar de perfil", `isFixedOn`).
 * The carry of an app added to an iPhone's home screen is the device's own choice, so it does not fix anything.
 *
 * A failure to join (an unknown world, no connection) is thrown, for the caller to say.
 */
export async function joinAndChoose(
  ctx: AppContext,
  worldId: WorldId,
  profileId: ProfileId | null,
  options: { childOnly: boolean; fix: boolean },
): Promise<'map' | 'profiles'> {
  const { worlds } = ctx.store;
  const membership = await worlds.joinWorld(worldId);
  if (membership.profileId !== null) return 'map';
  if (profileId === null) return 'profiles';
  try {
    const profile = await worlds.getProfile(worldId, profileId);
    if (!profile || profile.archived || (options.childOnly && profile.kind !== 'child')) return 'profiles';
    await worlds.chooseProfile(worldId, profileId).settled;
    if (options.fix) ctx.world.lockProfile(worldId, profileId);
    return 'map';
  } catch (error) {
    // The shortcut only saves a tap: any trouble leaves the picker.
    console.warn('Could not choose the profile of the link', error);
    return 'profiles';
  }
}
