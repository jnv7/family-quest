/**
 * Behaviour every `DataStore` adapter must have (docs/architecture.md §5).
 *
 * The memory adapter runs it with `npm test`; the Firestore adapter runs the
 * same suite against the emulators in CI. Every rejection is checked on
 * `settled`, with the exact `DataStoreError.code`.
 */
import { describe, expect, it } from 'vitest';
import { weekKey } from '../core/calendar';
import type { NewRecurringTask } from '../core/generation';
import {
  DEFAULT_RULESET,
  LIMITS,
  type Clock,
  type Collectible,
  type Millis,
  type Profile,
  type ProfileId,
  type Reward,
  type Task,
  type TaskDef,
  type World,
} from '../core/model';
import { DataStoreError, type DataStore, type ShowcaseItem, type DataStoreErrorCode, type TaskDefInput, type Unsubscribe, type Write } from './DataStore';

/** Signed-in devices that share one backend. */
export interface ContractDevices {
  admin: DataStore;
  child: DataStore;
  /** A second device, used as another child on the same profile. */
  child2: DataStore;
  /** A device that joins and never chooses a profile. */
  newcomer: DataStore;
  /** Takes one of the devices off the network, or back on it. Writes made meanwhile wait for the server. */
  setOnline(device: DataStore, online: boolean): Promise<void> | void;
}

/** Builds fresh devices for one test; every store must read time from `clock`. */
export type MakeDevices = (env: { clock: Clock }) => Promise<ContractDevices> | ContractDevices;

const START: Millis = Date.parse('2026-10-18T12:00:00Z');

async function eventually(check: () => void, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

async function rejectsWith(write: Write<unknown> | Promise<unknown>, code: DataStoreErrorCode): Promise<void> {
  const promise = 'settled' in write ? write.settled : write;
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DataStoreError);
  expect((error as DataStoreError).code).toBe(code);
}

/** Keeps the latest value an observer delivered. */
class Watch<T> {
  value: T | undefined;
  error: DataStoreError | undefined;
  emissions = 0;
  private stop: Unsubscribe | undefined;

  constructor(subscribe: (onValue: (value: T) => void, onError: (error: DataStoreError) => void) => Unsubscribe) {
    this.stop = subscribe(
      (value) => {
        this.value = value;
        this.emissions++;
      },
      (error) => {
        this.error = error;
      },
    );
  }

  async current(): Promise<T> {
    await eventually(() => expect(this.value).toBeDefined());
    return this.value as T;
  }

  close(): void {
    this.stop?.();
  }
}

export function runDataStoreContract(name: string, makeDevices: MakeDevices): void {
  describe(`DataStore contract: ${name}`, () => {
    let now = START;
    const clock: Clock = () => now;

    /** A world with an admin, a child on one profile (two devices) and a newcomer. */
    async function setup() {
      now = START;
      const devices = await makeDevices({ clock });
      const { admin, child, child2, newcomer } = devices;

      const created = admin.worlds.createWorld({ name: 'Home', themeId: 'minimal', creatorDisplayName: 'Alex' });
      await created.settled;
      const { worldId, profileId: adminProfileId } = created.result;

      const childProfile = admin.worlds.createProfile(worldId, { displayName: 'Sam', kind: 'child' });
      await childProfile.settled;
      const childProfileId = childProfile.result.profileId;

      for (const device of [child, child2, newcomer]) await device.worlds.joinWorld(worldId);
      for (const device of [child, child2]) await device.worlds.chooseProfile(worldId, childProfileId).settled;

      return { ...devices, worldId, adminProfileId, childProfileId };
    }

    const adhoc = (profileId: ProfileId, title = 'Tidy up') => ({ profileId, title, level: 'mid' as const, question: null });

    describe('world', () => {
      it('creates a world with a long id, the default ruleset and the creator as admin', async () => {
        const { admin, worldId, adminProfileId } = await setup();
        expect(worldId.length).toBeGreaterThanOrEqual(24);

        const world = await new Watch<{ name: string; themeId: string; ruleset: unknown }>((v, e) =>
          admin.worlds.observeWorld(worldId, v, e),
        ).current();
        expect(world.name).toBe('Home');
        expect(world.themeId).toBe('minimal');
        expect(world.ruleset).toEqual(DEFAULT_RULESET);

        const profiles = await new Watch<Profile[]>((v, e) => admin.worlds.observeProfiles(worldId, v, e)).current();
        const creator = profiles.find((p) => p.id === adminProfileId);
        expect(creator).toMatchObject({ displayName: 'Alex', kind: 'adult', archived: false });

        const membership = await admin.worlds.getMembership(worldId);
        expect(membership?.profileId).toBe(adminProfileId);
        // Admin at once: no further step is needed to create a profile.
        await admin.worlds.createProfile(worldId, { displayName: 'Kim', kind: 'child' }).settled;
      });
    });

    describe('join', () => {
      it('joins with no profile, and joining again is a no-op', async () => {
        const { newcomer, worldId } = await setup();
        const first = await newcomer.worlds.joinWorld(worldId);
        expect(first.profileId).toBeNull();
        const second = await newcomer.worlds.joinWorld(worldId);
        expect(second).toEqual(first);
      });

      it('rejects an unknown world with not-found', async () => {
        const { newcomer } = await setup();
        await rejectsWith(newcomer.worlds.joinWorld('x'.repeat(28)), 'not-found');
      });
    });

    describe('profiles', () => {
      it('shows a new profile to every device', async () => {
        const { admin, child, worldId } = await setup();
        const created = admin.worlds.createProfile(worldId, { displayName: 'Robin', kind: 'child' });
        await created.settled;
        for (const device of [admin, child]) {
          const watch = new Watch<Profile[]>((v, e) => device.worlds.observeProfiles(worldId, v, e));
          await eventually(() => expect(watch.value?.some((p) => p.id === created.result.profileId)).toBe(true));
          watch.close();
        }
      });

      it('refuses a device on a child profile creating one', async () => {
        const { child, worldId } = await setup();
        await rejectsWith(child.worlds.createProfile(worldId, { displayName: 'Nope', kind: 'child' }), 'permission-denied');
      });

      it('archives a child profile without deleting it', async () => {
        const { admin, worldId, childProfileId } = await setup();
        await admin.worlds.setProfileArchived(worldId, childProfileId, true).settled;
        const watch = new Watch<Profile[]>((v, e) => admin.worlds.observeProfiles(worldId, v, e));
        await eventually(() => expect(watch.value?.find((p) => p.id === childProfileId)?.archived).toBe(true));
        watch.close();
      });

      it('refuses archiving an adult profile', async () => {
        const { admin, worldId, adminProfileId } = await setup();
        await rejectsWith(admin.worlds.setProfileArchived(worldId, adminProfileId, true), 'permission-denied');
      });
    });

    describe('profile choice', () => {
      it('updates the membership, and switching later works', async () => {
        const { admin, child, worldId, adminProfileId, childProfileId } = await setup();
        expect((await child.worlds.getMembership(worldId))?.profileId).toBe(childProfileId);

        const other = admin.worlds.createProfile(worldId, { displayName: 'Robin', kind: 'child' });
        await other.settled;
        await child.worlds.chooseProfile(worldId, other.result.profileId).settled;
        expect((await child.worlds.getMembership(worldId))?.profileId).toBe(other.result.profileId);
        expect((await admin.worlds.getMembership(worldId))?.profileId).toBe(adminProfileId);
      });

      it('refuses an archived profile', async () => {
        const { admin, newcomer, worldId, childProfileId } = await setup();
        await admin.worlds.setProfileArchived(worldId, childProfileId, true).settled;
        await rejectsWith(newcomer.worlds.chooseProfile(worldId, childProfileId), 'permission-denied');
      });
    });

    describe('admin rights', () => {
      it('come from the active profile only', async () => {
        const { child, newcomer, worldId, adminProfileId } = await setup();
        const newProfile = { displayName: 'Kim', kind: 'child' as const };

        await rejectsWith(child.worlds.createProfile(worldId, newProfile), 'permission-denied');
        await rejectsWith(newcomer.worlds.createProfile(worldId, newProfile), 'permission-denied');

        await child.worlds.chooseProfile(worldId, adminProfileId).settled;
        await child.worlds.createProfile(worldId, newProfile).settled;
      });
    });

    describe('ad hoc tasks', () => {
      it('lets an admin create one for any profile, created by the admin profile', async () => {
        const { admin, worldId, adminProfileId, childProfileId } = await setup();
        const created = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        await created.settled;

        const watch = new Watch<Task[]>((v, e) => admin.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(watch.value).toHaveLength(1));
        expect(watch.value?.[0]).toMatchObject({
          id: created.result.taskId,
          profileId: childProfileId,
          createdBy: adminProfileId,
          source: 'adhoc',
          origin: 'app',
          status: 'open',
          talkFlag: false,
          weekKey: null,
        });
        watch.close();
      });

      it('stamps the time of the call, not of the write', async () => {
        const { admin, worldId, childProfileId } = await setup();
        now = START + 5000;
        const created = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        now = START + 60_000; // time passes before the adapter finishes the write
        await created.settled;

        const watch = new Watch<Task[]>((v, e) => admin.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(watch.value).toHaveLength(1));
        expect(watch.value?.[0]?.createdAt).toBe(START + 5000);
        watch.close();
      });

      it('lets a child create one for itself only', async () => {
        const { child, worldId, adminProfileId, childProfileId } = await setup();
        await child.tasks.createAdhocTask(worldId, adhoc(childProfileId)).settled;
        await rejectsWith(child.tasks.createAdhocTask(worldId, adhoc(adminProfileId)), 'permission-denied');
      });

      it('refuses a device without a profile', async () => {
        const { newcomer, worldId, childProfileId } = await setup();
        await rejectsWith(newcomer.tasks.createAdhocTask(worldId, adhoc(childProfileId)), 'permission-denied');
      });
    });

    describe('observing', () => {
      it('emits first without any write, lists only open tasks oldest first, and follows completion', async () => {
        const { admin, child, worldId, adminProfileId, childProfileId } = await setup();

        const open = new Watch<Task[]>((v, e) => child.tasks.observeOpenTasks(worldId, childProfileId, v, e));
        expect(await open.current()).toEqual([]);

        now = START + 1000;
        const first = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId, 'First'));
        now = START + 2000;
        const second = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId, 'Second'));
        await Promise.all([first.settled, second.settled]);
        await admin.tasks.createAdhocTask(worldId, adhoc(adminProfileId, 'Not for the child')).settled;

        await eventually(() => expect(open.value?.map((t) => t.title)).toEqual(['First', 'Second']));

        await child.tasks.completeTaskWithReward(worldId, first.result.taskId, { answer: null, talkFlag: false, rewardTier: 'mid' }).settled;
        await eventually(() => expect(open.value?.map((t) => t.title)).toEqual(['Second']));
        open.close();
      });
    });

    describe('completing', () => {
      it('records status, time and the week of the completion', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const task = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        await task.settled;

        now = Date.parse('2026-10-25T23:30:00Z');
        await child.tasks.completeTaskWithReward(worldId, task.result.taskId, { answer: null, talkFlag: true, rewardTier: 'mid' }).settled;

        const watch = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(watch.value?.[0]?.status).toBe('done'));
        expect(watch.value?.[0]).toMatchObject({
          doneAt: now,
          talkFlag: true,
          answer: null,
          weekKey: weekKey(now, DEFAULT_RULESET.timezone),
        });
        watch.close();
      });

      it('fixes the time and week at the moment of the call', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const task = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        await task.settled;

        now = Date.parse('2026-10-25T22:30:00Z'); // Sunday evening, week 43
        const completion = child.tasks.completeTaskWithReward(worldId, task.result.taskId, { answer: null, talkFlag: false, rewardTier: 'mid' });
        const tapped = now;
        now = Date.parse('2026-10-26T09:00:00Z'); // Monday, week 44, before the write finishes
        await completion.settled;

        const watch = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(watch.value?.[0]?.status).toBe('done'));
        expect(watch.value?.[0]).toMatchObject({ doneAt: tapped, weekKey: '2026-W43' });
        watch.close();
      });

      it('needs the answer yes when the task has a question, before any write', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const task = admin.tasks.createAdhocTask(worldId, { ...adhoc(childProfileId), question: 'Did you wash your hands?' });
        await task.settled;
        const { taskId } = task.result;

        await rejectsWith(child.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'mid' }), 'invalid-argument');
        await rejectsWith(child.tasks.completeTaskWithReward(worldId, taskId, { answer: 'no', talkFlag: false, rewardTier: 'mid' }), 'invalid-argument');
        await child.tasks.completeTaskWithReward(worldId, taskId, { answer: 'yes', talkFlag: false, rewardTier: 'mid' }).settled;
      });

      it('refuses an admin completing someone else’s task', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const task = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        await task.settled;
        const { taskId } = task.result;

        await rejectsWith(admin.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'mid' }), 'permission-denied');

        const watch = new Watch<Task[]>((v, e) => child.tasks.observeOpenTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(watch.value?.map((t) => t.id)).toEqual([taskId]));
        watch.close();
      });

      it('accepts the first of two devices completing the same task, and the second shows done too', async () => {
        const { admin, child, child2, worldId, childProfileId } = await setup();
        const task = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        await task.settled;
        const { taskId } = task.result;

        const watch1 = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        const watch2 = new Watch<Task[]>((v, e) => child2.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => {
          expect(watch1.value).toHaveLength(1);
          expect(watch2.value).toHaveLength(1);
        });

        // The second device may or may not have seen the first completion yet;
        // either way the server must refuse it. Sequential so the winner is known.
        await child.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'mid' }).settled;
        await rejectsWith(child2.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: true, rewardTier: 'mid' }), 'permission-denied');

        await eventually(() => {
          expect(watch1.value?.[0]).toMatchObject({ status: 'done', talkFlag: false });
          expect(watch2.value?.[0]).toMatchObject({ status: 'done', talkFlag: false });
        });
        watch1.close();
        watch2.close();
      });
    });

    describe('rewards', () => {
      const adhocFor = async (admin: DataStore, worldId: string, profileId: ProfileId, input = {}) => {
        const task = admin.tasks.createAdhocTask(worldId, { ...adhoc(profileId), ...input });
        await task.settled;
        return task.result.taskId;
      };

      it('is created with the completion, unopened, with the task’s profile, week and the drawn tier', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const taskId = await adhocFor(admin, worldId, childProfileId);

        const rewards = new Watch<Reward[]>((v, e) => child.rewards.observeUnopenedRewards(worldId, childProfileId, v, e));
        expect(await rewards.current()).toEqual([]);

        now = Date.parse('2026-10-25T23:30:00Z');
        await child.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'high' }).settled;

        await eventually(() => expect(rewards.value).toHaveLength(1));
        expect(rewards.value?.[0]).toMatchObject({
          id: taskId,
          profileId: childProfileId,
          weekKey: weekKey(now, DEFAULT_RULESET.timezone),
          tier: 'high',
          openedAt: null,
        });
        rewards.close();
      });

      it('lists the unopened rewards oldest first', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const first = await adhocFor(admin, worldId, childProfileId, { title: 'First' });
        const second = await adhocFor(admin, worldId, childProfileId, { title: 'Second' });
        const rewards = new Watch<Reward[]>((v, e) => child.rewards.observeUnopenedRewards(worldId, childProfileId, v, e));

        now = START + 5000;
        await child.tasks.completeTaskWithReward(worldId, second, { answer: null, talkFlag: false, rewardTier: 'low' }).settled;
        now = START + 9000;
        await child.tasks.completeTaskWithReward(worldId, first, { answer: null, talkFlag: false, rewardTier: 'mid' }).settled;

        await eventually(() => expect(rewards.value?.map((r) => r.id)).toEqual([second, first]));
        rewards.close();
      });

      it('creates the reward when the question was answered yes', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const taskId = await adhocFor(admin, worldId, childProfileId, { question: 'Did you wash your hands?' });
        await child.tasks.completeTaskWithReward(worldId, taskId, { answer: 'yes', talkFlag: false, rewardTier: 'low' }).settled;

        const rewards = new Watch<Reward[]>((v, e) => child.rewards.observeUnopenedRewards(worldId, childProfileId, v, e));
        await eventually(() => expect(rewards.value?.map((r) => r.id)).toEqual([taskId]));
        rewards.close();
      });

      it('is one reward when two devices of the same profile complete the same task', async () => {
        const { admin, child, child2, worldId, childProfileId } = await setup();
        const taskId = await adhocFor(admin, worldId, childProfileId);
        const watch1 = new Watch<Reward[]>((v, e) => child.rewards.observeUnopenedRewards(worldId, childProfileId, v, e));
        const watch2 = new Watch<Reward[]>((v, e) => child2.rewards.observeUnopenedRewards(worldId, childProfileId, v, e));
        const tasks1 = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        const tasks2 = new Watch<Task[]>((v, e) => child2.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => {
          expect(tasks1.value).toHaveLength(1);
          expect(tasks2.value).toHaveLength(1);
        });

        await child.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'mid' }).settled;
        await rejectsWith(
          child2.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'high' }),
          'permission-denied',
        );

        await eventually(() => {
          expect(tasks1.value?.[0]?.status).toBe('done');
          expect(tasks2.value?.[0]?.status).toBe('done');
          expect(watch1.value).toHaveLength(1);
          expect(watch2.value).toHaveLength(1);
          expect(watch1.value?.[0]?.tier).toBe('mid');
          expect(watch2.value?.[0]?.tier).toBe('mid');
        });
        for (const watch of [watch1, watch2, tasks1, tasks2]) watch.close();
      });

      it('is readable by an admin, and refused to a child on another profile', async () => {
        const { admin, child, worldId, childProfileId, adminProfileId } = await setup();
        const taskId = await adhocFor(admin, worldId, childProfileId);
        await child.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'low' }).settled;

        const asAdmin = new Watch<Reward[]>((v, e) => admin.rewards.observeUnopenedRewards(worldId, childProfileId, v, e));
        await eventually(() => expect(asAdmin.value?.map((r) => r.id)).toEqual([taskId]));
        asAdmin.close();

        const other = new Watch<Reward[]>((v, e) => child.rewards.observeUnopenedRewards(worldId, adminProfileId, v, e));
        await eventually(() => expect(other.error?.code).toBe('permission-denied'));
        other.close();
      });

      it('refuses a tier that does not exist, before any write', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const taskId = await adhocFor(admin, worldId, childProfileId);
        await rejectsWith(
          child.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'epic' as never }),
          'invalid-argument',
        );
      });
    });

    describe('opening a reward', () => {
      /** A child with one completed task, hence one unopened reward. */
      async function withReward(tier: 'low' | 'mid' | 'high' = 'high') {
        const env = await setup();
        const task = env.admin.tasks.createAdhocTask(env.worldId, adhoc(env.childProfileId));
        await task.settled;
        const rewardId = task.result.taskId;
        await env.child.tasks.completeTaskWithReward(env.worldId, rewardId, { answer: null, talkFlag: false, rewardTier: tier }).settled;
        return { ...env, rewardId };
      }

      it('creates the collectible with the reward’s tier and profile and the drawn slot, and the reward leaves the unopened', async () => {
        const { child, worldId, childProfileId, rewardId } = await withReward('high');
        const unopened = new Watch<Reward[]>((v, e) => child.rewards.observeUnopenedRewards(worldId, childProfileId, v, e));
        const owned = new Watch<Collectible[]>((v, e) => child.collectibles.observeCollectibles(worldId, childProfileId, v, e));
        await eventually(() => expect(unopened.value).toHaveLength(1));
        expect(await owned.current()).toEqual([]);

        now = Date.parse('2026-10-25T10:00:00Z');
        await child.rewards.openReward(worldId, rewardId, { slot: 'dragon' }).settled;

        await eventually(() => {
          expect(unopened.value).toEqual([]);
          expect(owned.value).toHaveLength(1);
        });
        expect(owned.value?.[0]).toMatchObject({
          id: rewardId,
          profileId: childProfileId,
          slot: 'dragon',
          tier: 'high',
          nickname: null,
          obtainedWeekKey: weekKey(now, DEFAULT_RULESET.timezone),
          obtainedAt: now,
          reserveAt: null,
        });
        unopened.close();
        owned.close();
      });

      it('gives one collectible when two devices of the same profile open the same reward', async () => {
        const { child, child2, worldId, childProfileId, rewardId } = await withReward('mid');
        const owned1 = new Watch<Collectible[]>((v, e) => child.collectibles.observeCollectibles(worldId, childProfileId, v, e));
        const owned2 = new Watch<Collectible[]>((v, e) => child2.collectibles.observeCollectibles(worldId, childProfileId, v, e));
        const open2 = new Watch<Reward[]>((v, e) => child2.rewards.observeUnopenedRewards(worldId, childProfileId, v, e));
        await eventually(() => expect(open2.value).toHaveLength(1));

        await child.rewards.openReward(worldId, rewardId, { slot: 'fox' }).settled;
        await rejectsWith(child2.rewards.openReward(worldId, rewardId, { slot: 'lion' }), 'permission-denied');

        await eventually(() => {
          expect(owned1.value?.map((c) => c.slot)).toEqual(['fox']);
          expect(owned2.value?.map((c) => c.slot)).toEqual(['fox']);
          expect(open2.value).toEqual([]);
        });
        for (const watch of [owned1, owned2, open2]) watch.close();
      });

      it('refuses someone else’s reward, even an admin’s, and changes nothing', async () => {
        const { admin, child, worldId, childProfileId, rewardId } = await withReward();
        await rejectsWith(admin.rewards.openReward(worldId, rewardId, { slot: 'dragon' }), 'permission-denied');

        const unopened = new Watch<Reward[]>((v, e) => child.rewards.observeUnopenedRewards(worldId, childProfileId, v, e));
        const owned = new Watch<Collectible[]>((v, e) => child.collectibles.observeCollectibles(worldId, childProfileId, v, e));
        await eventually(() => expect(unopened.value?.map((r) => r.id)).toEqual([rewardId]));
        expect(await owned.current()).toEqual([]);
        unopened.close();
        owned.close();
      });

      it('refuses a reward that is already opened, and nothing changes', async () => {
        const { child, worldId, childProfileId, rewardId } = await withReward();
        await child.rewards.openReward(worldId, rewardId, { slot: 'dragon' }).settled;
        await rejectsWith(child.rewards.openReward(worldId, rewardId, { slot: 'unicorn' }), 'permission-denied');

        const owned = new Watch<Collectible[]>((v, e) => child.collectibles.observeCollectibles(worldId, childProfileId, v, e));
        await eventually(() => expect(owned.value?.map((c) => c.slot)).toEqual(['dragon']));
        owned.close();
      });

      it('refuses a reward that does not exist, and an empty slot', async () => {
        const { child, worldId, rewardId } = await withReward();
        // Which refusal a missing reward gets depends on whether the backend can tell it from a forbidden one.
        await expect(child.rewards.openReward(worldId, 'nothing-here', { slot: 'dragon' }).settled).rejects.toBeInstanceOf(DataStoreError);
        await rejectsWith(child.rewards.openReward(worldId, rewardId, { slot: '' }), 'invalid-argument');
      });

      it('lets an admin read the collectibles of a child', async () => {
        const { admin, child, worldId, childProfileId, rewardId } = await withReward();
        await child.rewards.openReward(worldId, rewardId, { slot: 'dragon' }).settled;

        const asAdmin = new Watch<Collectible[]>((v, e) => admin.collectibles.observeCollectibles(worldId, childProfileId, v, e));
        await eventually(() => expect(asAdmin.value?.map((c) => c.id)).toEqual([rewardId]));
        asAdmin.close();
      });
    });

    describe('party and reserve', () => {
      /** The child opens `count` rewards, one second apart; returns the collectible ids, oldest first. */
      async function withCollectibles(count: number) {
        const env = await setup();
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
          now = START + 1000 * (i + 1);
          const task = env.admin.tasks.createAdhocTask(env.worldId, adhoc(env.childProfileId, `Task ${i}`));
          await task.settled;
          const id = task.result.taskId;
          await env.child.tasks.completeTaskWithReward(env.worldId, id, { answer: null, talkFlag: false, rewardTier: 'low' }).settled;
          await env.child.rewards.openReward(env.worldId, id, { slot: `slot${i}` }).settled;
          ids.push(id);
        }
        const profiles = new Watch<Profile[]>((v, e) => env.child.worlds.observeProfiles(env.worldId, v, e));
        const owned = new Watch<Collectible[]>((v, e) => env.child.collectibles.observeCollectibles(env.worldId, env.childProfileId, v, e));
        await eventually(() => expect(owned.value).toHaveLength(count));
        const partyOf = () => profiles.value?.find((p) => p.id === env.childProfileId)?.partyIds;
        const reserveOf = (id: string) => owned.value?.find((c) => c.id === id)?.reserveAt;
        return { ...env, ids, profiles, owned, partyOf, reserveOf };
      }
      const arrange = (partyIds: string[], toReserve: string[] = [], fromReserve: string[] = []) => ({ partyIds, toReserve, fromReserve });

      it('adds to a party with room: partyIds grows and the collectible stays out of the reserve', async () => {
        const { child, worldId, childProfileId, ids, partyOf, reserveOf, profiles, owned } = await withCollectibles(2);
        await child.collectibles.arrangeParty(worldId, childProfileId, arrange([ids[0]!])).settled;
        await child.collectibles.arrangeParty(worldId, childProfileId, arrange([ids[0]!, ids[1]!])).settled;
        await eventually(() => expect(partyOf()).toEqual([ids[0], ids[1]]));
        expect(reserveOf(ids[1]!)).toBeNull();
        profiles.close();
        owned.close();
      });

      it('adds to a full party when the chosen one leaves for the reserve at the time of the call', async () => {
        const { child, worldId, childProfileId, ids, partyOf, reserveOf, profiles, owned } = await withCollectibles(6);
        const first = ids.slice(0, 5);
        await child.collectibles.arrangeParty(worldId, childProfileId, arrange(first)).settled;

        now = START + 60_000;
        await child.collectibles.arrangeParty(worldId, childProfileId, arrange([...first.slice(0, 4), ids[5]!], [first[4]!])).settled;
        await eventually(() => {
          expect(partyOf()).toEqual([...first.slice(0, 4), ids[5]]);
          expect(reserveOf(first[4]!)).toBe(now);
          expect(reserveOf(ids[5]!)).toBeNull();
        });
        profiles.close();
        owned.close();
      });

      it('refuses a sixth collectible without anyone leaving, before any write', async () => {
        const { child, worldId, childProfileId, ids, partyOf, profiles, owned } = await withCollectibles(6);
        const first = ids.slice(0, 5);
        await child.collectibles.arrangeParty(worldId, childProfileId, arrange(first)).settled;
        await rejectsWith(child.collectibles.arrangeParty(worldId, childProfileId, arrange(ids)), 'invalid-argument');
        await eventually(() => expect(partyOf()).toEqual(first));
        profiles.close();
        owned.close();
      });

      it('brings a collectible back from the reserve into the party', async () => {
        const { child, worldId, childProfileId, ids, partyOf, reserveOf, profiles, owned } = await withCollectibles(2);
        now = START + 60_000;
        await child.collectibles.arrangeParty(worldId, childProfileId, arrange([], [ids[0]!])).settled;
        await eventually(() => expect(reserveOf(ids[0]!)).toBe(now));

        await child.collectibles.arrangeParty(worldId, childProfileId, arrange([ids[0]!], [], [ids[0]!])).settled;
        await eventually(() => {
          expect(partyOf()).toEqual([ids[0]]);
          expect(reserveOf(ids[0]!)).toBeNull();
        });
        profiles.close();
        owned.close();
      });

      it('does not rewrite the party when only collectibles move to the reserve', async () => {
        const { child, child2, worldId, childProfileId, ids, partyOf, reserveOf, profiles, owned } = await withCollectibles(2);
        // Another device of the same profile put the first one in the party; this device has not seen it yet,
        // but a move that leaves the party as it was must not write it.
        await child.collectibles.arrangeParty(worldId, childProfileId, arrange([ids[0]!])).settled;
        await eventually(() => expect(partyOf()).toEqual([ids[0]]));
        now = START + 60_000;
        await child2.collectibles.arrangeParty(worldId, childProfileId, arrange([ids[0]!], [ids[1]!])).settled;
        await eventually(() => {
          expect(partyOf()).toEqual([ids[0]]);
          expect(reserveOf(ids[1]!)).toBe(now);
        });
        profiles.close();
        owned.close();
      });

      it('refuses what the checks refuse, before any write', async () => {
        const { child, worldId, childProfileId, ids, profiles, owned } = await withCollectibles(2);
        await rejectsWith(child.collectibles.arrangeParty(worldId, childProfileId, arrange(['nothing'])), 'invalid-argument');
        await rejectsWith(child.collectibles.arrangeParty(worldId, childProfileId, arrange([ids[0]!, ids[0]!])), 'invalid-argument');
        await rejectsWith(child.collectibles.arrangeParty(worldId, childProfileId, arrange([], [ids[0]!], [ids[0]!])), 'invalid-argument');
        profiles.close();
        owned.close();
      });

      it('is refused to another profile, even an admin, and changes nothing', async () => {
        const { admin, worldId, childProfileId, ids, partyOf, profiles, owned } = await withCollectibles(1);
        await rejectsWith(admin.collectibles.arrangeParty(worldId, childProfileId, arrange([ids[0]!])), 'permission-denied');
        await eventually(() => expect(partyOf()).toEqual([]));
        profiles.close();
        owned.close();
      });
    });

    describe('nicknames', () => {
      async function withCollectible() {
        const env = await setup();
        const task = env.admin.tasks.createAdhocTask(env.worldId, adhoc(env.childProfileId));
        await task.settled;
        const id = task.result.taskId;
        await env.child.tasks.completeTaskWithReward(env.worldId, id, { answer: null, talkFlag: false, rewardTier: 'low' }).settled;
        await env.child.rewards.openReward(env.worldId, id, { slot: 'slot0' }).settled;
        const owned = new Watch<Collectible[]>((v, e) => env.admin.collectibles.observeCollectibles(env.worldId, env.childProfileId, v, e));
        await eventually(() => expect(owned.value).toHaveLength(1));
        const nickname = () => owned.value?.[0]?.nickname;
        return { ...env, id, owned, nickname };
      }

      it('lets the owner set a trimmed nickname, then clear it', async () => {
        const { child, worldId, id, owned, nickname } = await withCollectible();
        await child.collectibles.setNickname(worldId, id, '  Rex ').settled;
        await eventually(() => expect(nickname()).toBe('Rex'));
        await child.collectibles.setNickname(worldId, id, '   ').settled;
        await eventually(() => expect(nickname()).toBeNull());
        owned.close();
      });

      it('accepts 30 characters and refuses 31 before any write', async () => {
        const { child, worldId, id, owned, nickname } = await withCollectible();
        await child.collectibles.setNickname(worldId, id, 'x'.repeat(LIMITS.nickname)).settled;
        await eventually(() => expect(nickname()).toBe('x'.repeat(LIMITS.nickname)));
        await rejectsWith(child.collectibles.setNickname(worldId, id, 'y'.repeat(LIMITS.nickname + 1)), 'invalid-argument');
        expect(nickname()).toBe('x'.repeat(LIMITS.nickname));
        owned.close();
      });

      it('lets an admin rename another profile’s collectible (moderation)', async () => {
        const { admin, worldId, id, owned, nickname } = await withCollectible();
        await admin.collectibles.setNickname(worldId, id, 'Moderated').settled;
        await eventually(() => expect(nickname()).toBe('Moderated'));
        owned.close();
      });

      it('refuses another child', async () => {
        const { admin, newcomer, worldId, id, owned, nickname } = await withCollectible();
        const other = admin.worlds.createProfile(worldId, { displayName: 'Robin', kind: 'child' });
        await other.settled;
        await newcomer.worlds.chooseProfile(worldId, other.result.profileId).settled;
        await rejectsWith(newcomer.collectibles.setNickname(worldId, id, 'Mine now'), 'permission-denied');
        expect(nickname()).toBeNull();
        owned.close();
      });
    });

    describe('showcase', () => {
      /** Opens one collectible for the device's profile and moves it to the reserve at `at`. */
      async function reserved(device: DataStore, adminDevice: DataStore, worldId: string, profileId: ProfileId, title: string, at: Millis) {
        const task = adminDevice.tasks.createAdhocTask(worldId, adhoc(profileId, title));
        await task.settled;
        const id = task.result.taskId;
        await device.tasks.completeTaskWithReward(worldId, id, { answer: null, talkFlag: false, rewardTier: 'low' }).settled;
        await device.rewards.openReward(worldId, id, { slot: `slot-${title}` }).settled;
        now = at;
        await device.collectibles.arrangeParty(worldId, profileId, { partyIds: [], toReserve: [id], fromReserve: [] }).settled;
        return id;
      }

      it('lists the reserve of every profile, newest first, on every device, without the owner', async () => {
        const { admin, child, newcomer, worldId, adminProfileId, childProfileId } = await setup();
        const a = await reserved(child, admin, worldId, childProfileId, 'a', START + 1000);
        const b = await reserved(admin, admin, worldId, adminProfileId, 'b', START + 2000);
        const c = await reserved(child, admin, worldId, childProfileId, 'c', START + 3000);
        for (const device of [admin, child, newcomer]) {
          const showcase = new Watch<ShowcaseItem[]>((v, e) => device.collectibles.observeShowcase(worldId, 30, v, e));
          await eventually(() => expect(showcase.value?.map((item) => item.id)).toEqual([c, b, a]));
          for (const item of showcase.value!) {
            expect(Object.keys(item).sort()).toEqual(['id', 'nickname', 'reserveAt', 'slot', 'tier']);
            expect(item).not.toHaveProperty('profileId');
          }
          expect(showcase.value![0]).toMatchObject({ slot: 'slot-c', tier: 'low', nickname: null, reserveAt: START + 3000 });
          showcase.close();
        }
      });

      it('shows only the newest ones up to the limit, and keeps the others stored', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const ids: string[] = [];
        for (const [i, title] of ['a', 'b', 'c'].entries()) ids.push(await reserved(child, admin, worldId, childProfileId, title, START + 1000 * (i + 1)));
        const showcase = new Watch<ShowcaseItem[]>((v, e) => admin.collectibles.observeShowcase(worldId, 2, v, e));
        await eventually(() => expect(showcase.value?.map((item) => item.id)).toEqual([ids[2], ids[1]]));
        const owned = new Watch<Collectible[]>((v, e) => child.collectibles.observeCollectibles(worldId, childProfileId, v, e));
        await eventually(() => expect(owned.value).toHaveLength(3));
        showcase.close();
        owned.close();
      });

      it('drops a collectible that goes back to the party, and shows a new nickname', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const a = await reserved(child, admin, worldId, childProfileId, 'a', START + 1000);
        const b = await reserved(child, admin, worldId, childProfileId, 'b', START + 2000);
        const showcase = new Watch<ShowcaseItem[]>((v, e) => admin.collectibles.observeShowcase(worldId, 30, v, e));
        await eventually(() => expect(showcase.value).toHaveLength(2));
        await admin.collectibles.setNickname(worldId, a, 'Moderated').settled;
        await eventually(() => expect(showcase.value?.find((item) => item.id === a)?.nickname).toBe('Moderated'));
        await child.collectibles.arrangeParty(worldId, childProfileId, { partyIds: [b], toReserve: [], fromReserve: [b] }).settled;
        await eventually(() => expect(showcase.value?.map((item) => item.id)).toEqual([a]));
        showcase.close();
      });
    });

    describe('profile symbols', () => {
      const profilesOf = (device: DataStore, worldId: string) => new Watch<Profile[]>((v, e) => device.worlds.observeProfiles(worldId, v, e));
      const symbolOf = (watch: Watch<Profile[]>, id: string) => watch.value?.find((p) => p.id === id)?.avatar.symbol;

      it('starts with no symbol, and lets the owner choose and clear one without touching the rest of the avatar', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const profiles = profilesOf(admin, worldId);
        await eventually(() => expect(symbolOf(profiles, childProfileId)).toBeNull());
        await child.worlds.setProfileSymbol(worldId, childProfileId, '🦀').settled;
        await eventually(() => expect(symbolOf(profiles, childProfileId)).toBe('🦀'));
        expect(profiles.value!.find((p) => p.id === childProfileId)!.avatar).toEqual({ body: 0, hair: 0, outfit: 0, accessory: 0, symbol: '🦀' });
        await child.worlds.setProfileSymbol(worldId, childProfileId, null).settled;
        await eventually(() => expect(symbolOf(profiles, childProfileId)).toBeNull());
        profiles.close();
      });

      it('lets an admin choose the symbol of another profile', async () => {
        const { admin, worldId, childProfileId } = await setup();
        const profiles = profilesOf(admin, worldId);
        await admin.worlds.setProfileSymbol(worldId, childProfileId, '🐙').settled;
        await eventually(() => expect(symbolOf(profiles, childProfileId)).toBe('🐙'));
        profiles.close();
      });

      it('refuses a child choosing the symbol of another profile', async () => {
        const { admin, child, worldId, adminProfileId } = await setup();
        const profiles = profilesOf(admin, worldId);
        await rejectsWith(child.worlds.setProfileSymbol(worldId, adminProfileId, '🐬'), 'permission-denied');
        expect(symbolOf(profiles, adminProfileId)).toBeNull();
        profiles.close();
      });

      it('accepts any single emoji, and refuses anything else before any write', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const profiles = profilesOf(admin, worldId);
        await child.worlds.setProfileSymbol(worldId, childProfileId, '🏴‍☠️').settled;
        await eventually(() => expect(symbolOf(profiles, childProfileId)).toBe('🏴‍☠️'));
        await rejectsWith(child.worlds.setProfileSymbol(worldId, childProfileId, 'x'), 'invalid-argument');
        await rejectsWith(child.worlds.setProfileSymbol(worldId, childProfileId, '🐬🦀'), 'invalid-argument');
        expect(symbolOf(profiles, childProfileId)).toBe('🏴‍☠️');
        profiles.close();
      });

      it('lets an admin choose a symbol when creating a profile, and refuses one outside the list', async () => {
        const { admin, worldId } = await setup();
        const created = admin.worlds.createProfile(worldId, { displayName: 'Robin', kind: 'child', symbol: '🐬' });
        await created.settled;
        const profiles = profilesOf(admin, worldId);
        await eventually(() => expect(symbolOf(profiles, created.result.profileId)).toBe('🐬'));
        await rejectsWith(admin.worlds.createProfile(worldId, { displayName: 'Kim', kind: 'child', symbol: 'x' }), 'invalid-argument');
        await eventually(() => expect(profiles.value!.some((p) => p.displayName === 'Kim')).toBe(false));
        profiles.close();
      });
    });

    describe('showcase size', () => {
      it('is changed by an admin, and every device sees it', async () => {
        const { admin, child, worldId } = await setup();
        await admin.worlds.setShowcaseSize(worldId, 12).settled;
        const world = new Watch<World>((v, e) => child.worlds.observeWorld(worldId, v, e));
        await eventually(() => expect(world.value?.ruleset.showcaseSize).toBe(12));
        expect(world.value?.ruleset.partySize).toBe(DEFAULT_RULESET.partySize);
        world.close();
      });

      it('is refused to a child, and must be a whole number from 1 to 30, before any write', async () => {
        const { admin, child, worldId } = await setup();
        await rejectsWith(child.worlds.setShowcaseSize(worldId, 12), 'permission-denied');
        for (const size of [0, 31, 2.5, Number.NaN]) await rejectsWith(admin.worlds.setShowcaseSize(worldId, size), 'invalid-argument');
      });
    });

    describe('talk flag', () => {
      it('is set and cleared by the owner on an open task, and refused on a done one', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const task = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        await task.settled;
        const { taskId } = task.result;

        const watch = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        await child.tasks.setTalkFlag(worldId, taskId, true).settled;
        await eventually(() => expect(watch.value?.[0]?.talkFlag).toBe(true));
        await child.tasks.setTalkFlag(worldId, taskId, false).settled;
        await eventually(() => expect(watch.value?.[0]?.talkFlag).toBe(false));

        await rejectsWith(admin.tasks.setTalkFlag(worldId, taskId, true), 'permission-denied');

        await child.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'mid' }).settled;
        await rejectsWith(child.tasks.setTalkFlag(worldId, taskId, true), 'permission-denied');
        await eventually(() => expect(watch.value?.[0]).toMatchObject({ status: 'done', talkFlag: false }));
        watch.close();
      });
    });

    describe('task definitions', () => {
      const def = (overrides: Partial<TaskDefInput> = {}): TaskDefInput => ({
        title: 'Make the bed',
        cadence: 'daily',
        level: 'low',
        assignedTo: [],
        question: null,
        big: false,
        ...overrides,
      });

      it('lets an admin create one, active, and every device sees it', async () => {
        const { admin, child, worldId } = await setup();
        const created = admin.taskDefs.createTaskDef(worldId, def({ question: 'Did you make it?' }));
        await created.settled;

        for (const device of [admin, child]) {
          const watch = new Watch<TaskDef[]>((v, e) => device.taskDefs.observeTaskDefs(worldId, v, e));
          await eventually(() => expect(watch.value).toHaveLength(1));
          expect(watch.value?.[0]).toMatchObject({
            id: created.result.defId,
            title: 'Make the bed',
            cadence: 'daily',
            level: 'low',
            assignedTo: [],
            question: 'Did you make it?',
            big: false,
            active: true,
          });
          watch.close();
        }
      });

      it('lists them ordered by title, inactive ones included', async () => {
        const { admin, worldId } = await setup();
        await admin.taskDefs.createTaskDef(worldId, def({ title: 'b' })).settled;
        const second = admin.taskDefs.createTaskDef(worldId, def({ title: 'a' }));
        await second.settled;
        await admin.taskDefs.updateTaskDef(worldId, second.result.defId, { active: false }).settled;

        const watch = new Watch<TaskDef[]>((v, e) => admin.taskDefs.observeTaskDefs(worldId, v, e));
        await eventually(() => expect(watch.value?.map((d) => [d.title, d.active])).toEqual([['a', false], ['b', true]]));
        watch.close();
      });

      it('refuses a device on a child profile, for creating and for updating', async () => {
        const { admin, child, worldId } = await setup();
        await rejectsWith(child.taskDefs.createTaskDef(worldId, def()), 'permission-denied');

        const created = admin.taskDefs.createTaskDef(worldId, def());
        await created.settled;
        await rejectsWith(child.taskDefs.updateTaskDef(worldId, created.result.defId, { title: 'Changed' }), 'permission-denied');
        await rejectsWith(child.taskDefs.updateTaskDef(worldId, created.result.defId, { active: false }), 'permission-denied');

        const watch = new Watch<TaskDef[]>((v, e) => admin.taskDefs.observeTaskDefs(worldId, v, e));
        await eventually(() => expect(watch.value?.map((d) => [d.title, d.active])).toEqual([['Make the bed', true]]));
        watch.close();
      });

      it('refuses a device that has not chosen a profile', async () => {
        const { newcomer, worldId } = await setup();
        await rejectsWith(newcomer.taskDefs.createTaskDef(worldId, def()), 'permission-denied');
      });

      it('deactivates and reactivates, and both changes are emitted', async () => {
        const { admin, child, worldId } = await setup();
        const created = admin.taskDefs.createTaskDef(worldId, def());
        await created.settled;
        const { defId } = created.result;

        const watch = new Watch<TaskDef[]>((v, e) => child.taskDefs.observeTaskDefs(worldId, v, e));
        await admin.taskDefs.updateTaskDef(worldId, defId, { active: false }).settled;
        await eventually(() => expect(watch.value?.[0]?.active).toBe(false));
        await admin.taskDefs.updateTaskDef(worldId, defId, { active: true }).settled;
        await eventually(() => expect(watch.value?.[0]?.active).toBe(true));
        watch.close();
      });

      it('edits any field, and clears the question and the list of profiles', async () => {
        const { admin, worldId, childProfileId } = await setup();
        const created = admin.taskDefs.createTaskDef(worldId, def({ question: 'Done?' }));
        await created.settled;
        const { defId } = created.result;

        await admin.taskDefs
          .updateTaskDef(worldId, defId, {
            title: 'Tidy the room',
            cadence: 'weekly',
            level: 'high',
            assignedTo: [childProfileId],
            question: null,
            big: true,
          })
          .settled;
        const watch = new Watch<TaskDef[]>((v, e) => admin.taskDefs.observeTaskDefs(worldId, v, e));
        await eventually(() =>
          expect(watch.value?.[0]).toMatchObject({
            title: 'Tidy the room',
            cadence: 'weekly',
            level: 'high',
            assignedTo: [childProfileId],
            question: null,
            big: true,
            active: true,
          }),
        );
        await admin.taskDefs.updateTaskDef(worldId, defId, { assignedTo: [] }).settled;
        await eventually(() => expect(watch.value?.[0]?.assignedTo).toEqual([]));
        watch.close();
      });

      it('rejects a title or a question over the limit with invalid-argument, before any write', async () => {
        const { admin, worldId } = await setup();
        await rejectsWith(admin.taskDefs.createTaskDef(worldId, def({ title: 'x'.repeat(LIMITS.title + 1) })), 'invalid-argument');
        await rejectsWith(admin.taskDefs.createTaskDef(worldId, def({ title: '' })), 'invalid-argument');
        await rejectsWith(admin.taskDefs.createTaskDef(worldId, def({ question: 'x'.repeat(LIMITS.question + 1) })), 'invalid-argument');

        const created = admin.taskDefs.createTaskDef(worldId, def());
        await created.settled;
        await rejectsWith(admin.taskDefs.updateTaskDef(worldId, created.result.defId, { title: 'x'.repeat(LIMITS.title + 1) }), 'invalid-argument');
        await rejectsWith(admin.taskDefs.updateTaskDef(worldId, created.result.defId, { question: 'x'.repeat(LIMITS.question + 1) }), 'invalid-argument');

        const watch = new Watch<TaskDef[]>((v, e) => admin.taskDefs.observeTaskDefs(worldId, v, e));
        await eventually(() => expect(watch.value?.map((d) => d.title)).toEqual(['Make the bed']));
        watch.close();
      });

      it('leaves existing tasks alone when the definition changes', async () => {
        // Tasks are separate documents that copy the definition when they are
        // created. The full case, with a recurring task, is in the generation tests (0.3.3).
        const { admin, child, worldId, childProfileId } = await setup();
        const created = admin.taskDefs.createTaskDef(worldId, def());
        await created.settled;
        const task = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId, 'Old title'));
        await task.settled;

        await admin.taskDefs.updateTaskDef(worldId, created.result.defId, { title: 'New title', level: 'high' }).settled;

        const watch = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(watch.value).toHaveLength(1));
        expect(watch.value?.[0]).toMatchObject({ title: 'Old title', level: 'mid' });
        watch.close();
      });
    });

    describe('recurring tasks', () => {
      /** A daily definition for everyone, and the task it yields for `profileId` today. */
      async function withDef(admin: DataStore, worldId: string, profileId: ProfileId, overrides: Partial<TaskDefInput> = {}) {
        const created = admin.taskDefs.createTaskDef(worldId, {
          title: 'Make the bed',
          cadence: 'daily',
          level: 'low',
          assignedTo: [],
          question: 'Did you make it?',
          big: false,
          ...overrides,
        });
        await created.settled;
        const defId = created.result.defId;
        const task: NewRecurringTask = {
          id: `${defId}_2026-10-18_${profileId}`,
          defId,
          periodKey: '2026-10-18',
          profileId,
          title: overrides.title ?? 'Make the bed',
          level: overrides.level ?? 'low',
          question: overrides.question === undefined ? 'Did you make it?' : overrides.question,
        };
        return { defId, task };
      }

      it('creates the task for its owner, with the values of the definition', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const { task } = await withDef(admin, worldId, childProfileId);

        await child.tasks.createRecurringTasks(worldId, [task]).settled;

        const watch = new Watch<Task[]>((v, e) => child.tasks.observeOpenTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(watch.value).toHaveLength(1));
        expect(watch.value?.[0]).toMatchObject({
          id: task.id,
          profileId: childProfileId,
          title: 'Make the bed',
          level: 'low',
          question: 'Did you make it?',
          source: 'recurring',
          defId: task.defId,
          periodKey: '2026-10-18',
          createdBy: childProfileId,
          origin: 'app',
          plan: null,
          status: 'open',
        });
        watch.close();
      });

      it('leaves a task that exists unchanged, open or done, and settles', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const { task } = await withDef(admin, worldId, childProfileId, { question: null });
        const watch = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));

        await child.tasks.createRecurringTasks(worldId, [task]).settled;
        await child.tasks.setTalkFlag(worldId, task.id, true).settled;
        now += 1000;
        await child.tasks.createRecurringTasks(worldId, [task]).settled;
        // Firestore shows the rewrite locally until the server refuses it, then reverts.
        await eventually(() => {
          expect(watch.value).toHaveLength(1);
          expect(watch.value?.[0]).toMatchObject({ status: 'open', talkFlag: true, createdAt: START });
        });

        await child.tasks.completeTaskWithReward(worldId, task.id, { answer: null, talkFlag: true, rewardTier: 'mid' }).settled;
        now += 1000;
        await child.tasks.createRecurringTasks(worldId, [task]).settled;
        await eventually(() => {
          expect(watch.value).toHaveLength(1);
          expect(watch.value?.[0]).toMatchObject({ status: 'done', talkFlag: true, createdAt: START });
        });
        watch.close();
      });

      it('ends with one task when two devices of the same profile generate at once', async () => {
        const { admin, child, child2, worldId, childProfileId } = await setup();
        const { task } = await withDef(admin, worldId, childProfileId);

        await Promise.all([
          child.tasks.createRecurringTasks(worldId, [task]).settled,
          child2.tasks.createRecurringTasks(worldId, [task]).settled,
        ]);

        for (const device of [child, child2]) {
          const watch = new Watch<Task[]>((v, e) => device.tasks.observeTasks(worldId, childProfileId, v, e));
          await eventually(() => expect(watch.value).toHaveLength(1));
          watch.close();
        }
      });

      it('creates the other tasks even when one is refused', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const first = await withDef(admin, worldId, childProfileId, { title: 'A' });
        const second = await withDef(admin, worldId, childProfileId, { title: 'B' });
        const inactive = await withDef(admin, worldId, childProfileId, { title: 'C' });
        await admin.taskDefs.updateTaskDef(worldId, inactive.defId, { active: false }).settled;

        await child.tasks.createRecurringTasks(worldId, [first.task, inactive.task, second.task]).settled;

        const watch = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(watch.value?.map((t) => t.title).sort()).toEqual(['A', 'B']));
        watch.close();
      });

      it('refuses silently a definition edited after the device cached it, and creates it with the new values next time', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const { defId, task } = await withDef(admin, worldId, childProfileId);
        const defs = new Watch<TaskDef[]>((v, e) => child.taskDefs.observeTaskDefs(worldId, v, e));
        await eventually(() => expect(defs.value?.[0]?.title).toBe('Make the bed'));

        // The admin edits it; the child, still holding the old values, tries to create the task.
        await admin.taskDefs.updateTaskDef(worldId, defId, { title: 'Make the bed well' }).settled;
        await child.tasks.createRecurringTasks(worldId, [task]).settled;

        const tasks = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(tasks.value).toEqual([]));

        // After syncing, the next generation uses the new values.
        await eventually(() => expect(defs.value?.[0]?.title).toBe('Make the bed well'));
        await child.tasks.createRecurringTasks(worldId, [{ ...task, title: 'Make the bed well' }]).settled;
        await eventually(() => expect(tasks.value?.map((t) => t.title)).toEqual(['Make the bed well']));
        defs.close();
        tasks.close();
      });

      it('refuses silently a task for another profile, or from an inactive or unassigned definition', async () => {
        const { admin, child, worldId, childProfileId, adminProfileId } = await setup();
        const forAdmin = await withDef(admin, worldId, adminProfileId);
        const inactive = await withDef(admin, worldId, childProfileId, { title: 'Off' });
        await admin.taskDefs.updateTaskDef(worldId, inactive.defId, { active: false }).settled;
        const unassigned = await withDef(admin, worldId, childProfileId, { title: 'Not mine', assignedTo: [adminProfileId] });

        await child.tasks.createRecurringTasks(worldId, [forAdmin.task, inactive.task, unassigned.task]).settled;

        for (const profileId of [adminProfileId, childProfileId]) {
          const watch = new Watch<Task[]>((v, e) => admin.tasks.observeTasks(worldId, profileId, v, e));
          await eventually(() => expect(watch.value).toEqual([]));
          watch.close();
        }
      });

      it('rejects a task whose id does not match, or whose title is too long, with invalid-argument', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const { task } = await withDef(admin, worldId, childProfileId);
        await rejectsWith(child.tasks.createRecurringTasks(worldId, [{ ...task, id: 'another-id' }]), 'invalid-argument');
        await rejectsWith(child.tasks.createRecurringTasks(worldId, [{ ...task, title: 'x'.repeat(LIMITS.title + 1) }]), 'invalid-argument');
      });

      it('resolves when the profile’s tasks have been read from the server', async () => {
        const { child, worldId, childProfileId } = await setup();
        await child.tasks.whenTasksSynced(worldId, childProfileId);
      });
    });

    describe('plan', () => {
      /** A big monthly task (period 2026-10) for `profileId`, created through the recurring path. */
      async function bigTask(admin: DataStore, owner: DataStore, worldId: string, profileId: ProfileId, big = true) {
        const created = admin.taskDefs.createTaskDef(worldId, {
          title: 'Clean the garage',
          cadence: 'monthly',
          level: 'high',
          assignedTo: [],
          question: null,
          big,
        });
        await created.settled;
        const id = `${created.result.defId}_2026-10_${profileId}`;
        await owner.tasks.createRecurringTasks(worldId, [
          { id, defId: created.result.defId, periodKey: '2026-10', profileId, title: 'Clean the garage', level: 'high', question: null },
        ]).settled;
        return id;
      }

      it('is set and cleared by the owner, and every device sees it', async () => {
        const { admin, child, child2, worldId, childProfileId } = await setup();
        const taskId = await bigTask(admin, child, worldId, childProfileId);
        const mine = new Watch<Task[]>((v, e) => child2.tasks.observeTasks(worldId, childProfileId, v, e));
        const theirs = new Watch<Task[]>((v, e) => admin.tasks.observeTasks(worldId, childProfileId, v, e));

        await child.tasks.setPlan(worldId, taskId, { date: '2026-10-25', trigger: 'after dinner' }).settled;
        for (const watch of [mine, theirs]) {
          await eventually(() => expect(watch.value?.[0]?.plan).toEqual({ date: '2026-10-25', trigger: 'after dinner' }));
        }

        // Changing it, and clearing it, leave nothing behind.
        await child.tasks.setPlan(worldId, taskId, { date: '2026-10-31', trigger: 'on Saturday' }).settled;
        await eventually(() => expect(mine.value?.[0]?.plan).toEqual({ date: '2026-10-31', trigger: 'on Saturday' }));
        await child.tasks.setPlan(worldId, taskId, null).settled;
        for (const watch of [mine, theirs]) await eventually(() => expect(watch.value?.[0]?.plan).toBeNull());
        mine.close();
        theirs.close();
      });

      it('is refused to anyone but the owner, with permission-denied', async () => {
        const { admin, child, newcomer, worldId, childProfileId } = await setup();
        const taskId = await bigTask(admin, child, worldId, childProfileId);
        const plan = { date: '2026-10-25', trigger: 'after dinner' };

        await rejectsWith(admin.tasks.setPlan(worldId, taskId, plan), 'permission-denied');
        await rejectsWith(newcomer.tasks.setPlan(worldId, taskId, plan), 'permission-denied');

        const watch = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(watch.value?.[0]?.plan).toBeNull());
        watch.close();
      });

      it('is refused on a task that is not big, with invalid-argument, before any write', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const plan = { date: '2026-10-25', trigger: 'after dinner' };

        const notBig = await bigTask(admin, child, worldId, childProfileId, false);
        await rejectsWith(child.tasks.setPlan(worldId, notBig, plan), 'invalid-argument');

        const adhocTask = child.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        await adhocTask.settled;
        await rejectsWith(child.tasks.setPlan(worldId, adhocTask.result.taskId, plan), 'invalid-argument');
      });

      it('is set by the owner on a big ad hoc task made by an admin, on any day from today on, and every device sees it', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const made = admin.tasks.createAdhocTask(worldId, { ...adhoc(childProfileId), big: true });
        await made.settled;
        const { taskId } = made.result;
        const mine = new Watch<Task[]>((v, e) => child.tasks.observeTasks(worldId, childProfileId, v, e));
        const theirs = new Watch<Task[]>((v, e) => admin.tasks.observeTasks(worldId, childProfileId, v, e));
        await eventually(() => expect(mine.value?.[0]).toMatchObject({ source: 'adhoc', big: true, plan: null }));

        await child.tasks.setPlan(worldId, taskId, { date: '2027-03-01', trigger: 'after the holidays' }).settled;
        for (const watch of [mine, theirs]) {
          await eventually(() => expect(watch.value?.[0]?.plan).toEqual({ date: '2027-03-01', trigger: 'after the holidays' }));
        }
        await rejectsWith(child.tasks.setPlan(worldId, taskId, { date: '2026-10-17', trigger: 'yesterday' }), 'invalid-argument');
        await rejectsWith(admin.tasks.setPlan(worldId, taskId, { date: '2026-10-25', trigger: 'not mine' }), 'permission-denied');
        mine.close();
        theirs.close();
      });

      it('is refused on an ad hoc task that was not made big', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const made = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        await made.settled;
        await rejectsWith(child.tasks.setPlan(worldId, made.result.taskId, { date: '2026-10-25', trigger: 'x' }), 'invalid-argument');
      });

      it('is refused with a day outside the period or a bad trigger, with invalid-argument', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const taskId = await bigTask(admin, child, worldId, childProfileId);

        await rejectsWith(child.tasks.setPlan(worldId, taskId, { date: '2026-10-17', trigger: 'yesterday' }), 'invalid-argument');
        await rejectsWith(child.tasks.setPlan(worldId, taskId, { date: '2026-11-01', trigger: 'next month' }), 'invalid-argument');
        await rejectsWith(child.tasks.setPlan(worldId, taskId, { date: '2026-10-25', trigger: '' }), 'invalid-argument');
        await rejectsWith(child.tasks.setPlan(worldId, taskId, { date: '2026-10-25', trigger: 'x'.repeat(LIMITS.trigger + 1) }), 'invalid-argument');
      });

      it('cannot be set on a task that is done', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const taskId = await bigTask(admin, child, worldId, childProfileId);
        await child.tasks.completeTaskWithReward(worldId, taskId, { answer: null, talkFlag: false, rewardTier: 'mid' }).settled;
        await rejectsWith(child.tasks.setPlan(worldId, taskId, { date: '2026-10-25', trigger: 'after dinner' }), 'permission-denied');
      });
    });

    describe('no false state', () => {
      it('shows the backend state on every device after a rejected write', async () => {
        const { admin, child, worldId } = await setup();
        const profiles = new Watch<Profile[]>((v, e) => child.worlds.observeProfiles(worldId, v, e));
        const before = (await profiles.current()).length;

        const refused = child.worlds.createProfile(worldId, { displayName: 'Ghost', kind: 'child' });
        await rejectsWith(refused, 'permission-denied');

        await eventually(() => expect(profiles.value).toHaveLength(before));
        const adminProfiles = new Watch<Profile[]>((v, e) => admin.worlds.observeProfiles(worldId, v, e));
        await eventually(() => expect(adminProfiles.value).toHaveLength(before));
        expect(adminProfiles.value?.some((p) => p.id === refused.result.profileId)).toBe(false);
        profiles.close();
        adminProfiles.close();
      });
    });
  });
}
