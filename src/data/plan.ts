import { validatePlan } from '../core/plan';
import type { Millis, Plan, Task, TaskDef } from '../core/model';
import { DataStoreError } from './DataStore';

/**
 * Throws `invalid-argument` when the domain refuses the plan. Shared by the adapters, so a
 * refused plan never reaches a write. Clearing a plan (`null`) needs no check.
 */
export function assertPlanAllowed(task: Task, def: TaskDef | null, plan: Plan | null, now: Millis, timeZone: string): void {
  if (plan === null) return;
  const verdict = validatePlan(task, def, plan, now, timeZone);
  if (verdict !== 'ok') throw new DataStoreError('invalid-argument', `The plan is not allowed: ${verdict}`);
}
