import { describe, expect, it } from 'vitest';
import { recurringTasksToCreate } from './generation';
import {
  DEFAULT_AVATAR,
  SCHEMA_VERSION,
  recurringTaskId,
  type Cadence,
  type Millis,
  type PeriodKey,
  type Profile,
  type Task,
  type TaskDef,
} from './model';

const ZONE = 'Europe/Lisbon';
/** Monday 10:00 in Lisbon: date 2026-10-19, week 2026-W43, month 2026-10. */
const NOW = Date.parse('2026-10-19T09:00:00Z');

const profile = (id: string, overrides: Partial<Profile> = {}): Profile => ({
  schemaVersion: SCHEMA_VERSION,
  createdAt: 0,
  id,
  displayName: id,
  kind: 'child',
  avatar: { ...DEFAULT_AVATAR },
  partyIds: [],
  archived: false,
  ...overrides,
});

const p1 = profile('p1');

const def = (id: string, cadence: Cadence, overrides: Partial<TaskDef> = {}): TaskDef => ({
  schemaVersion: SCHEMA_VERSION,
  createdAt: 0,
  id,
  title: `Title of ${id}`,
  cadence,
  level: 'mid',
  assignedTo: [],
  question: null,
  big: false,
  active: true,
  ...overrides,
});

const recurring = (defId: string, key: PeriodKey, state: { done: Millis } | 'open', profileId = 'p1'): Task => ({
  schemaVersion: SCHEMA_VERSION,
  createdAt: 0,
  id: recurringTaskId(defId, key, profileId),
  profileId,
  title: 'old',
  level: 'mid',
  question: null,
  source: 'recurring',
  defId,
  periodKey: key,
  createdBy: profileId,
  origin: 'app',
  plan: null,
  status: state === 'open' ? 'open' : 'done',
  doneAt: state === 'open' ? null : state.done,
  answer: null,
  talkFlag: false,
  weekKey: null,
});

const retired = (defId: string, key: PeriodKey): Task => ({ ...recurring(defId, key, 'open'), status: 'retired' });

const adhoc = (): Task => ({ ...recurring('x', 'k', 'open'), id: 'adhoc1', source: 'adhoc', defId: null, periodKey: null });

const ids = (defs: TaskDef[], tasks: Task[] = [], overrides: { profile?: Profile; now?: Millis } = {}) =>
  recurringTasksToCreate({ profile: overrides.profile ?? p1, defs, tasks, now: overrides.now ?? NOW, timeZone: ZONE }).map((t) => t.id);

describe('recurringTasksToCreate', () => {
  const daily = def('daily', 'daily');

  it('does not generate a task retired in the current period again, but does in the next one', () => {
    const today = retired('daily', '2026-10-19');
    expect(ids([daily], [today])).toEqual([]);
    expect(ids([daily], [today], { now: NOW + 24 * 3_600_000 })).toEqual(['daily_2026-10-20_p1']);
  });

  it('generates the current period when an older task was retired', () => {
    expect(ids([daily], [retired('daily', '2026-10-18')])).toEqual(['daily_2026-10-19_p1']);
  });

  it('1. creates today’s task for a daily definition', () => {
    expect(ids([daily])).toEqual(['daily_2026-10-19_p1']);
  });

  it('2. creates nothing while an older task of the definition is open', () => {
    expect(ids([daily], [recurring('daily', '2026-10-17', 'open')])).toEqual([]);
  });

  it('3. an overdue task completed today covers today', () => {
    expect(ids([daily], [recurring('daily', '2026-10-17', { done: Date.parse('2026-10-19T08:00:00Z') })])).toEqual([]);
  });

  it('4. a task completed yesterday evening does not cover today', () => {
    // 20:00Z is 21:00 in Lisbon on the 18th (summer time).
    expect(ids([daily], [recurring('daily', '2026-10-17', { done: Date.parse('2026-10-18T20:00:00Z') })])).toEqual([
      'daily_2026-10-19_p1',
    ]);
  });

  it('5. is idempotent: today’s task, done today, is not created again', () => {
    expect(ids([daily], [recurring('daily', '2026-10-19', { done: Date.parse('2026-10-19T08:00:00Z') })])).toEqual([]);
  });

  it('6. creates this week’s task for a weekly definition', () => {
    expect(ids([def('weekly', 'weekly')])).toEqual(['weekly_2026-W43_p1']);
  });

  it('7. a weekly task from last week, completed this week, covers this week', () => {
    expect(ids([def('weekly', 'weekly')], [recurring('weekly', '2026-W42', { done: Date.parse('2026-10-19T08:00:00Z') })])).toEqual([]);
  });

  it('8. creates this month’s task for a monthly definition', () => {
    expect(ids([def('monthly', 'monthly')])).toEqual(['monthly_2026-10_p1']);
  });

  it('9. ignores an inactive definition', () => {
    expect(ids([def('daily', 'daily', { active: false })])).toEqual([]);
  });

  it('10. ignores a definition assigned to someone else', () => {
    expect(ids([def('daily', 'daily', { assignedTo: ['p2'] })])).toEqual([]);
  });

  it('11. creates for a profile named among several', () => {
    expect(ids([def('daily', 'daily', { assignedTo: ['p1', 'p2'] })])).toEqual(['daily_2026-10-19_p1']);
  });

  it('12. creates nothing for an archived profile', () => {
    expect(ids([daily], [], { profile: profile('p1', { archived: true }) })).toEqual([]);
  });

  it('13. sorts by definition id', () => {
    expect(ids([def('b', 'daily'), def('a', 'weekly')])).toEqual(['a_2026-W43_p1', 'b_2026-10-19_p1']);
  });

  it('14. does not count ad hoc tasks', () => {
    expect(ids([daily], [adhoc()])).toEqual(['daily_2026-10-19_p1']);
  });

  it('copies the title, level and question of the definition', () => {
    const [task] = recurringTasksToCreate({
      profile: p1,
      defs: [def('d', 'daily', { title: 'Feed the cat', level: 'high', question: 'Did you?' })],
      tasks: [],
      now: NOW,
      timeZone: ZONE,
    });
    expect(task).toEqual({
      id: 'd_2026-10-19_p1',
      defId: 'd',
      periodKey: '2026-10-19',
      profileId: 'p1',
      title: 'Feed the cat',
      level: 'high',
      question: 'Did you?',
    });
  });

  it('does not count tasks of another profile', () => {
    expect(ids([daily], [recurring('daily', '2026-10-17', 'open', 'p2')])).toEqual(['daily_2026-10-19_p1']);
  });

  it('does not create a task whose id already exists', () => {
    // Completed by a device whose clock was a day behind: the period check alone would not see it.
    expect(ids([daily], [recurring('daily', '2026-10-19', { done: Date.parse('2026-10-18T10:00:00Z') })])).toEqual([]);
  });

  it('feeding the result back as tasks yields nothing', () => {
    const first = recurringTasksToCreate({ profile: p1, defs: [daily, def('w', 'weekly')], tasks: [], now: NOW, timeZone: ZONE });
    const created = first.map((t) => recurring(t.defId, t.periodKey, 'open'));
    expect(ids([daily, def('w', 'weekly')], created)).toEqual([]);
  });

  describe('the turn of the week in Lisbon (winter time)', () => {
    it('is still week 43 on Sunday 23:30', () => {
      expect(ids([def('weekly', 'weekly')], [], { now: Date.parse('2026-10-25T23:30:00Z') })).toEqual(['weekly_2026-W43_p1']);
    });

    it('is week 44 from Monday 00:00', () => {
      expect(ids([def('weekly', 'weekly')], [], { now: Date.parse('2026-10-26T00:00:00Z') })).toEqual(['weekly_2026-W44_p1']);
    });
  });
});
