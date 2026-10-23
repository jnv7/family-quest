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
  deleteField,
  doc,
  getDoc,
  getDocs,
  collection,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

// Devices. A device is admin while its active profile is an adult profile.
const ADMIN = 'uid-admin'; // world creator, profile pAdult
const ADMIN2 = 'uid-admin2'; // profile pAdult2
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
      [p('members', ADMIN), { profileId: 'pAdult', ...meta }],
      [p('members', ADMIN2), { profileId: 'pAdult2', ...meta }],
      [p('members', CHILD), { profileId: 'pChild', ...meta }],
      [p('members', CHILD2), { profileId: 'pChild2', ...meta }],
      [p('members', FRESH), { profileId: null, ...meta }],
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
      [p('tasks', 'tChildBig'), openTask('pChild', { big: true })],
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

  function createWorldBatch(db: Firestore, kind: 'adult' | 'child' = 'adult') {
    const batch = writeBatch(db);
    batch.set(doc(db, 'worlds', NEW_W), newWorld(STRANGER));
    batch.set(doc(db, 'worlds', NEW_W, 'profiles', 'pCreator'), profile('Creator', kind));
    batch.set(doc(db, 'worlds', NEW_W, 'members', STRANGER), { profileId: 'pCreator', ...meta });
    return batch.commit();
  }

  it("a device creates a world, its creator's adult profile and its membership in one batch", async () => {
    await assertSucceeds(createWorldBatch(as(STRANGER)));
    // The creator is admin from then on.
    await assertSucceeds(setDoc(doc(as(STRANGER), 'worlds', NEW_W, 'profiles', 'pKid'), profile('Kid', 'child')));
  });

  it("the creator's first profile must be an adult profile", async () => {
    await assertFails(createWorldBatch(as(STRANGER), 'child'));
  });

  it('the creation shortcut does not work on an existing world', async () => {
    const db = as(STRANGER);
    await assertFails(setDoc(doc(db, p('profiles', 'pSneaky')), profile('Sneaky', 'adult')));
    await assertFails(setDoc(doc(db, p('members', STRANGER)), { profileId: 'pAdult', ...meta }));
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
    await assertSucceeds(setDoc(doc(as(STRANGER), p('members', STRANGER)), { profileId: null, ...meta }));
  });

  it('a joining device cannot pick a profile at creation, add fields, or join for someone else', async () => {
    const db = as(STRANGER);
    await assertFails(setDoc(doc(db, p('members', STRANGER)), { profileId: 'pChild', ...meta }));
    await assertFails(setDoc(doc(db, p('members', STRANGER)), { profileId: null, role: 'admin', ...meta }));
    await assertFails(setDoc(doc(db, p('members', 'uid-other')), { profileId: null, ...meta }));
  });

  it('cannot join a world that does not exist', async () => {
    const db = as(STRANGER);
    await assertFails(setDoc(doc(db, 'worlds', 'world0000000000000000000099', 'members', STRANGER), { profileId: null, ...meta }));
  });

  it('a device chooses and switches its own profile (Netflix-style)', async () => {
    await assertSucceeds(updateDoc(doc(as(FRESH), p('members', FRESH)), { profileId: 'pChild2' }));
    await assertSucceeds(updateDoc(doc(as(CHILD), p('members', CHILD)), { profileId: 'pAdult' }));
  });

  it('a device cannot choose an archived or missing profile', async () => {
    const db = as(FRESH);
    await assertFails(updateDoc(doc(db, p('members', FRESH)), { profileId: 'pArchived' }));
    await assertFails(updateDoc(doc(db, p('members', FRESH)), { profileId: 'missing' }));
  });

  it('admin rights follow the active profile', async () => {
    const db = as(CHILD);
    await assertFails(setDoc(doc(db, p('taskDefs', 'defX')), taskDef()));
    await assertSucceeds(updateDoc(doc(db, p('members', CHILD)), { profileId: 'pAdult2' }));
    await assertSucceeds(setDoc(doc(db, p('taskDefs', 'defX')), taskDef()));
  });

  it('a device without a profile is not admin', async () => {
    await assertFails(setDoc(doc(as(FRESH), p('taskDefs', 'defX')), taskDef()));
  });

  it("a device cannot change another device's profile", async () => {
    await assertFails(updateDoc(doc(as(CHILD), p('members', CHILD2)), { profileId: 'pChild' }));
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

  it("an admin archives a child's profile; nobody deletes one", async () => {
    await assertSucceeds(updateDoc(doc(as(ADMIN), p('profiles', 'pChild2')), { archived: true }));
    await assertFails(deleteDoc(doc(as(ADMIN), p('profiles', 'pChild2'))));
  });

  it('a world never loses its last admin: kind never changes and adult profiles are never archived', async () => {
    await assertFails(updateDoc(doc(as(ADMIN), p('profiles', 'pAdult2')), { archived: true }));
    await assertFails(updateDoc(doc(as(ADMIN), p('profiles', 'pAdult2')), { kind: 'child' }));
    await assertFails(updateDoc(doc(as(ADMIN), p('profiles', 'pChild')), { kind: 'adult' }));
  });

  it('the owner changes only avatar and party of its own profile', async () => {
    const db = as(CHILD);
    await assertSucceeds(updateDoc(doc(db, p('profiles', 'pChild')), { avatar: { body: 1, hair: 2, outfit: 0, accessory: 0 } }));
    await assertSucceeds(updateDoc(doc(db, p('profiles', 'pChild')), { partyIds: ['a', 'b'] }));
    await assertFails(updateDoc(doc(db, p('profiles', 'pChild')), { displayName: 'Changed' }));
    await assertFails(updateDoc(doc(db, p('profiles', 'pChild2')), { partyIds: ['a'] }));
  });

  it('the owner writes avatar.symbol without any rules change, and another child cannot', async () => {
    await assertSucceeds(updateDoc(doc(as(CHILD), p('profiles', 'pChild')), { 'avatar.symbol': '🐬' }));
    await assertFails(updateDoc(doc(as(CHILD), p('profiles', 'pChild2')), { 'avatar.symbol': '🐬' }));
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

  it('only tasks from a big definition, and big ad hoc tasks, carry a plan', async () => {
    const plan = { date: '2026-10-20', trigger: 'After dinner' };
    await assertSucceeds(updateDoc(doc(as(CHILD), p('tasks', 'defBig_2026-W42_pChild')), { plan }));
    await assertSucceeds(updateDoc(doc(as(CHILD), p('tasks', 'tChildBig')), { plan }));
    await assertFails(updateDoc(doc(as(CHILD), p('tasks', 'tChildOpen')), { plan }));
  });

  it('an ad hoc task can be created big, but a recurring one cannot, and the mark is only ever true', async () => {
    await assertSucceeds(setDoc(doc(as(ADMIN), p('tasks', 'tNewBig')), openTask('pChild', { createdBy: 'pAdult', big: true })));
    await assertFails(setDoc(doc(as(ADMIN), p('tasks', 'tNewNotBig')), openTask('pChild', { createdBy: 'pAdult', big: false })));
    await assertFails(setDoc(doc(as(ADMIN), p('tasks', 'tNewBigText')), openTask('pChild', { createdBy: 'pAdult', big: 'yes' })));
    await assertSucceeds(setDoc(doc(as(CHILD), p('tasks', 'defDaily_2026-10-19_pChild')), recurringTask('defDaily', '2026-10-19', 'pChild')));
    await assertFails(setDoc(doc(as(CHILD), p('tasks', 'defDaily_2026-10-20_pChild')), recurringTask('defDaily', '2026-10-20', 'pChild', { big: true })));
  });

  it('nobody turns the big mark on or off after creation', async () => {
    await assertFails(updateDoc(doc(as(ADMIN), p('tasks', 'tChildOpen')), { big: true }));
    await assertFails(updateDoc(doc(as(CHILD), p('tasks', 'tChildOpen')), { big: true }));
    await assertFails(updateDoc(doc(as(ADMIN), p('tasks', 'tChildBig')), { big: false }));
    await assertFails(updateDoc(doc(as(CHILD), p('tasks', 'tChildBig')), { big: false }));
  });

  it('only an admin deletes a task (restarting the universe)', async () => {
    await assertFails(deleteDoc(doc(as(CHILD), p('tasks', 'tChildOpen'))));
    await assertSucceeds(deleteDoc(doc(as(ADMIN), p('tasks', 'tChildOpen'))));
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
    await assertFails(deleteDoc(doc(as(CHILD), p('collectibles', 'tChildDone')))); // only an admin, restarting
  });

  it('every member reads collectibles (showcase); an admin edits only the nickname', async () => {
    await assertSucceeds(open(as(CHILD)));
    await assertSucceeds(getDoc(doc(as(CHILD2), p('collectibles', 'tChildDone'))));
    await assertSucceeds(updateDoc(doc(as(ADMIN), p('collectibles', 'tChildDone')), { nickname: 'Kind name' }));
    await assertFails(updateDoc(doc(as(ADMIN), p('collectibles', 'tChildDone')), { reserveAt: now }));
  });
});

// ---------------------------------------------------------------------------
// 0.9: tokens (ADR 0008) and retiring (ADR 0009)

async function seedDoc(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, path), data);
  });
}

const setBalance = (profileId: string, tokens: number) =>
  seedDoc(p('profiles', profileId), profile(profileId === 'pChild' ? 'Child' : 'Child two', 'child', { tokens }));

describe('earning tokens', () => {
  const done = (tokens: number) => ({ ...completion, tokens });

  async function earn(uid: string, taskId: string, tokens: number, ownTokens = tokens, profileId = 'pChild', from = taskId) {
    const db = as(uid);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', taskId)), done(tokens));
    batch.update(doc(db, p('profiles', profileId)), { tokens: increment(ownTokens), tokensFrom: from });
    return batch.commit();
  }

  it('the owner completes a task and gets its tokens in one batch', async () => {
    await assertSucceeds(earn(CHILD, 'tChildOpen', 2));
    await assertSucceeds(earn(CHILD, 'tChildBig', 1));
  });

  it('a question task earns tokens with the answer', async () => {
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', 'tChildQuestion')), { ...done(2), answer: 'yes' });
    batch.update(doc(db, p('profiles', 'pChild')), { tokens: increment(2), tokensFrom: 'tChildQuestion' });
    await assertSucceeds(batch.commit());
  });

  it('tokens on the task without the increment on the profile are refused', async () => {
    await assertFails(updateDoc(doc(as(CHILD), p('tasks', 'tChildOpen')), done(2)));
  });

  it('the increment without the task is refused', async () => {
    await assertFails(updateDoc(doc(as(CHILD), p('profiles', 'pChild')), { tokens: increment(2), tokensFrom: 'tChildOpen' }));
  });

  it("an increment that differs from the task's tokens is refused", async () => {
    await assertFails(earn(CHILD, 'tChildOpen', 2, 3));
    await assertFails(earn(CHILD, 'tChildOpen', 2, 1));
  });

  it('tokens of 0 or 11 are refused', async () => {
    await assertFails(earn(CHILD, 'tChildOpen', 0));
    await assertFails(earn(CHILD, 'tChildOpen', 11));
    await assertSucceeds(earn(CHILD, 'tChildOpen', 10));
  });

  it('a balance written as a plain value is refused', async () => {
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', 'tChildOpen')), done(2));
    batch.update(doc(db, p('profiles', 'pChild')), { tokens: 99, tokensFrom: 'tChildOpen' });
    await assertFails(batch.commit());
  });

  it('tokensFrom naming a task that was already done is refused', async () => {
    const db = as(CHILD);
    await assertFails(updateDoc(doc(db, p('profiles', 'pChild')), { tokens: increment(2), tokensFrom: 'tChildDone' }));
  });

  it("tokensFrom naming another profile's task is refused", async () => {
    await seedDoc(p('tasks', 'tChild2Open'), openTask('pChild2'));
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', 'tChild2Open')), done(2));
    batch.update(doc(db, p('profiles', 'pChild')), { tokens: increment(2), tokensFrom: 'tChild2Open' });
    await assertFails(batch.commit());
  });

  it("nobody earns for someone else's profile", async () => {
    await seedDoc(p('tasks', 'tChild2Open'), openTask('pChild2'));
    await assertFails(earn(ADMIN, 'tChild2Open', 2, 2, 'pChild2'));
    await assertFails(earn(CHILD, 'tChild2Open', 2, 2, 'pChild2'));
  });

  it('the profile changes nothing else together with tokens', async () => {
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', 'tChildOpen')), done(2));
    batch.update(doc(db, p('profiles', 'pChild')), { tokens: increment(2), tokensFrom: 'tChildOpen', displayName: 'Rich' });
    await assertFails(batch.commit());
  });
});

describe('the 0.8 completion path', () => {
  const reward = { profileId: 'pChild', weekKey: '2026-W42', tier: 'mid', openedAt: null, ...meta };

  it('completing with a reward and no tokens still works', async () => {
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', 'tChildOpen')), completion);
    batch.set(doc(db, p('rewards', 'tChildOpen')), reward);
    await assertSucceeds(batch.commit());
  });

  it('a reward together with tokens is refused', async () => {
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', 'tChildOpen')), { ...completion, tokens: 2 });
    batch.update(doc(db, p('profiles', 'pChild')), { tokens: increment(2), tokensFrom: 'tChildOpen' });
    batch.set(doc(db, p('rewards', 'tChildOpen')), reward);
    await assertFails(batch.commit());
  });
});

describe('spending tokens', () => {
  const bought = (price: number, extra: Record<string, unknown> = {}) => ({
    profileId: 'pChild',
    weekKey: '2026-W42',
    tier: 'mid',
    price,
    openedAt: now,
    ...meta,
    ...extra,
  });
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

  interface BuyOptions {
    price?: number;
    take?: number;
    rewardId?: string;
    profileId?: string;
    reward?: Record<string, unknown>;
    withCollectible?: boolean;
    withTokens?: boolean;
  }

  async function buy(
    uid: string,
    { price = 12, take = price, rewardId = 'rBought', profileId = 'pChild', reward = bought(price), withCollectible = true, withTokens = true }: BuyOptions = {},
  ) {
    const db = as(uid);
    const batch = writeBatch(db);
    if (withTokens) batch.update(doc(db, p('profiles', profileId)), { tokens: increment(-take), tokensFor: rewardId });
    batch.set(doc(db, p('rewards', rewardId)), reward);
    if (withCollectible) batch.set(doc(db, p('collectibles', rewardId)), collectible);
    return batch.commit();
  }

  it('the owner buys with exactly its balance, which leaves 0', async () => {
    await setBalance('pChild', 12);
    await assertSucceeds(buy(CHILD));
  });

  it('spending more than the balance is refused', async () => {
    await setBalance('pChild', 11);
    await assertFails(buy(CHILD));
  });

  it('the same purchase twice, prepared from the same state, is refused the second time', async () => {
    await setBalance('pChild', 25);
    await assertSucceeds(buy(CHILD, { price: 25, rewardId: 'rFirst' }));
    await assertFails(buy(CHILD, { price: 25, rewardId: 'rSecond' }));
  });

  it('a purchase without its collectible is refused', async () => {
    await setBalance('pChild', 25);
    await assertFails(buy(CHILD, { withCollectible: false }));
  });

  it('a bought reward without the decrement is refused', async () => {
    await setBalance('pChild', 25);
    await assertFails(buy(CHILD, { withTokens: false }));
  });

  it('a decrement that differs from the price is refused', async () => {
    await setBalance('pChild', 25);
    await assertFails(buy(CHILD, { price: 12, take: 5 }));
    await assertFails(buy(CHILD, { price: 12, take: 20 }));
  });

  it("a device spending another profile's tokens is refused", async () => {
    await setBalance('pChild2', 25);
    await assertFails(buy(CHILD, { profileId: 'pChild2', reward: bought(12, { profileId: 'pChild2' }) }));
  });

  it("an admin spending a child's tokens is refused", async () => {
    await setBalance('pChild', 25);
    await assertFails(buy(ADMIN));
  });

  it('a price of 0 or 201 is refused', async () => {
    await setBalance('pChild', 300);
    await assertFails(buy(CHILD, { price: 0 }));
    await assertFails(buy(CHILD, { price: 201 }));
  });

  it('a non-integer price is refused', async () => {
    await setBalance('pChild', 25);
    await assertFails(buy(CHILD, { price: 12.5, take: 12.5 }));
  });

  it('a bought reward replacing an existing reward is refused', async () => {
    await setBalance('pChild', 25);
    await assertFails(buy(CHILD, { rewardId: 'tChildDone' }));
  });

  it('a bought reward is never updated', async () => {
    await setBalance('pChild', 25);
    await assertSucceeds(buy(CHILD));
    await assertFails(updateDoc(doc(as(CHILD), p('rewards', 'rBought')), { openedAt: now }));
  });

  it('a bought reward must be created already opened', async () => {
    await setBalance('pChild', 25);
    await assertFails(buy(CHILD, { reward: bought(12, { openedAt: null }) }));
  });

  it('the collectible of a bought reward must match its tier and owner', async () => {
    await setBalance('pChild', 25);
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('profiles', 'pChild')), { tokens: increment(-12), tokensFor: 'rBought' });
    batch.set(doc(db, p('rewards', 'rBought')), bought(12));
    batch.set(doc(db, p('collectibles', 'rBought')), { ...collectible, tier: 'high' });
    await assertFails(batch.commit());
  });

  it('a collectible alone, for a reward that does not exist, is refused', async () => {
    await assertFails(setDoc(doc(as(CHILD), p('collectibles', 'rNothing')), collectible));
  });
});

describe('the party above a lowered size', () => {
  async function lowerSizeTo(size: number) {
    await seedDoc(p(), { name: 'Test world', themeId: 'minimal', createdBy: ADMIN, ruleset: { ...ruleset, partySize: size }, ...meta });
    await seedDoc(p('profiles', 'pChild'), profile('Child', 'child', { partyIds: ['a', 'b', 'c'] }));
  }

  it('the owner can still earn tokens', async () => {
    await lowerSizeTo(2);
    const db = as(CHILD);
    const batch = writeBatch(db);
    batch.update(doc(db, p('tasks', 'tChildOpen')), { ...completion, tokens: 2 });
    batch.update(doc(db, p('profiles', 'pChild')), { tokens: increment(2), tokensFrom: 'tChildOpen' });
    await assertSucceeds(batch.commit());
  });

  it('the owner can remove a member', async () => {
    await lowerSizeTo(2);
    await assertSucceeds(updateDoc(doc(as(CHILD), p('profiles', 'pChild')), { partyIds: ['a', 'b'] }));
    await assertSucceeds(updateDoc(doc(as(CHILD), p('profiles', 'pChild')), { partyIds: ['c', 'a'] }));
  });

  it('the owner cannot swap one in, or grow', async () => {
    await lowerSizeTo(2);
    await assertFails(updateDoc(doc(as(CHILD), p('profiles', 'pChild')), { partyIds: ['a', 'b', 'x'] }));
    await assertFails(updateDoc(doc(as(CHILD), p('profiles', 'pChild')), { partyIds: ['a', 'b', 'c', 'd'] }));
  });

  it('a party within the size still changes freely', async () => {
    await assertSucceeds(updateDoc(doc(as(CHILD), p('profiles', 'pChild')), { partyIds: ['a', 'b', 'c', 'd', 'e'] }));
  });
});

describe('retiring tasks', () => {
  const retire = (uid: string, taskId: string, extra: Record<string, unknown> = {}) =>
    updateDoc(doc(as(uid), p('tasks', taskId)), {
      status: 'retired',
      retiredAt: now,
      retiredBy: uid === ADMIN ? 'pAdult' : uid === CHILD ? 'pChild' : 'pChild2',
      ...extra,
    });

  it("an admin retires anyone's open task, recurring or not", async () => {
    await assertSucceeds(retire(ADMIN, 'tChildOpen'));
    await assertSucceeds(retire(ADMIN, 'tAdultOpen'));
    await assertSucceeds(retire(ADMIN, 'defBig_2026-W42_pChild'));
  });

  it('a child retires its own ad hoc task made by itself', async () => {
    await assertSucceeds(retire(CHILD, 'tChildOpen'));
  });

  it('a child cannot retire a task an adult gave, or a recurring one', async () => {
    await seedDoc(p('tasks', 'tGiven'), openTask('pChild', { createdBy: 'pAdult' }));
    await assertFails(retire(CHILD, 'tGiven'));
    await assertFails(retire(CHILD, 'defBig_2026-W42_pChild'));
  });

  it("a child cannot retire someone else's task", async () => {
    await assertFails(retire(CHILD2, 'tChildOpen'));
    await assertFails(retire(CHILD, 'tAdultOpen'));
  });

  it('retiredBy must be the active profile, and retiredAt a timestamp', async () => {
    await assertFails(retire(ADMIN, 'tChildOpen', { retiredBy: 'pAdult2' }));
    await assertFails(retire(ADMIN, 'tChildOpen', { retiredAt: 'today' }));
  });

  it('nothing else changes with it', async () => {
    await assertFails(retire(ADMIN, 'tChildOpen', { title: 'Other' }));
    await assertFails(retire(ADMIN, 'tChildOpen', { tokens: 3 }));
    await assertFails(retire(CHILD, 'tChildOpen', { weekKey: '2026-W42' }));
  });

  it('a done or retired task cannot be retired', async () => {
    await assertFails(retire(ADMIN, 'tChildDone'));
    await assertSucceeds(retire(ADMIN, 'tChildOpen'));
    await assertFails(retire(ADMIN, 'tChildOpen', { retiredAt: Timestamp.fromMillis(Date.UTC(2026, 9, 19)) }));
  });

  it('a retired task can never be completed or edited', async () => {
    await assertSucceeds(retire(ADMIN, 'tChildOpen'));
    await assertFails(updateDoc(doc(as(CHILD), p('tasks', 'tChildOpen')), completion));
    await assertFails(updateDoc(doc(as(ADMIN), p('tasks', 'tChildOpen')), { title: 'Back again' }));
    await assertFails(updateDoc(doc(as(ADMIN), p('tasks', 'tChildOpen')), { status: 'open' }));
  });

  it('retired fields cannot be set when a task is created', async () => {
    await assertFails(setDoc(doc(as(CHILD), p('tasks', 'tNew')), openTask('pChild', { retiredAt: now })));
    await assertFails(setDoc(doc(as(CHILD), p('tasks', 'tNew')), openTask('pChild', { tokens: 2 })));
  });
});

describe('taking a collectible from the reserve (ADR 0010)', () => {
  const owned = (profileId: string, extra: Record<string, unknown> = {}) => ({
    profileId,
    slot: 'slot-01',
    tier: 'mid',
    nickname: 'Rex',
    obtainedWeekKey: '2026-W42',
    obtainedAt: now,
    reserveAt: now,
    ...meta,
    ...extra,
  });

  beforeEach(async () => {
    await seedDoc(p('collectibles', 'cReserve'), owned('pChild2'));
    await seedDoc(p('collectibles', 'cParty'), owned('pChild2', { reserveAt: null }));
    await seedDoc(p('profiles', 'pChild2'), profile('Child two', 'child', { partyIds: ['cParty'] }));
  });

  async function take(uid: string, profileId: string, id: string, patch: Record<string, unknown> = {}, party: string[] = [id]) {
    const db = as(uid);
    const batch = writeBatch(db);
    batch.update(doc(db, p('collectibles', id)), { profileId, reserveAt: null, ...patch });
    batch.update(doc(db, p('profiles', profileId)), { partyIds: party });
    return batch.commit();
  }

  it('lets anyone take it into their own party, and keeps its name', async () => {
    await assertSucceeds(take(CHILD, 'pChild', 'cReserve'));
    await assertSucceeds(getDoc(doc(as(CHILD), p('collectibles', 'cReserve'))));
    // It is theirs now: they rename it, and its first owner cannot.
    await assertSucceeds(updateDoc(doc(as(CHILD), p('collectibles', 'cReserve')), { nickname: 'Max' }));
    await assertFails(updateDoc(doc(as(CHILD2), p('collectibles', 'cReserve')), { nickname: 'Back' }));
  });

  it('lets an adult take it too', async () => {
    await assertSucceeds(take(ADMIN, 'pAdult', 'cReserve'));
  });

  it('refuses a taking that does not put it in the taker’s party', async () => {
    const db = as(CHILD);
    await assertFails(updateDoc(doc(db, p('collectibles', 'cReserve')), { profileId: 'pChild', reserveAt: null }));
    await assertFails(take(CHILD, 'pChild', 'cReserve', {}, []));
  });

  it('refuses taking what is not in the reserve', async () => {
    await assertFails(take(CHILD, 'pChild', 'cParty'));
  });

  it('refuses giving it to someone else, or changing anything more', async () => {
    await assertFails(take(CHILD, 'pChild', 'cReserve', { profileId: 'pAdult' }));
    await assertFails(take(CHILD, 'pChild', 'cReserve', { nickname: 'Mine' }));
    await assertFails(take(CHILD, 'pChild', 'cReserve', { tier: 'high' }));
    await assertFails(take(CHILD, 'pChild', 'cReserve', { reserveAt: now }));
  });

  it('refuses a non-member and a device with no profile', async () => {
    await assertFails(updateDoc(doc(as(STRANGER), p('collectibles', 'cReserve')), { profileId: 'pChild', reserveAt: null }));
    await assertFails(updateDoc(doc(as(FRESH), p('collectibles', 'cReserve')), { profileId: 'pChild', reserveAt: null }));
  });

  it('gives it to the first of two takings, and refuses the second', async () => {
    await assertSucceeds(take(CHILD, 'pChild', 'cReserve'));
    await assertFails(take(ADMIN, 'pAdult', 'cReserve'));
  });

  it('does not let the party above its size gain the taken one', async () => {
    await seedDoc(p('profiles', 'pChild'), profile('Child', 'child', { partyIds: ['a', 'b', 'c', 'd', 'e'] }));
    await assertFails(take(CHILD, 'pChild', 'cReserve', {}, ['a', 'b', 'c', 'd', 'e', 'cReserve']));
    await assertSucceeds(take(CHILD, 'pChild', 'cReserve', {}, ['a', 'b', 'c', 'd', 'cReserve']));
  });
});

describe('restarting the universe (ADR 0011)', () => {
  beforeEach(async () => {
    await seedDoc(p('profiles', 'pChild'), profile('Child', 'child', { tokens: 7, tokensFrom: 'tChildDone', partyIds: ['c1'] }));
    await seedDoc(p('collectibles', 'c1'), {
      profileId: 'pChild', slot: 'slot-01', tier: 'mid', nickname: null, obtainedWeekKey: '2026-W42', obtainedAt: now, reserveAt: null, ...meta,
    });
  });

  it('lets an admin delete tasks, definitions, rewards and collectibles, and nobody else', async () => {
    for (const path of [p('tasks', 'tChildOpen'), p('taskDefs', 'defDaily'), p('rewards', 'tChildDone'), p('collectibles', 'c1')]) {
      await assertFails(deleteDoc(doc(as(CHILD), path)));
      await assertFails(deleteDoc(doc(as(FRESH), path)));
      await assertFails(deleteDoc(doc(as(STRANGER), path)));
      await assertSucceeds(deleteDoc(doc(as(ADMIN), path)));
    }
  });

  it('never lets anyone delete a world, a member or a profile', async () => {
    await assertFails(deleteDoc(doc(as(ADMIN), p())));
    await assertFails(deleteDoc(doc(as(ADMIN), p('members', CHILD))));
    await assertFails(deleteDoc(doc(as(ADMIN), p('profiles', 'pChild'))));
  });

  it('lets an admin clear a profile’s balance, its reasons and its party, and nothing else', async () => {
    const clear = { tokens: deleteField(), tokensFrom: deleteField(), tokensFor: deleteField(), partyIds: [] };
    await assertFails(updateDoc(doc(as(CHILD), p('profiles', 'pChild')), clear));
    await assertFails(updateDoc(doc(as(ADMIN), p('profiles', 'pChild')), { ...clear, displayName: 'Renamed' }));
    await assertFails(updateDoc(doc(as(ADMIN), p('profiles', 'pChild')), { ...clear, tokens: 5 }));
    await assertFails(updateDoc(doc(as(ADMIN), p('profiles', 'pChild')), { ...clear, partyIds: ['c1'] }));
    await assertFails(updateDoc(doc(as(ADMIN), p('profiles', 'pChild')), { tokens: 99 }));
    await assertSucceeds(updateDoc(doc(as(ADMIN), p('profiles', 'pChild')), clear));
    const after = await assertSucceeds(getDoc(doc(as(ADMIN), p('profiles', 'pChild'))));
    expect(after.data()).not.toHaveProperty('tokens');
  });
});
