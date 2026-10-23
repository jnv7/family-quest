import { describe, expect, it } from 'vitest';
import { boardAlert, isNewTask, taskPlanAlert } from './alerts';
import type { Task, TaskDef } from './model';

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

const NONE = new Map<string, TaskDef>();
const def = (over: Partial<TaskDef> = {}): TaskDef => ({
  schemaVersion: 1,
  createdAt: 0,
  id: 'd',
  title: 'x',
  cadence: 'daily',
  level: 'mid',
  assignedTo: [],
  question: null,
  big: false,
  active: true,
  ...over,
});
const defs = (...list: TaskDef[]) => new Map(list.map((d) => [d.id, d]));
const alert = (tasks: Task[], now = NOW, seen: number | null = null, known = NONE) => boardAlert(tasks, known, now, ZONE, seen);

describe('boardAlert', () => {
  it('is null with nothing to flag', () => {
    expect(alert([])).toBeNull();
    expect(alert([task(null)])).toBeNull();
  });

  it('is due when a task is planned for today, or its planned day has passed', () => {
    expect(alert([task('2026-10-19')])).toBe('due');
    expect(alert([task('2026-10-18')])).toBe('due');
  });

  it('is nothing when the task planned for yesterday is done', () => {
    expect(alert([task('2026-10-18', { status: 'done', doneAt: NOW })])).toBeNull();
  });

  it('is soon when the nearest plan is tomorrow, and ignores a plan further ahead', () => {
    expect(alert([task('2026-10-20'), task('2026-10-23')])).toBe('soon');
    expect(alert([task('2026-10-21')])).toBeNull();
  });

  it('puts due before new before soon', () => {
    const fresh = task(null, { source: 'adhoc', defId: null, periodKey: null, createdBy: 'mum', createdAt: 100 });
    expect(alert([task('2026-10-20'), fresh], NOW, 50)).toBe('new');
    expect(alert([task('2026-10-20'), fresh, task('2026-10-19')], NOW, 50)).toBe('due');
    expect(alert([task('2026-10-20')], NOW, 50)).toBe('soon');
  });

  it('turns over at midnight in Lisbon (winter time from 25 October 2026)', () => {
    const plans = [task('2026-10-26')];
    expect(alert(plans, Date.parse('2026-10-25T23:00:00Z'))).toBe('soon');
    expect(alert(plans, Date.parse('2026-10-26T00:00:00Z'))).toBe('due');
  });

  it('knows tomorrow across a month and a year', () => {
    expect(alert([task('2026-11-01')], Date.parse('2026-10-31T12:00:00Z'))).toBe('soon');
    expect(alert([task('2027-01-01')], Date.parse('2026-12-31T12:00:00Z'))).toBe('soon');
  });
});

describe('isNewTask', () => {
  const adhoc = (over: Partial<Task> = {}) => task(null, { source: 'adhoc', defId: null, periodKey: null, createdAt: 100, createdBy: 'mum', ...over });

  it('is new when someone else made an ad hoc task after lastSeen', () => {
    expect(isNewTask(adhoc(), NONE, 50)).toBe(true);
  });

  it('is not new when the profile made it itself', () => {
    expect(isNewTask(adhoc({ createdBy: 'p1' }), NONE, 50)).toBe(false);
  });

  it('is not new when it was there before lastSeen, or lastSeen is unknown', () => {
    expect(isNewTask(adhoc(), NONE, 100)).toBe(false);
    expect(isNewTask(adhoc(), NONE, null)).toBe(false);
  });

  it('is not new when it is done', () => {
    expect(isNewTask(adhoc({ status: 'done', doneAt: 120 }), NONE, 50)).toBe(false);
  });

  it('is new for the first task of a definition made after lastSeen, not for a daily repeat of an old one', () => {
    const recurring = task(null, { createdAt: 100 });
    expect(isNewTask(recurring, defs(def({ createdAt: 80 })), 50)).toBe(true);
    expect(isNewTask(recurring, defs(def({ createdAt: 10 })), 50)).toBe(false);
    expect(isNewTask(recurring, NONE, 50)).toBe(false); // definition not loaded yet: say nothing
  });
});

describe('taskPlanAlert', () => {
  it('reports each task on its own', () => {
    expect(taskPlanAlert(task('2026-10-19'), NOW, ZONE)).toBe('due');
    expect(taskPlanAlert(task('2026-10-15'), NOW, ZONE)).toBe('due');
    expect(taskPlanAlert(task('2026-10-20'), NOW, ZONE)).toBe('soon');
    expect(taskPlanAlert(task('2026-10-22'), NOW, ZONE)).toBeNull();
  });
});
