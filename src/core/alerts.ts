import { dateKey } from './calendar';
import type { DateKey, Millis, Task, TaskDef } from './model';
import { visibleOpenTasks } from './tasks';

/** What the board shows on the map (SPEC.md §7.2), strongest first. Neutral: no text, no number. */
export type BoardAlert = 'due' | 'new' | 'soon';

/** The calendar day after `date`. Done on the calendar, so a daylight saving change cannot skew it. */
function nextDay(date: DateKey): DateKey {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * How one task is planned: `due` when its planned day is today or has passed, `soon` when it is
 * tomorrow, null otherwise (no plan, a plan further away, or a task that is not open).
 */
export function taskPlanAlert(task: Task, now: Millis, timeZone: string): 'due' | 'soon' | null {
  if (task.status !== 'open' || task.plan === null) return null;
  const today = dateKey(now, timeZone);
  if (task.plan.date <= today) return 'due';
  return task.plan.date === nextDay(today) ? 'soon' : null;
}

/**
 * Whether the profile has not seen this open task yet (SPEC.md §7.2): it was created after
 * `lastSeen` and is either an ad hoc task made by someone else, or the first task of a recurring
 * definition that is itself newer than `lastSeen`. Daily repeats of a known definition are not new,
 * or the alert would be lit every morning and mean nothing. With no `lastSeen` nothing is new.
 */
export function isNewTask(task: Task, defs: ReadonlyMap<string, TaskDef>, lastSeen: Millis | null): boolean {
  if (lastSeen === null || task.status !== 'open' || task.createdAt <= lastSeen) return false;
  if (task.defId === null) return task.createdBy !== task.profileId;
  const def = defs.get(task.defId);
  return def !== undefined && def.createdAt > lastSeen;
}

/**
 * The alert for the map, from the open tasks of the active profile: `due` if any is planned for
 * today or a day that has passed, then `new` if any has not been seen, then `soon` if any is
 * planned for tomorrow, otherwise null.
 */
export function boardAlert(
  tasks: readonly Task[],
  defs: ReadonlyMap<string, TaskDef>,
  now: Millis,
  timeZone: string,
  lastSeen: Millis | null,
): BoardAlert | null {
  const open = visibleOpenTasks(tasks);
  const plans = open.map((task) => taskPlanAlert(task, now, timeZone));
  if (plans.includes('due')) return 'due';
  if (open.some((task) => isNewTask(task, defs, lastSeen))) return 'new';
  return plans.includes('soon') ? 'soon' : null;
}
