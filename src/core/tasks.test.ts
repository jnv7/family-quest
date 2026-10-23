import { describe, expect, it } from 'vitest';
import type { Profile, Task } from './model';
import { adhocCreatedForSelfToday, adhocPermission, canRetire, doneRecently, sortForBoard, visibleOpenTasks } from './tasks';

const TZ = 'Europe/Lisbon';
const ruleset = { timezone: TZ, childDailyTaskLimit: 3 } as const;
const meta = { schemaVersion: 1, createdAt: 0 } as const;

const profile = (id: string, kind: Profile['kind']): Profile => ({
  ...meta,
  id,
  displayName: id,
  kind,
  avatar: { body: 0, hair: 0, outfit: 0, accessory: 0, symbol: null },
  partyIds: [],
  archived: false,
});

let counter = 0;
const task = (over: Partial<Task>): Task => ({
  ...meta,
  id: `t${counter++}`,
  profileId: 'kid',
  title: 'x',
  level: 'mid',
  question: null,
  source: 'adhoc',
  defId: null,
  periodKey: null,
  createdBy: 'kid',
  origin: 'app',
  plan: null,
  status: 'open',
  doneAt: null,
  answer: null,
  talkFlag: false,
  weekKey: null,
  ...over,
});

const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-10-20T12:00:00Z');
const kid = profile('kid', 'child');

describe('adhocCreatedForSelfToday', () => {
  it('counts only what the profile created for itself today', () => {
    const tasks = [
      task({ createdAt: NOW - 1000 }),
      task({ createdAt: NOW - 2000, status: 'done' }), // done tasks still count
      task({ createdAt: NOW - 3000, createdBy: 'mum' }), // created by an admin
      task({ createdAt: NOW - 86_400_000 }), // yesterday
      task({ createdAt: NOW - 1000, source: 'recurring' }),
      task({ createdAt: NOW - 1000, profileId: 'sibling' }),
    ];
    expect(adhocCreatedForSelfToday('kid', tasks, NOW, TZ)).toBe(2);
  });

  it('follows the Lisbon calendar day, not UTC', () => {
    // 23:30Z on 24 October is 00:30 on the 25th in Lisbon (summer time ends later that night).
    const justAfterMidnight = task({ createdAt: at('2026-10-24T23:30:00Z') });
    expect(adhocCreatedForSelfToday('kid', [justAfterMidnight], at('2026-10-25T12:00:00Z'), TZ)).toBe(1);
    expect(adhocCreatedForSelfToday('kid', [justAfterMidnight], at('2026-10-24T12:00:00Z'), TZ)).toBe(0);
  });

  it('starts a new day at Lisbon midnight', () => {
    const evening = task({ createdAt: at('2026-10-20T22:59:00Z') }); // 23:59 in Lisbon
    expect(adhocCreatedForSelfToday('kid', [evening], at('2026-10-20T22:59:30Z'), TZ)).toBe(1);
    expect(adhocCreatedForSelfToday('kid', [evening], at('2026-10-20T23:00:00Z'), TZ)).toBe(0); // 00:00 next day
  });
});

describe('adhocPermission', () => {
  const check = (over: object) =>
    adhocPermission({ creator: kid, targetProfileId: 'kid', creatorTasks: [], now: NOW, ruleset, ...over });

  it('lets an adult create for anyone, with no limit', () => {
    const many = Array.from({ length: 10 }, () => task({ createdBy: 'mum', profileId: 'mum', createdAt: NOW }));
    expect(check({ creator: profile('mum', 'adult'), targetProfileId: 'kid', creatorTasks: many })).toBe('allowed');
    expect(check({ creator: profile('mum', 'adult'), targetProfileId: 'mum', creatorTasks: many })).toBe('allowed');
  });

  it('follows the one definition of admin: an archived adult profile is not an admin', () => {
    const archived = { ...profile('mum', 'adult'), archived: true };
    expect(check({ creator: archived, targetProfileId: 'kid' })).toBe('not-allowed');
  });

  it('lets a child create for itself under the limit', () => {
    const two = [task({ createdAt: NOW }), task({ createdAt: NOW })];
    expect(check({ creatorTasks: two })).toBe('allowed');
  });

  it('stops a child at the limit, and allows again the next day', () => {
    const three = [task({ createdAt: NOW }), task({ createdAt: NOW }), task({ createdAt: NOW })];
    expect(check({ creatorTasks: three })).toBe('limit-reached');
    expect(check({ creatorTasks: three, now: NOW + 86_400_000 })).toBe('allowed');
  });

  it('does not count the tasks an admin created for the child', () => {
    const fromAdmin = Array.from({ length: 5 }, () => task({ createdBy: 'mum', createdAt: NOW }));
    expect(check({ creatorTasks: fromAdmin })).toBe('allowed');
  });

  it('never lets a child create for someone else', () => {
    expect(check({ targetProfileId: 'mum' })).toBe('not-allowed');
  });

  it('uses the limit from the ruleset', () => {
    const one = [task({ createdAt: NOW })];
    expect(check({ creatorTasks: one, ruleset: { timezone: TZ, childDailyTaskLimit: 1 } })).toBe('limit-reached');
  });
});

describe('visibleOpenTasks', () => {
  const recurring = (id: string, defId: string, createdAt: number, over: Partial<Task> = {}) =>
    task({ id, defId, periodKey: 'p', source: 'recurring', createdAt, ...over });

  it('shows only the oldest open task of a definition, and every ad hoc task, oldest first', () => {
    const tasks = [
      recurring('newer', 'd1', 30),
      task({ id: 'adhoc-late', createdAt: 40 }),
      recurring('older', 'd1', 10),
      task({ id: 'adhoc-early', createdAt: 20 }),
      recurring('other', 'd2', 25),
    ];
    expect(visibleOpenTasks(tasks).map((t) => t.id)).toEqual(['older', 'adhoc-early', 'other', 'adhoc-late']);
  });

  it('ignores done tasks, so the next one of a definition shows once the oldest is done', () => {
    const tasks = [recurring('first', 'd1', 10, { status: 'done', doneAt: 15 }), recurring('second', 'd1', 20)];
    expect(visibleOpenTasks(tasks).map((t) => t.id)).toEqual(['second']);
  });

  it('breaks a tie in creation time by id, so every device picks the same task', () => {
    const tasks = [recurring('b', 'd1', 10), recurring('a', 'd1', 10)];
    expect(visibleOpenTasks(tasks).map((t) => t.id)).toEqual(['a']);
  });
});

describe('sortForBoard', () => {
  const NOW = Date.parse('2026-10-20T10:00:00Z'); // 2026-10-20 in Lisbon
  const planned = (date: string) => ({ date, trigger: 'x' });
  const ids = (tasks: Task[]) => tasks.map((t) => t.title);

  it('puts today and past plans first, then tomorrow, then new, then the rest, oldest first inside each', () => {
    const tasks = [
      task({ title: 'rest-old', createdAt: 1 }),
      task({ title: 'tomorrow', createdAt: 2, plan: planned('2026-10-21') }),
      task({ title: 'new', createdAt: 3 }),
      task({ title: 'past', createdAt: 4, plan: planned('2026-10-18') }),
      task({ title: 'today', createdAt: 5, plan: planned('2026-10-20') }),
      task({ title: 'rest-new', createdAt: 6 }),
    ];
    const sorted = sortForBoard(tasks, NOW, TZ, (t) => t.title === 'new');
    expect(ids(sorted)).toEqual(['past', 'today', 'tomorrow', 'new', 'rest-old', 'rest-new']);
  });

  it('ignores plans further away, done tasks and a second open task of a definition', () => {
    const tasks = [
      task({ title: 'far', createdAt: 1, plan: planned('2026-10-25') }),
      task({ title: 'done', createdAt: 2, status: 'done' }),
      task({ title: 'first', createdAt: 3, defId: 'd1', periodKey: 'a' }),
      task({ title: 'second', createdAt: 4, defId: 'd1', periodKey: 'b' }),
    ];
    expect(ids(sortForBoard(tasks, NOW, TZ))).toEqual(['far', 'first']);
  });

  it('uses the day in Lisbon, not in UTC', () => {
    const lateEvening = Date.parse('2026-10-20T23:30:00Z'); // 2026-10-21 00:30 in Lisbon (UTC+1)
    const tasks = [task({ title: 'later', createdAt: 1 }), task({ title: 'today', createdAt: 2, plan: planned('2026-10-21') })];
    expect(ids(sortForBoard(tasks, lateEvening, TZ))).toEqual(['today', 'later']);
  });
});

describe('doneRecently', () => {
  const DAY = 86_400_000;
  const done = (title: string, doneAt: number) => task({ title, status: 'done', doneAt, weekKey: '2026-W43' });

  it('lists what was finished in the last days, newest first, and nothing else', () => {
    const tasks = [
      done('old', NOW - 8 * DAY),
      done('week', NOW - 6 * DAY),
      done('today', NOW - 1000),
      task({ title: 'open' }),
      done('future', NOW + DAY),
    ];
    expect(doneRecently(tasks, NOW, 7).map((t) => t.title)).toEqual(['today', 'week']);
  });
});

describe('canRetire', () => {
  const adult = profile('mum', 'adult');
  const own = task({ createdBy: 'kid' });

  it('lets an admin retire any open task', () => {
    expect(canRetire(own, adult)).toBe(true);
    expect(canRetire(task({ source: 'recurring', defId: 'd', periodKey: 'k' }), adult)).toBe(true);
    expect(canRetire(task({ profileId: 'mum', createdBy: 'mum' }), adult)).toBe(true);
  });

  it('does not let an archived adult retire', () => {
    expect(canRetire(own, { ...adult, archived: true })).toBe(false);
  });

  it('lets a child retire only an ad hoc task they made for themselves', () => {
    expect(canRetire(own, kid)).toBe(true);
    expect(canRetire(task({ createdBy: 'mum' }), kid)).toBe(false);
    expect(canRetire(task({ source: 'recurring', defId: 'd', periodKey: 'k' }), kid)).toBe(false);
    expect(canRetire(task({ profileId: 'other', createdBy: 'other' }), kid)).toBe(false);
  });

  it('is false for a done or retired task', () => {
    expect(canRetire(task({ status: 'done', doneAt: NOW }), adult)).toBe(false);
    expect(canRetire(task({ status: 'retired' }), adult)).toBe(false);
  });
});

describe('retired tasks', () => {
  it('are neither open nor done in the lists', () => {
    const retired = task({ status: 'retired', retiredAt: NOW, retiredBy: 'mum' });
    expect(visibleOpenTasks([retired])).toEqual([]);
    expect(sortForBoard([retired], NOW, TZ, () => false)).toEqual([]);
    expect(doneRecently([retired], NOW, 7)).toEqual([]);
  });
});
