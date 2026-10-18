/**
 * Tests for firebase/firestore.rules (SPEC.md §5 and §11).
 * Run with `npm run test:rules` (needs the Firestore emulator, hence Java; CI runs it).
 */
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const W = 'world0000000000000000000001'; // 27 chars, valid world id
const now = Timestamp.fromMillis(Date.UTC(2026, 9, 18, 12));
const meta = { schemaVersion: 1, createdAt: now };

const ruleset = {
  partySize: 5,
  showcaseSize: 30,
  childDailyTaskLimit: 3,
  timezone: 'Europe/Lisbon',
  weekStartsOn: 1,
  openingDay: 7,
  pendingDays: 1,
  tierOdds: { low: { low: 80, mid: 17, high: 3 }, mid: { low: 65, mid: 25, high: 10 }, high: { low: 45, mid: 35, high: 20 } },
  guarantee: null,
};

// Devices
const ADMIN = 'uid-admin'; // world creator, profile pAdult
const ADMIN2 = 'uid-admin2'; // promoted admin, profile pAdult2
const CHILD = 'uid-child'; // profile pChild
const CHILD2 = 'uid-child2'; // profile pChild2
const FRESH = 'uid-fresh'; // member without a profile yet
const STRANGER = 'uid-stranger'; // not a member

let env: RulesTestEnvironment;

const p = (...segments: string[]) => ['worlds', W, ...segments].join('/');
const as = (uid: string): Firestore => env.authenticatedContext(uid).firestore() as unknown as Firestore;
const anonymous = (): Firestore => env.unauthenticatedContext().firestore() as unknown as Firestore;

function profile(displayName: string, kind: 'adult' | 'child', extra: Record<string, unknown> = {}) {
  return { displayName, kind, avatar: { body: 0, hair: 0, outfit: 0, accessory: 0 }, partyIds: [], archived: false, ...meta, ...extra };
}

function taskDef(extra: Record<string, unknown> = {}) {
  return { title: 'Daily chore', cadence: 'daily', level: 'mid', assignedTo: [], question: null, big: false, active: true, ...meta, ...extra };
}

function openTask(profileId: string, extra: Record<string, unknown> = {}) {
  return {
    profileId,
    title: 'Ad hoc chore',
    level: 'mid',
    question: null,
    source: 'adhoc',
    defId: null,
    periodKey: null,
    createdBy: profileId,
    origin: 'app',
    plan: null,
    status: 'open',
    doneAt: null,
    answer: null,
    talkFlag: false,
    weekKey: null,
    ...meta,
    ...extra,
  };
}

function recurringTask(defId: string, periodKey: string, profileId: string, extra: Record<string, unknown> = {}) {
  return openTask(profileId, { source: 'recurring', defId, periodKey, title: 'Daily chore', ...extra });
}

const completion = { status: 'done', doneAt: now, answer: null, talkFlag: false, weekKey: '2026-W42' };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-family-quest',
    firestore: { rules: readFileSync('firebase/firestore.rules', 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    const seed: Array<[string, Record<string, unknown>]> = [
      [p(), { name: 'Test world', themeId: 'minimal', createdBy: ADMIN, ruleset, ...meta }],
      [p('members', ADMIN), { role: 'admin', profileId: 'pAdult', ...meta }],
      [p('members', ADMIN2), { role: 'admin', profileId: 'pAdult2', ...meta }],
      [p('members', CHILD), { role: 'child', profileId: 'pChild', ...meta }],
      [p('members', CHILD2), { role: 'child', profileId: 'pChild2', ...meta }],
      [p('members', FRESH), { role: 'child', profileId: null, ...meta }],
      [p('profiles', 'pAdult'), profile('Adult', 'adult')],
      [p('profiles', 'pAdult2'), profile('Adult two', 'adult')],
      [p('profiles', 'pChild'), profile('Child', 'child')],
      [p('profiles', 'pChild2'), profile('Child two', 'child')],
      [p('profiles', 'pArchived'), profile('Archived', 'child', { archived: true })],
      [p('taskDefs', 'defDaily'), taskDef()],
      [p('taskDefs', 'defInactive'), taskDef({ active: false })],
      [p('taskDefs', 'defChild2'), taskDef({ assignedTo: ['pChild2'] })],
      [p('taskDefs', 'defBig'), taskDef({ cadence: 'weekly', big: true })],
      [p('tasks', 'tChildOpen'), openTask('pChild')],
      [p('tasks', 'tChildQuestion'), openTask('pChild', { question: 'Did you do it well?' })],
      [p('tasks', 'tChildDone'), openTask('pChild', completion)],
      [p('tasks', 'defDaily_2026-10-17_pChild'), recurringTask('defDaily', '2026-10-17', 'pChild', completion)],
      [p('tasks', 'defBig_2026-W42_pChild'), recurringTask('defBig', '2026-W42', 'pChild')],
      [p('tasks', 'tAdultOpen'), openTask('pAdult')],
      [p('rewards', 'tChildDone'), { profileId: 'pChild', weekKey: '2026-W42', tier: 'mid', openedAt: null, ...meta }],
    ];
    for (const [path, data] of seed) await setDoc(doc(db, path), data);
  });
});

// ---------------------------------------------------------------------------

describe('membership and reading', () => {
  it('a non-member reads nothing', async () => {
    const db = as(STRANGER);
    await assertFails(getDoc(doc(db, p())));
    await assertFails(getDoc(doc(db, p('profiles', 'pChild'))));
    await assertFails(getDoc(doc(db, p('tasks', 'tChildOpen'))));
    await assertFails(getDoc(doc(db, p('collectibles', 'any'))));
  });

  it('an unauthenticated client reads nothing', async () => {
    await assertFails(getDoc(doc(anonymous(), p())));
  });

  it('a member reads the world, profiles and task definitions', async () => {
    const db = as(CHILD);
    await assertSucceeds(getDoc(doc(db, p())));
    await assertSucceeds(getDoc(doc(db, p('profiles', 'pAdult'))));
    await assertSucceeds(getDoc(doc(db, p('taskDefs', 'defDaily'))));
  });

  it("a child reads its own tasks but not another profile's", async () => {
    const db = as(CHILD);
    await assertSucceeds(getDoc(doc(db, p('tasks', 'tChildOpen'))));
    await assertSucceeds(getDocs(query(collection(db, p('tasks')), where('profileId', '==', 'pChild'))));
    await assertFails(getDoc(doc(db, p('tasks', 'tAdultOpen'))));
    await assertFails(getDocs(query(collection(db, p('tasks')), where('profileId', '==', 'pAdult'))));
  });

  it("an admin reads every profile's tasks", async () => {
    await assertSucceeds(getDocs(query(collection(as(ADMIN), p('tasks')), where('profileId', '==', 'pChild'))));
  });
});

describe('worlds', () => {
  const NEW_W = 'world0000000000000000000002';
  const newWorld = (createdBy: string) => ({ name: 'New world', themeId: 'minimal', createdBy, ruleset, ...meta });

  it('a device creates a world and its own admin membership in one batch', async () => {
    const db = as(STRANGER);
    const batch = writeBatch(db);
    batch.set(doc(db, 'worlds', NEW_W), newWorld(STRANGER));
    batch.set(doc(db, 'worlds', NEW_W, 'members', STRANGER), { role: 'admin', profileId: null, ...meta });
    await assertSucceeds(batch.commit());
  });

  it('rejects a world created on behalf of someone else', async () => {
    await assertFails(setDoc(doc(as(STRANGER), 'worlds', NEW_W), newWorld(ADMIN)));
  });

  it('rejects a world id shorter than 24 characters', async () => {
    await assertFails(setDoc(doc(as(STRANGER), 'worlds', 'short'), newWorld(STRANGER)));
  });

  it('an admin renames the world but cannot change its theme', async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN2), p()), { name: 'Renamed' }));
    await assertFails(updateDoc(doc(as(ADMIN), p()), { themeId: 'other' }));
    await assertFails(updateDoc(doc(as(CHILD), p()), { name: 'Renamed' }));
  });

  it('nobody deletes a world', async () => {
    await assertFails(deleteDoc(doc(as(ADMIN), p())));
  });
});

describe('members', () => {
  it('a device joins as child with no profile', async () => {
    await assertSucceeds(setDoc(doc(as(STRANGER), p('members', STRANGER)), { role: 'child', profileId: null, ...meta }));
  });

  it('a joining device cannot make itself admin, pick a profile at creation, or join for someone else', async () => {
    const db = as(STRANGER);
    await assertFails(setDoc(doc(db, p('members', STRANGER)), { role: 'admin', profileId: null, ...meta }));
    await assertFails(setDoc(doc(db, p('members', STRANGER)), { role: 'child', profileId: 'pChild', ...meta }));
    await assertFails(setDoc(doc(db, p('members', 'uid-other')), { role: 'child', profileId: null, ...meta }));
  });

  it('cannot join a world that does not exist', async () => {
    const db = as(STRANGER);
    await assertFails(setDoc(doc(db, 'worlds', 'world0000000000000000000099', 'members', STRANGER), { role: 'child', profileId: null, ...meta }));
  });

  it('a device chooses and switches its own profile (Netflix-style)', async () => {
    await assertSucceeds(updateDoc(doc(as(FRESH), p('members', FRESH)), { profileId: 'pChild2' }));
    await assertSucceeds(updateDoc(doc(as(CHILD), p('members', CHILD)), { profileId: 'pAdult' }));
  });

  it('a device cannot choose an archived or missing profile, nor change its own role', async () => {
    const db = as(FRESH);
    await assertFails(updateDoc(doc(db, p('members', FRESH)), { profileId: 'pArchived' }));
    await assertFails(updateDoc(doc(db, p('members', FRESH)), { profileId: 'missing' }));
    await assertFails(updateDoc(doc(db, p('members', FRESH)), { role: 'admin' }));
  });

  it("a device cannot change another device's profile", async () => {
    await assertFails(updateDoc(doc(as(CHILD), p('members', CHILD2)), { profileId: 'pChild' }));
  });

  it('an admin promotes a device, but nobody demotes the world creator', async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN), p('members', CHILD)), { role: 'admin' }));
    await assertFails(updateDoc(doc(as(ADMIN2), p('members', ADMIN)), { role: 'child' }));
    await assertFails(updateDoc(doc(as(CHILD2), p('members', CHILD2)), { role: 'admin' }));
  });

  it('nobody deletes a member', async () => {
    await assertFails(deleteDoc(doc(as(ADMIN), p('members', CHILD))));
  });
});

describe('profiles', () => {
  it('only an admin creates profiles', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), p('profiles', 'pNew')), profile('New', 'child')));
    await assertFails(setDoc(doc(as(CHILD), p('profiles', 'pNew2')), profile('New', 'child')));
  });

  it('an admin archives a profile; nobody deletes one', async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN), p('profiles', 'pChild2')), { archived: true }));
    await assertFails(deleteDoc(doc(as(ADMIN), p('profiles', 'pChild2'))));
  });

  it('the owner changes only avatar and party of its own profile', async () => {
    const db = as(CHILD);
    await assertSucceeds(updateDoc(doc(db, p('profiles', 'pChild')), { avatar: { body: 1, hair: 2, outfit: 0, accessory: 0 } }));
    await assertSucceeds(updateDoc(doc(db, p('profiles', 'pChild')), { partyIds: ['a', 'b'] }));
    await assertFails(updateDoc(doc(db, p('profiles', 'pChild')), { displayName: 'Changed' }));
    await assertFails(updateDoc(doc(db, p('profiles', 'pChild2')), { partyIds: ['a'] }));
  });

  it('the party cannot exceed the ruleset size', async () => {
    await assertFails(updateDoc(doc(as(CHILD), p('profiles', 'pChild')), { partyIds: ['a', 'b', 'c', 'd', 'e', 'f'] }));
  });
});

describe('task definitions', () => {
  it('only an admin writes task definitions', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), p('taskDefs', 'defNew')), taskDef()));
    await assertFails(setDoc(doc(as(CHILD), p('taskDefs', 'defNew2')), taskDef()));
    await assertFails(updateDoc(doc(as(CHILD), p('taskDefs', 'defDaily')), { active: false }));
  });
});

describe('creating tasks', () => {
  it('an admin creates an ad hoc task for any profile', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), p('tasks', 'tNew')), openTask('pChild', { createdBy: 'pAdult' })));
  });

  it('a child creates an ad hoc task only for itself', async () => {
    const db = as(CHILD);
    await assertSucceeds(setDoc(doc(db, p('tasks', 'tNew')), openTask('pChild')));
    await assertFails(setDoc(doc(db, p('tasks', 'tNew2')), openTask('pChild2', { createdBy: 'pChild' })));
  });

  it('a task cannot be created already done, from the api, or for an archived profile', async () => {
    const db = as(ADMIN);
    await assertFails(setDoc(doc(db, p('tasks', 'tA')), openTask('pChild', { createdBy: 'pAdult', ...completion })));
    await assertFails(setDoc(doc(db, p('tasks', 'tB')), openTask('pChild', { createdBy: 'pAdult', origin: 'api' })));
    await assertFails(setDoc(doc(db, p('tasks', 'tC')), openTask('pArchived', { createdBy: 'pAdult' })));
  });

  it('a device without a profile cannot create tasks', async () => {
    await assertFails(setDoc(doc(as(FRESH), p('tasks', 'tNew')), openTask('pChild')));
  });

  it('the owner creates a recurring task with the deterministic id', async () => {
    await assertSucceeds(setDoc(doc(as(CHILD), p('tasks', 'defDaily_2026-10-18_pChild')), recurringTask('defDaily', '2026-10-18', 'pChild')));
  });

  it('rejects a recurring task whose id does not match its definition, period and profile', async () => {
    const db = as(CHILD);
    await assertFails(setDoc(doc(db, p('tasks', 'random-id')), recurringTask('defDaily', '2026-10-18', 'pChild')));
    await assertFails(setDoc(doc(db, p('tasks', 'defDaily_2026-10-19_pChild')), recurringTask('defDaily', '2026-10-18', 'pChild')));
    // Wrong period format for a daily definition.
    await assertFails(setDoc(doc(db, p('tasks', 'defDaily_2026-W42_pChild')), recurringTask('defDaily', '2026-W42', 'pChild')));
  });

  it('rejects a recurring task from an inactive or unassigned definition, or for someone else', async () => {
    const db = as(CHILD);
    await assertFails(setDoc(doc(db, p('tasks', 'defInactive_2026-10-18_pChild')), recurringTask('defInactive', '2026-10-18', 'pChild')));
    await assertFails(setDoc(doc(db, p('tasks', 'defChild2_2026-10-18_pChild')), recurringTask('defChild2', '2026-10-18', 'pChild')));
    await assertFails(setDoc(doc(as(ADMIN), p('tasks', 'defDaily_2026-10-18_pChild')), recurringTask('defDaily', '2026-10-18', 'pChild', { createdBy: 'pAdult' })));
  });

  it('rejects a recurring task that does not copy its definition', async () => {
    await assertFails(setDoc(doc(as(CHILD), p('tasks', 'defDaily_2026-10-18_pChild')), recurringTask('defDaily', '2026-10-18', 'pChild', { level: 'high' })));
  });

  it('generating an existing recurring task again is rejected, for the owner and for an admin', async () => {
    const id = 'defDaily_2026-10-17_pChild'; // seeded as done
    const again = recurringTask('defDaily', '2026-10-17', 'pChild', { createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 18, 13)) });
    await assertFails(setDoc(doc(as(CHILD), p('tasks', id)), again));
    await assertFails(setDoc(doc(as(ADMIN), p('tasks', id)), { ...again, createdBy: 'pAdult' }));
  });

  it('regenerating an existing open recurring task is rejected too', async () => {
    const id = 'defBig_2026-W42_pChild'; // seeded as open
    const again = recurringTask('defBig', '2026-W42', 'pChild', { createdAt: Timestamp.fromMillis(Date.UTC(2026, 9, 18, 13)) });
    await assertFails(setDoc(doc(as(CHILD), p('tasks', id)), again));
  });
});

describe('completing tasks', () => {
  it('the owner completes its own open task', async () => {
    await assertSucceeds(updateDoc(doc(as(CHILD), p('tasks', 'tChildOpen')), completion));
  });

  it("an admin cannot complete someone else's task", async () => {
    await assertFails(updateDoc(doc(as(ADMIN), p('tasks', 'tChildOpen')), completion));
  });

  it('a task with a question completes only with the answer yes', async () => {
    const db = as(CHILD);
    await assertFails(updateDoc(doc(db, p('tasks', 'tChildQuestion')), completion));
    await assertFails(updateDoc(doc(db, p('tasks', 'tChildQuestion')), { ...completion, answer: 'no' }));
    await assertSucceeds(updateDoc(doc(db, p('tasks', 'tChildQuestion')), { ...completion, answer: 'yes' }));
  });

  it('a done task never returns to open, for anyone', async () => {
    const reopen = { status: 'open', doneAt: null, weekKey: null };
    await assertFails(updateDoc(doc(as(CHILD), p('tasks', 'tChildDone')), reopen));
    await assertFails(updateDoc(doc(as(ADMIN), p('tasks', 'tChildDone')), reopen));
  });

  it('a done task cannot be edited', async () => {
    await assertFails(updateDoc(doc(as(CHILD), p('tasks', 'tChildDone')), { talkFlag: true }));
    await assertFails(updateDoc(doc(as(ADMIN), p('tasks', 'tChildDone')), { title: 'Changed' }));
  });

  it('completing cannot change who the task is for', async () => {
    await assertFails(updateDoc(doc(as(CHILD), p('tasks', 'tChildOpen')), { ...completion, profileId: 'pChild2' }));
  });

  it('the owner flags an open task; an admin edits its title but not its flag', async () => {
    await assertSucceeds(updateDoc(doc(as(CHILD), p('tasks', 'tChildOpen')), { talkFlag: true }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), p('tasks', 'tChildOpen')), { title: 'Renamed' }));
    await assertFails(updateDoc(doc(as(ADMIN), p('tasks', 'tChildOpen')), { talkFlag: false }));
  });

  it('only tasks from a big definition carry a plan', async () => {
    const plan = { date: '2026-10-20', trigger: 'After dinner' };
    await assertSucceeds(updateDoc(doc(as(CHILD), p('tasks', 'defBig_2026-W42_pChild')), { plan }));
    await assertFails(updateDoc(doc(as(CHILD), p('tasks', 'tChildOpen')), { plan }));
  });

  it('nobody deletes a task', async () => {
    await assertFails(deleteDoc(doc(as(ADMIN), p('tasks', 'tChildOpen'))));
  });
});

describe('rewards', () => {
  const reward = { profileId: 'pChild', weekKey: '2026-W42', tier: 'high', openedAt: null, ...meta };

  it('a reward is created in the same batch that completes its task', async () => {
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', 'tChildOpen')), completion);
    batch.set(doc(db, p('rewards', 'tChildOpen')), reward);
    await assertSucceeds(batch.commit());
  });

  it('a reward cannot be created on its own', async () => {
    await assertFails(setDoc(doc(as(CHILD), p('rewards', 'tChildOpen')), reward));
  });

  it('completing the same task twice (second device) is rejected as a whole', async () => {
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', 'tChildDone')), completion);
    batch.set(doc(db, p('rewards', 'tChildDone')), reward);
    await assertFails(batch.commit());
  });

  it('a reward is never replaced', async () => {
    await assertFails(setDoc(doc(as(CHILD), p('rewards', 'tChildDone')), { ...reward, tier: 'high' }));
  });

  it('a reward is opened only together with its collectible', async () => {
    await assertFails(updateDoc(doc(as(CHILD), p('rewards', 'tChildDone')), { openedAt: now }));
  });
});

describe('collectibles', () => {
  const collectible = {
    profileId: 'pChild',
    slot: 'slot-01',
    tier: 'mid',
    nickname: null,
    obtainedWeekKey: '2026-W42',
    obtainedAt: now,
    reserveAt: null,
    ...meta,
  };

  async function open(db: Firestore, data: Record<string, unknown> = collectible) {
    const batch = writeBatch(db);
    batch.update(doc(db, p('rewards', 'tChildDone')), { openedAt: now });
    batch.set(doc(db, p('collectibles', 'tChildDone')), data);
    return batch.commit();
  }

  it('the owner opens its reward and gets one collectible', async () => {
    await assertSucceeds(open(as(CHILD)));
  });

  it('opening the same reward twice (second device) is rejected as a whole', async () => {
    await assertSucceeds(open(as(CHILD)));
    await assertFails(open(as(CHILD)));
  });

  it("nobody opens someone else's reward, and the tier must match", async () => {
    await assertFails(open(as(CHILD2), { ...collectible, profileId: 'pChild2' }));
    await assertFails(open(as(CHILD), { ...collectible, tier: 'high' }));
  });

  it('a collectible cannot be created without opening its reward', async () => {
    await assertFails(setDoc(doc(as(CHILD), p('collectibles', 'tChildDone')), collectible));
  });

  it('collectibles are never replaced or deleted; the owner names them and moves them to the reserve', async () => {
    await assertSucceeds(open(as(CHILD)));
    const db = as(CHILD);
    await assertSucceeds(updateDoc(doc(db, p('collectibles', 'tChildDone')), { nickname: 'Nick', reserveAt: now }));
    await assertFails(updateDoc(doc(db, p('collectibles', 'tChildDone')), { tier: 'high' }));
    await assertFails(setDoc(doc(db, p('collectibles', 'tChildDone')), { ...collectible, slot: 'slot-02' }));
    await assertFails(deleteDoc(doc(as(ADMIN), p('collectibles', 'tChildDone'))));
  });

  it('every member reads collectibles (showcase); an admin edits only the nickname', async () => {
    await assertSucceeds(open(as(CHILD)));
    await assertSucceeds(getDoc(doc(as(CHILD2), p('collectibles', 'tChildDone'))));
    await assertSucceeds(updateDoc(doc(as(ADMIN), p('collectibles', 'tChildDone')), { nickname: 'Kind name' }));
    await assertFails(updateDoc(doc(as(ADMIN), p('collectibles', 'tChildDone')), { reserveAt: now }));
  });
});
