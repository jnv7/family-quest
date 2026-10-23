import { dateKey, lastDayOfPeriod } from './calendar';
import { LIMITS, type Millis, type Plan, type Task, type TaskDef } from './model';

export type PlanVerdict = 'ok' | 'not-big' | 'date-out-of-range' | 'trigger-invalid';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a plan may be set on a task (SPEC.md §6): the task comes from a big
 * definition, or is a big ad hoc task; the day is today or later, and for a task of a definition
 * no later than the last day of its period, inclusive **[proposal]**; the trigger is 1 to `LIMITS.trigger` characters of free text.
 * A task of a past period has no day left, so it cannot be planned.
 */
export function validatePlan(task: Task, def: TaskDef | null, plan: Plan, now: Millis, timeZone: string): PlanVerdict {
  const today = dateKey(now, timeZone);
  // A big ad hoc task has no period: any day from today on. A task of a big definition stops at the end of its period.
  let lastDay: string | null = null;
  if (task.source === 'adhoc') {
    if (task.big !== true) return 'not-big';
  } else {
    if (!def || !def.big || task.periodKey === null) return 'not-big';
    lastDay = lastDayOfPeriod(def.cadence, task.periodKey);
  }
  // Dates are `YYYY-MM-DD`, so comparing the text compares the days.
  if (!DATE_KEY.test(plan.date) || plan.date < today || (lastDay !== null && plan.date > lastDay)) return 'date-out-of-range';
  if (plan.trigger.trim().length < 1 || plan.trigger.length > LIMITS.trigger) return 'trigger-invalid';
  return 'ok';
}
