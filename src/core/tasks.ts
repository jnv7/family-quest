import { isAdmin } from './access';
import { dateKey } from './calendar';
import type { Millis, Profile, ProfileId, Ruleset, Task } from './model';

export type AdhocPermission = 'allowed' | 'limit-reached' | 'not-allowed';

export interface AdhocCheck {
  /** The active profile, who would create the task. */
  creator: Profile;
  /** Who the task is for. */
  targetProfileId: ProfileId;
  /** Every task of the creator (done ones too): the limit counts what was created today. */
  creatorTasks: readonly Task[];
  now: Millis;
  ruleset: Pick<Ruleset, 'timezone' | 'childDailyTaskLimit'>;
}

/**
 * Ad hoc tasks the profile created for itself today, in the world's time zone
 * (SPEC.md §6). Tasks created by an admin for the profile do not count.
 */
export function adhocCreatedForSelfToday(
  profileId: ProfileId,
  tasks: readonly Task[],
  now: Millis,
  timeZone: string,
): number {
  const today = dateKey(now, timeZone);
  return tasks.filter(
    (task) =>
      task.source === 'adhoc' &&
      task.profileId === profileId &&
      task.createdBy === profileId &&
      dateKey(task.createdAt, timeZone) === today,
  ).length;
}

/**
 * An admin (adult profile) creates for anyone. A child creates only for
 * themselves, within the daily limit. The rules cannot count documents, so the
 * client enforces the limit (SPEC.md §5).
 */
export function adhocPermission({ creator, targetProfileId, creatorTasks, now, ruleset }: AdhocCheck): AdhocPermission {
  if (isAdmin(creator)) return 'allowed';
  if (targetProfileId !== creator.id) return 'not-allowed';
  const created = adhocCreatedForSelfToday(creator.id, creatorTasks, now, ruleset.timezone);
  return created >= ruleset.childDailyTaskLimit ? 'limit-reached' : 'allowed';
}
