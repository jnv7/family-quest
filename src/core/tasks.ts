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

/**
 * The open tasks a person sees, oldest first (SPEC.md §6 and §7): every ad hoc task, and
 * only the oldest open task of each recurring definition. A second one can exist when a
 * device generated from an incomplete cache; it stays stored and shows once the first is done.
 */
export function visibleOpenTasks(tasks: readonly Task[]): Task[] {
  const oldestFirst = tasks
    .filter((task) => task.status === 'open')
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set<string>();
  return oldestFirst.filter((task) => {
    if (task.defId === null) return true;
    if (seen.has(task.defId)) return false;
    seen.add(task.defId);
    return true;
  });
}

/** The calendar day after `date`, on the calendar so a daylight saving change cannot skew it. */
function dayAfter(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * The order of the open tasks of a profile on every screen that lists them (SPEC.md §7): first
 * the tasks planned for today or for a day that has passed, then those planned for tomorrow, then
 * the new ones (`isNew`), then the rest; oldest first inside each group. Only the tasks
 * `visibleOpenTasks` keeps are listed. There is no "late" group with a name of its own (SPEC.md §2).
 */
export function sortForBoard(
  tasks: readonly Task[],
  now: Millis,
  timeZone: string,
  isNew: (task: Task) => boolean = () => false,
): Task[] {
  const today = dateKey(now, timeZone);
  const tomorrow = dayAfter(today);
  const group = (task: Task): number => {
    if (task.plan !== null && task.plan.date <= today) return 0;
    if (task.plan !== null && task.plan.date === tomorrow) return 1;
    return isNew(task) ? 2 : 3;
  };
  const visible = visibleOpenTasks(tasks); // already oldest first, and the sort is stable
  return visible.map((task, index) => ({ task, index, group: group(task) })).sort((a, b) => a.group - b.group || a.index - b.index).map(({ task }) => task);
}

/**
 * The tasks a profile finished in the last `days` days, newest first (the adults' view, SPEC.md §7.8).
 * A list to look at, never a count or a total (SPEC.md §2).
 */
export function doneRecently(tasks: readonly Task[], now: Millis, days: number): Task[] {
  const since = now - days * 86_400_000;
  return tasks
    .filter((task) => task.status === 'done' && task.doneAt !== null && task.doneAt >= since && task.doneAt <= now)
    .sort((a, b) => b.doneAt! - a.doneAt! || (a.id < b.id ? 1 : -1));
}

/**
 * Whether the active profile may retire this task (ADR 0009): an admin, any open task; otherwise the owner,
 * only an ad hoc task they created for themselves.
 */
export function canRetire(task: Task, active: Profile): boolean {
  if (task.status !== 'open') return false;
  if (isAdmin(active)) return true;
  return task.profileId === active.id && task.source === 'adhoc' && task.createdBy === active.id;
}
