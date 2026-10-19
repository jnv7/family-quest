import { describe, expect, it } from 'vitest';
import { planAlert, taskPlanAlert } from './alerts';
import type { Task } from './model';

const ZONE = 'Europe/Lisbon';
/** Monday 10:00 in Lisbon: today is 2026-10-19. */
const NOW = Date.parse('2026-10-19T09:00:00Z');

let counter = 0;
const task = (planDate: string | null, over: Partial<Task> = {}): Task => ({
  schemaVersion: 1,
  createdAt: 0,
  id: `t${counter++}`,
  profileId: 'p1',
  title: 'Big one',
  level: 'high',
  question: null,
  source: 'recurring',
  defId: 'd',
  periodKey: '2026-W43',
  createdBy: 'p1',
  origin: 'app',
  plan: planDate === null ? null : { date: planDate, trigger: 'after dinner' },
  status: 'open',
  doneAt: null,
  answer: null,
  talkFlag: false,
  weekKey: null,
  ...over,
});

describe('planAlert', () => {
  it('is null with no plans', () => {
    expect(planAlert([], NOW, ZONE)).toBeNull();
    expect(planAlert([task(null)], NOW, ZONE)).toBeNull();
  });

  it('is today when a task is planned for today', () => {
    expect(planAlert([task('2026-10-19')], NOW, ZONE)).toBe('today');
  });

  it('is tomorrow when the nearest plan is tomorrow', () => {
    expect(planAlert([task('2026-10-20'), task('2026-10-23')], NOW, ZONE)).toBe('tomorrow');
  });

  it('prefers today when both are planned', () => {
    expect(planAlert([task('2026-10-20'), task('2026-10-19')], NOW, ZONE)).toBe('today');
  });

  it('ignores a plan further ahead, or in the past', () => {
    expect(planAlert([task('2026-10-21'), task('2026-10-18')], NOW, ZONE)).toBeNull();
  });

  it('ignores a done task', () => {
    expect(planAlert([task('2026-10-19', { status: 'done', doneAt: NOW })], NOW, ZONE)).toBeNull();
  });

  it('turns over at midnight in Lisbon (winter time from 25 October 2026)', () => {
    const plans = [task('2026-10-26')];
    expect(planAlert(plans, Date.parse('2026-10-25T23:00:00Z'), ZONE)).toBe('tomorrow');
    expect(planAlert(plans, Date.parse('2026-10-26T00:00:00Z'), ZONE)).toBe('today');
  });

  it('knows tomorrow across a month and a year', () => {
    expect(planAlert([task('2026-11-01')], Date.parse('2026-10-31T12:00:00Z'), ZONE)).toBe('tomorrow');
    expect(planAlert([task('2027-01-01')], Date.parse('2026-12-31T12:00:00Z'), ZONE)).toBe('tomorrow');
  });
});

describe('taskPlanAlert', () => {
  it('reports each task on its own', () => {
    expect(taskPlanAlert(task('2026-10-19'), NOW, ZONE)).toBe('today');
    expect(taskPlanAlert(task('2026-10-20'), NOW, ZONE)).toBe('tomorrow');
    expect(taskPlanAlert(task('2026-10-22'), NOW, ZONE)).toBeNull();
  });
});
