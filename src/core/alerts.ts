import { dateKey } from './calendar';
import type { DateKey, Millis, Task } from './model';

export type PlanAlert = 'today' | 'tomorrow';

/** The calendar day after `date`. Done on the calendar, so a daylight saving change cannot skew it. */
function nextDay(date: DateKey): DateKey {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** Whether one task is planned for today or tomorrow; a done task never is. */
export function taskPlanAlert(task: Task, now: Millis, timeZone: string): PlanAlert | null {
  if (task.status !== 'open' || task.plan === null) return null;
  const today = dateKey(now, timeZone);
  if (task.plan.date === today) return 'today';
  return task.plan.date === nextDay(today) ? 'tomorrow' : null;
}

/**
 * The alert for the map (SPEC.md §7.2), from the open tasks of the active profile:
 * `today` if any is planned for today (it wins), otherwise `tomorrow` if any is planned
 * for tomorrow, otherwise null.
 */
export function planAlert(tasks: readonly Task[], now: Millis, timeZone: string): PlanAlert | null {
  const alerts = tasks.map((task) => taskPlanAlert(task, now, timeZone));
  if (alerts.includes('today')) return 'today';
  return alerts.includes('tomorrow') ? 'tomorrow' : null;
}
