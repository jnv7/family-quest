import { CADENCES, LIMITS, TIERS, type TaskDef } from './model';

/**
 * Why a task definition (or a change to one) is not acceptable, or null when it is.
 * Mirrors the field checks in `firestore.rules`, so both adapters refuse the same
 * input before anything is written.
 */
export function taskDefProblem(fields: Partial<Pick<TaskDef, 'title' | 'cadence' | 'level' | 'assignedTo' | 'question' | 'big' | 'active'>>): string | null {
  const { title, cadence, level, assignedTo, question, big, active } = fields;
  if (title !== undefined && (title.length < 1 || title.length > LIMITS.title)) {
    return `Title must have 1 to ${LIMITS.title} characters`;
  }
  if (cadence !== undefined && !CADENCES.includes(cadence)) return `Unknown cadence: ${String(cadence)}`;
  if (level !== undefined && !TIERS.includes(level)) return `Unknown level: ${String(level)}`;
  if (assignedTo !== undefined && (!Array.isArray(assignedTo) || assignedTo.some((id) => typeof id !== 'string' || id === ''))) {
    return 'assignedTo must be a list of profile ids';
  }
  if (question !== undefined && question !== null && (question.length < 1 || question.length > LIMITS.question)) {
    return `Question must have 1 to ${LIMITS.question} characters`;
  }
  if (big !== undefined && typeof big !== 'boolean') return 'big must be true or false';
  if (active !== undefined && typeof active !== 'boolean') return 'active must be true or false';
  return null;
}
