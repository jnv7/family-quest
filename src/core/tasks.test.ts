import { describe, expect, it } from 'vitest';
import type { Profile, Task } from './model';
import { adhocCreatedForSelfToday, adhocPermission, visibleOpenTasks } from './tasks';

const TZ = 'Europe/Lisbon';
const ruleset = { timezone: TZ, childDailyTaskLimit: 3 } as const;
const meta = { schemaVersion: 1, createdAt: 0 } as const;

const profile = (id: string, kind: Profile['kind']): Profile => ({
  ...meta,
  id,
  displayName: id,
  kind,
  avatar: { body: 0, hair: 0, outfit: 0, accessory: 0 },
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
