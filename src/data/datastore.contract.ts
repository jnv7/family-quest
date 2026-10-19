/**
 * Behaviour every `DataStore` adapter must have (docs/architecture.md §5).
 *
 * The memory adapter runs it with `npm test`; the Firestore adapter runs the
 * same suite against the emulators in CI. Every rejection is checked on
 * `settled`, with the exact `DataStoreError.code`.
 */
import { describe, expect, it } from 'vitest';
import { weekKey } from '../core/calendar';
import { DEFAULT_RULESET, LIMITS, type Clock, type Millis, type Profile, type ProfileId, type Task, type TaskDef } from '../core/model';
import { DataStoreError, type DataStore, type DataStoreErrorCode, type TaskDefInput, type Unsubscribe, type Write } from './DataStore';

/** Signed-in devices that share one backend. */
export interface ContractDevices {
  admin: DataStore;
  child: DataStore;
  /** A second device, used as another child on the same profile. */
  child2: DataStore;
  /** A device that joins and never chooses a profile. */
  newcomer: DataStore;
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

        await child.tasks.completeTask(worldId, first.result.taskId, { answer: null, talkFlag: false }).settled;
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
        await child.tasks.completeTask(worldId, task.result.taskId, { answer: null, talkFlag: true }).settled;

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
        const completion = child.tasks.completeTask(worldId, task.result.taskId, { answer: null, talkFlag: false });
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

        await rejectsWith(child.tasks.completeTask(worldId, taskId, { answer: null, talkFlag: false }), 'invalid-argument');
        await rejectsWith(child.tasks.completeTask(worldId, taskId, { answer: 'no', talkFlag: false }), 'invalid-argument');
        await child.tasks.completeTask(worldId, taskId, { answer: 'yes', talkFlag: false }).settled;
      });

      it('refuses an admin completing someone else’s task', async () => {
        const { admin, child, worldId, childProfileId } = await setup();
        const task = admin.tasks.createAdhocTask(worldId, adhoc(childProfileId));
        await task.settled;
        const { taskId } = task.result;

        await rejectsWith(admin.tasks.completeTask(worldId, taskId, { answer: null, talkFlag: false }), 'permission-denied');

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
        await child.tasks.completeTask(worldId, taskId, { answer: null, talkFlag: false }).settled;
        await rejectsWith(child2.tasks.completeTask(worldId, taskId, { answer: null, talkFlag: true }), 'permission-denied');

        await eventually(() => {
          expect(watch1.value?.[0]).toMatchObject({ status: 'done', talkFlag: false });
          expect(watch2.value?.[0]).toMatchObject({ status: 'done', talkFlag: false });
        });
        watch1.close();
        watch2.close();
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

        await child.tasks.completeTask(worldId, taskId, { answer: null, talkFlag: false }).settled;
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
