import { dateKey, lastDayOfPeriod } from './calendar';
import { LIMITS, type Millis, type Plan, type Task, type TaskDef } from './model';

export type PlanVerdict = 'ok' | 'not-big' | 'date-out-of-range' | 'trigger-invalid';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a plan may be set on a task (SPEC.md §6): the task comes from a big
 * definition; the day is between today and the last day of the task's period,
 * inclusive **[proposal]**; the trigger is 1 to `LIMITS.trigger` characters of free text.
 * A task of a past period has no day left, so it cannot be planned.
 */
export function validatePlan(task: Task, def: TaskDef | null, plan: Plan, now: Millis, timeZone: string): PlanVerdict {
  if (!def || !def.big || task.source !== 'recurring' || task.periodKey === null) return 'not-big';
  const today = dateKey(now, timeZone);
  const lastDay = lastDayOfPeriod(def.cadence, task.periodKey);
  // Dates are `YYYY-MM-DD`, so comparing the text compares the days.
  if (!DATE_KEY.test(plan.date) || plan.date < today || plan.date > lastDay) return 'date-out-of-range';
  if (plan.trigger.trim().length < 1 || plan.trigger.length > LIMITS.trigger) return 'trigger-invalid';
  return 'ok';
}
