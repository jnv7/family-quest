import { describe, expect, it } from 'vitest';
import { validatePlan } from './plan';
import { LIMITS, SCHEMA_VERSION, recurringTaskId, type Cadence, type PeriodKey, type Task, type TaskDef } from './model';

const ZONE = 'Europe/Lisbon';
/** Monday 10:00 in Lisbon: 2026-10-19, week 2026-W43 (ends Sunday the 25th), month 2026-10. */
const NOW = Date.parse('2026-10-19T09:00:00Z');

const def = (cadence: Cadence, big = true): TaskDef => ({
  schemaVersion: SCHEMA_VERSION,
  createdAt: 0,
  id: 'd',
  title: 'Big one',
  cadence,
  level: 'high',
  assignedTo: [],
  question: null,
  big,
  active: true,
});

const task = (periodKey: PeriodKey, over: Partial<Task> = {}): Task => ({
  schemaVersion: SCHEMA_VERSION,
  createdAt: 0,
  id: recurringTaskId('d', periodKey, 'p1'),
  profileId: 'p1',
  title: 'Big one',
  level: 'high',
  question: null,
  source: 'recurring',
  defId: 'd',
  periodKey,
  createdBy: 'p1',
  origin: 'app',
  plan: null,
  status: 'open',
  doneAt: null,
  answer: null,
  talkFlag: false,
  weekKey: null,
  ...over,
});

const plan = (date: string, trigger = 'after dinner') => ({ date, trigger });

describe('validatePlan', () => {
  const weekly = task('2026-W43');

  it('accepts today, a day in between, and the last day of a week (Sunday)', () => {
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-19'), NOW, ZONE)).toBe('ok');
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-22'), NOW, ZONE)).toBe('ok');
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-25'), NOW, ZONE)).toBe('ok');
  });

  it('refuses a day in the past, or after the last day of the week', () => {
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-18'), NOW, ZONE)).toBe('date-out-of-range');
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-26'), NOW, ZONE)).toBe('date-out-of-range');
  });

  it('accepts the last day of a month, and refuses the first of the next', () => {
    const monthly = task('2026-10');
    expect(validatePlan(monthly, def('monthly'), plan('2026-10-31'), NOW, ZONE)).toBe('ok');
    expect(validatePlan(monthly, def('monthly'), plan('2026-11-01'), NOW, ZONE)).toBe('date-out-of-range');
  });

  it('allows only today for a daily task', () => {
    const daily = task('2026-10-19');
    expect(validatePlan(daily, def('daily'), plan('2026-10-19'), NOW, ZONE)).toBe('ok');
    expect(validatePlan(daily, def('daily'), plan('2026-10-20'), NOW, ZONE)).toBe('date-out-of-range');
  });

  it('uses the day in Lisbon, not in UTC', () => {
    // 23:30 UTC on Sunday the 25th is Sunday 23:30 in Lisbon (winter time): still the last day.
    const late = Date.parse('2026-10-25T23:30:00Z');
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-25'), late, ZONE)).toBe('ok');
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-26'), late, ZONE)).toBe('date-out-of-range');
  });

  it('gives a task of a past period no day to plan', () => {
    expect(validatePlan(task('2026-W42'), def('weekly'), plan('2026-10-19'), NOW, ZONE)).toBe('date-out-of-range');
  });

  it('refuses a malformed date', () => {
    expect(validatePlan(weekly, def('weekly'), plan('next week'), NOW, ZONE)).toBe('date-out-of-range');
    expect(validatePlan(weekly, def('weekly'), plan(''), NOW, ZONE)).toBe('date-out-of-range');
  });

  it('refuses a task whose definition is not big, has no definition, or is ad hoc', () => {
    expect(validatePlan(weekly, def('weekly', false), plan('2026-10-20'), NOW, ZONE)).toBe('not-big');
    expect(validatePlan(weekly, null, plan('2026-10-20'), NOW, ZONE)).toBe('not-big');
    const adhoc = task('2026-W43', { source: 'adhoc', defId: null, periodKey: null });
    expect(validatePlan(adhoc, def('weekly'), plan('2026-10-20'), NOW, ZONE)).toBe('not-big');
  });

  it('accepts a trigger of 1 to the limit, and refuses an empty, blank or longer one', () => {
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-20', 'x'), NOW, ZONE)).toBe('ok');
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-20', 'x'.repeat(LIMITS.trigger)), NOW, ZONE)).toBe('ok');
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-20', 'x'.repeat(LIMITS.trigger + 1)), NOW, ZONE)).toBe('trigger-invalid');
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-20', ''), NOW, ZONE)).toBe('trigger-invalid');
    expect(validatePlan(weekly, def('weekly'), plan('2026-10-20', '   '), NOW, ZONE)).toBe('trigger-invalid');
  });

  it('reports a task that is not big before a bad date', () => {
    expect(validatePlan(weekly, def('weekly', false), plan('1999-01-01', ''), NOW, ZONE)).toBe('not-big');
  });
});
