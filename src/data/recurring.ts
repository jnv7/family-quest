import { recurringTaskId } from '../core/model';
import type { NewRecurringTask } from '../core/generation';
import { taskDefProblem } from '../core/taskDefs';
import { DataStoreError } from './DataStore';

/**
 * Why a recurring task to create is malformed, or null. Checked before anything is written,
 * by every adapter, so a bug in the caller fails loudly instead of being swallowed as an
 * expected rejection.
 */
export function newRecurringTaskProblem(task: NewRecurringTask): string | null {
  if (task.id !== recurringTaskId(task.defId, task.periodKey, task.profileId)) {
    return `Task id ${task.id} is not {defId}_{periodKey}_{profileId}`;
  }
  return taskDefProblem({ title: task.title, level: task.level, question: task.question });
}

/** A refusal that is part of normal operation when several devices generate at once (SPEC.md §10). */
export function isExpectedRecurringRejection(error: unknown): boolean {
  return error instanceof DataStoreError && (error.code === 'permission-denied' || error.code === 'already-exists');
}

/**
 * Combines the writes of one `createRecurringTasks` call: resolves when all are settled,
 * ignoring the expected rejections, and rejects with the first other failure.
 */
export async function settleRecurringWrites(writes: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(writes);
  for (const result of results) {
    if (result.status === 'rejected' && !isExpectedRecurringRejection(result.reason)) throw result.reason;
  }
}
