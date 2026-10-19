import { describe, expect, it } from 'vitest';
import { LIMITS } from './model';
import { taskDefProblem } from './taskDefs';

describe('taskDefProblem', () => {
  it('accepts a complete valid definition and a partial change', () => {
    expect(taskDefProblem({ title: 'Tidy', cadence: 'daily', level: 'mid', assignedTo: [], question: null, big: false })).toBeNull();
    expect(taskDefProblem({ active: false })).toBeNull();
    expect(taskDefProblem({})).toBeNull();
  });

  it('refuses a title that is empty or over the limit', () => {
    expect(taskDefProblem({ title: '' })).not.toBeNull();
    expect(taskDefProblem({ title: 'x'.repeat(LIMITS.title) })).toBeNull();
    expect(taskDefProblem({ title: 'x'.repeat(LIMITS.title + 1) })).not.toBeNull();
  });

  it('refuses a question that is empty or over the limit, and accepts null', () => {
    expect(taskDefProblem({ question: null })).toBeNull();
    expect(taskDefProblem({ question: '' })).not.toBeNull();
    expect(taskDefProblem({ question: 'x'.repeat(LIMITS.question + 1) })).not.toBeNull();
  });

  it('refuses an unknown cadence or level, and a malformed list of profiles', () => {
    expect(taskDefProblem({ cadence: 'yearly' as never })).not.toBeNull();
    expect(taskDefProblem({ level: 'epic' as never })).not.toBeNull();
    expect(taskDefProblem({ assignedTo: [''] })).not.toBeNull();
  });
});
