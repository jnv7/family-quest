import { periodKey } from './calendar';
import {
  recurringTaskId,
  type Millis,
  type PeriodKey,
  type Profile,
  type ProfileId,
  type Task,
  type TaskDef,
  type TaskDefId,
  type TaskId,
  type TaskLevel,
} from './model';

/** A recurring task to create: the identity of the period, and the values copied from its definition. */
export interface NewRecurringTask {
  /** `recurringTaskId(defId, periodKey, profileId)` */
  id: TaskId;
  defId: TaskDefId;
  periodKey: PeriodKey;
  profileId: ProfileId;
  title: string;
  level: TaskLevel;
  question: string | null;
}

export interface GenerationInput {
  /** The active profile. */
  profile: Profile;
  /** Every definition of the world. */
  defs: readonly TaskDef[];
  /** Every task of this profile known to the device, open and done. */
  tasks: readonly Task[];
  now: Millis;
  /** `ruleset.timezone` */
  timeZone: string;
}

/**
 * The recurring tasks to create now for the active profile, sorted by `defId`
 * (SPEC.md §6). Pure and idempotent: feeding its result back as tasks yields nothing.
 *
 * A definition yields a task for the current period only when it is active, applies to
 * the profile, has no open task for the profile (from any period), has none completed
 * in the current period, and the task's id does not exist yet.
 */
export function recurringTasksToCreate(input: GenerationInput): NewRecurringTask[] {
  const { profile, defs, now, timeZone } = input;
  if (profile.archived) return [];

  const mine = input.tasks.filter((task) => task.profileId === profile.id && task.defId !== null);
  const existingIds = new Set(mine.map((task) => task.id));

  return defs
    .filter((def) => {
      if (!def.active) return false;
      if (def.assignedTo.length > 0 && !def.assignedTo.includes(profile.id)) return false;

      const own = mine.filter((task) => task.defId === def.id);
      if (own.some((task) => task.status === 'open')) return false;

      const current = periodKey(def.cadence, now, timeZone);
      if (own.some((task) => task.doneAt !== null && periodKey(def.cadence, task.doneAt, timeZone) === current)) return false;

      return !existingIds.has(recurringTaskId(def.id, current, profile.id));
    })
    .map((def): NewRecurringTask => {
      const current = periodKey(def.cadence, now, timeZone);
      return {
        id: recurringTaskId(def.id, current, profile.id),
        defId: def.id,
        periodKey: current,
        profileId: profile.id,
        title: def.title,
        level: def.level,
        question: def.question,
      };
    })
    .sort((a, b) => (a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0));
}
