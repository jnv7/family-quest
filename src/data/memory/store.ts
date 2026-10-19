/**
 * One device of the memory adapter (docs/architecture.md §5).
 *
 * Writes are visible to this device's observers at once, as a pending layer
 * over the backend. The backend then accepts or refuses them on a later
 * microtask, like Firestore does; a refusal removes the pending layer, so the
 * observers show the server state again.
 */
import { weekKey } from '../../core/calendar';
import { oddsProblem } from '../../core/draw';
import { checkPartyChange } from '../../core/party';
import { taskDefProblem } from '../../core/taskDefs';
import { assertPlanAllowed } from '../plan';
import { newRecurringTaskProblem, settleRecurringWrites } from '../recurring';
import type { NewRecurringTask } from '../../core/generation';
import {
  DEFAULT_AVATAR,
  DEFAULT_RULESET,
  LIMITS,
  SCHEMA_VERSION,
  TIERS,
  type Clock,
  type Collectible,
  type DocMeta,
  type Member,
  type Profile,
  type ProfileId,
  type RandomInt,
  type Reward,
  type Task,
  type TaskDef,
  type TaskDefId,
  type TaskId,
  type Uid,
  type World,
  type WorldId,
} from '../../core/model';
import { randomId, randomWorldId } from '../../core/random';
import {
  DataStoreError,
  type CompleteTaskInput,
  type CreateAdhocTaskInput,
  type CreateProfileInput,
  type CreateWorldInput,
  type TaskDefInput,
  type DataStore,
  type Observer,
  type ObserverError,
  type Unsubscribe,
  type Write,
} from '../DataStore';
import { applyOps, type Batch, type MemoryBackend, type MemoryState, type Op, type WorldState } from './backend';

export interface MemoryStoreOptions {
  uid: Uid;
  clock: Clock;
  randomInt: RandomInt;
}

/** Same length as a Firestore auto-id (docs/architecture.md §3). */
const AUTO_ID_LENGTH = 20;

const denied = (message: string) => new DataStoreError('permission-denied', message);
const invalid = (message: string) => new DataStoreError('invalid-argument', message);
const notFound = (message: string) => new DataStoreError('not-found', message);

function checkText(label: string, value: string, max: number): void {
  if (value.length < 1 || value.length > max) throw invalid(`${label} must have 1 to ${max} characters`);
}

// ---------------------------------------------------------------------------
// Access rules, mirroring firebase/firestore.rules at the level of intents.

interface Access {
  ws: WorldState;
  member: Member;
  /** The device's active profile, if it has one. */
  active: Profile | null;
  isAdmin: boolean;
}

/** Null when the device is not a member of the world. */
function accessOf(state: MemoryState, worldId: WorldId, uid: Uid): Access | null {
  const ws = state.get(worldId);
  const member = ws?.members.get(uid);
  if (!ws || !member) return null;
  const active = member.profileId === null ? null : (ws.profiles.get(member.profileId) ?? null);
  return { ws, member, active, isAdmin: active !== null && active.kind === 'adult' && !active.archived };
}

function requireAccess(state: MemoryState, worldId: WorldId, uid: Uid): Access {
  const access = accessOf(state, worldId, uid);
  if (!access) throw denied('Not a member of this world');
  return access;
}

function canReadTasksOf(access: Access, profileId: ProfileId): boolean {
  return access.isAdmin || access.member.profileId === profileId;
}

export function createMemoryStore(backend: MemoryBackend, options: MemoryStoreOptions): DataStore {
  const { clock, randomInt } = options;
  let signedInUid: Uid | null = null;

  /** Writes applied locally and not yet accepted or refused by the backend. */
  const pending = new Set<Batch>();

  const requireUid = (): Uid => {
    if (signedInUid === null) throw new DataStoreError('unavailable', 'The device is not signed in');
    return signedInUid;
  };

  /** Committed state with this device's pending writes on top. */
  function localView(): MemoryState {
    const view = structuredClone(backend.state);
    for (const batch of pending) applyOps(view, batch.ops);
    return view;
  }

  // -------------------------------------------------------------------------
  // Observers

  type Selection<T> = { value: T } | { error: DataStoreError };

  interface Watcher {
    select(view: MemoryState, uid: Uid): Selection<unknown>;
    onValue: Observer<never>;
    onError: ObserverError | undefined;
    last: string | undefined;
  }

  const watchers = new Set<Watcher>();
  let flushScheduled = false;

  function flush(): void {
    flushScheduled = false;
    if (watchers.size === 0 || signedInUid === null) return;
    const view = localView();
    for (const watcher of [...watchers]) {
      if (!watchers.has(watcher)) continue;
      const selection = watcher.select(view, signedInUid);
      if ('error' in selection) {
        watchers.delete(watcher);
        watcher.onError?.(selection.error);
        continue;
      }
      const serialised = JSON.stringify(selection.value);
      if (serialised === watcher.last) continue;
      watcher.last = serialised;
      (watcher.onValue as Observer<unknown>)(structuredClone(selection.value));
    }
  }

  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flush);
  }

  backend.subscribe(scheduleFlush);

  function observe<T>(
    select: (view: MemoryState, uid: Uid) => Selection<T>,
    onValue: Observer<T>,
    onError?: ObserverError,
  ): Unsubscribe {
    const watcher: Watcher = { select, onValue: onValue as Observer<never>, onError, last: undefined };
    watchers.add(watcher);
    scheduleFlush();
    return () => {
      watchers.delete(watcher);
    };
  }

  /** Observes something only members of the world may read. */
  function observeAsMember<T>(
    worldId: WorldId,
    read: (access: Access) => Selection<T>,
    onValue: Observer<T>,
    onError?: ObserverError,
  ): Unsubscribe {
    return observe(
      (view, uid) => {
        const access = accessOf(view, worldId, uid);
        return access ? read(access) : { error: denied('Not a member of this world') };
      },
      onValue,
      onError,
    );
  }

  // -------------------------------------------------------------------------
  // Writing

  /**
   * Applies the batch locally, then lets the backend decide on a microtask.
   * `build` runs first and throws a `DataStoreError` for anything that must be
   * refused before a write; the returned `Write` then rejects without touching
   * the pending layer.
   */
  function submit<T>(result: T, build: (view: MemoryState, uid: Uid) => Batch): Write<T> {
    let batch: Batch;
    try {
      batch = build(localView(), requireUid());
    } catch (error) {
      if (error instanceof DataStoreError) return { result, settled: Promise.reject(error) };
      throw error;
    }
    pending.add(batch);
    scheduleFlush();
    const settled = new Promise<void>((resolve, reject) => {
      queueMicrotask(() => {
        pending.delete(batch);
        const refusal = backend.commit(batch);
        scheduleFlush();
        if (refusal) reject(refusal);
        else resolve();
      });
    });
    return { result, settled };
  }

  const autoId = (): string => randomId(randomInt, AUTO_ID_LENGTH);

  const newDoc = (): DocMeta => ({ schemaVersion: SCHEMA_VERSION, createdAt: clock() });

  function requireWorld(view: MemoryState, worldId: WorldId): WorldState {
    const ws = view.get(worldId);
    if (!ws) throw notFound(`World ${worldId} does not exist`);
    return ws;
  }

  function requireTask(view: MemoryState, worldId: WorldId, taskId: TaskId): Task {
    const task = requireWorld(view, worldId).tasks.get(taskId);
    if (!task) throw notFound(`Task ${taskId} does not exist`);
    return task;
  }

  // -------------------------------------------------------------------------
  // The store

  return {
    session: {
      async signIn() {
        signedInUid = options.uid;
        return options.uid;
      },
      currentUid: () => signedInUid,
    },

    worlds: {
      createWorld(input: CreateWorldInput) {
        const worldId = randomWorldId(randomInt);
        const profileId = autoId();
        return submit({ worldId, profileId }, (_view, uid) => {
          checkText('World name', input.name, LIMITS.worldName);
          checkText('Display name', input.creatorDisplayName, LIMITS.displayName);
          const world: World = {
            ...newDoc(),
            id: worldId,
            name: input.name,
            themeId: input.themeId,
            createdBy: uid,
            ruleset: structuredClone(DEFAULT_RULESET),
          };
          const profile: Profile = {
            ...newDoc(),
            id: profileId,
            displayName: input.creatorDisplayName,
            kind: 'adult',
            avatar: { ...DEFAULT_AVATAR },
            partyIds: [],
            archived: false,
          };
          const member: Member = { ...newDoc(), uid, profileId };
          return {
            ops: [
              { worldId, collection: 'world', id: worldId, create: world },
              { worldId, collection: 'profiles', id: profileId, create: profile },
              { worldId, collection: 'members', id: uid, create: member },
            ],
            check: (state) =>
              state.has(worldId) ? new DataStoreError('already-exists', `World ${worldId} already exists`) : null,
          };
        });
      },

      async joinWorld(worldId) {
        const uid = requireUid();
        await Promise.resolve();
        const ws = backend.state.get(worldId);
        if (!ws) throw notFound(`World ${worldId} does not exist`);
        const existing = ws.members.get(uid);
        if (existing) return structuredClone(existing);
        const member: Member = { ...newDoc(), uid, profileId: null };
        const op: Op = { worldId, collection: 'members', id: uid, create: member };
        const refusal = backend.commit({ ops: [op], check: () => null });
        if (refusal) throw refusal;
        return structuredClone(member);
      },

      async getMembership(worldId) {
        const uid = requireUid();
        await Promise.resolve();
        const member = localView().get(worldId)?.members.get(uid);
        return member ? structuredClone(member) : null;
      },

      observeWorld: (worldId, onValue, onError) =>
        observeAsMember(worldId, ({ ws }) => ({ value: ws.world }), onValue, onError),

      observeMembers: (worldId, onValue, onError) =>
        observeAsMember(worldId, ({ ws }) => ({ value: [...ws.members.values()] }), onValue, onError),

      observeProfiles: (worldId, onValue, onError) =>
        observeAsMember(worldId, ({ ws }) => ({ value: [...ws.profiles.values()] }), onValue, onError),

      setTierOdds: (worldId, tierOdds) =>
        submit(undefined, (view, uid) => {
          const ws = requireWorld(view, worldId);
          for (const level of TIERS) {
            const problem = oddsProblem(tierOdds[level]);
            if (problem) throw invalid(`The reward odds of level ${level} are not valid (${problem})`);
          }
          const ruleset = { ...ws.world.ruleset, tierOdds: structuredClone(tierOdds) };
          return {
            ops: [{ worldId, collection: 'world', id: worldId, patch: { ruleset } }],
            check: (state) => (accessOf(state, worldId, uid)?.isAdmin ? null : denied('Only an admin changes the reward odds')),
          };
        }),

      createProfile(worldId, input: CreateProfileInput) {
        const profileId = autoId();
        return submit({ profileId }, (view, uid) => {
          checkText('Display name', input.displayName, LIMITS.displayName);
          if (input.kind !== 'adult' && input.kind !== 'child') throw invalid(`Unknown profile kind: ${String(input.kind)}`);
          requireWorld(view, worldId);
          const profile: Profile = {
            ...newDoc(),
            id: profileId,
            displayName: input.displayName,
            kind: input.kind,
            avatar: { ...DEFAULT_AVATAR },
            partyIds: [],
            archived: false,
          };
          return {
            ops: [{ worldId, collection: 'profiles', id: profileId, create: profile }],
            check: (state) => {
              if (!accessOf(state, worldId, uid)?.isAdmin) return denied('Only an admin creates profiles');
              return null;
            },
          };
        });
      },

      setProfileArchived: (worldId, profileId, archived) =>
        submit(undefined, (view, uid) => {
          const profile = requireWorld(view, worldId).profiles.get(profileId);
          if (!profile) throw notFound(`Profile ${profileId} does not exist`);
          return {
            ops: [{ worldId, collection: 'profiles', id: profileId, patch: { archived } }],
            check: (state) => {
              const access = accessOf(state, worldId, uid);
              if (!access?.isAdmin) return denied('Only an admin archives profiles');
              const target = access.ws.profiles.get(profileId);
              if (!target) return notFound(`Profile ${profileId} does not exist`);
              if (target.kind === 'adult') return denied('Adult profiles are never archived');
              return null;
            },
          };
        }),

      chooseProfile: (worldId, profileId) =>
        submit(undefined, (_view, uid) => ({
          ops: [{ worldId, collection: 'members', id: uid, patch: { profileId } }],
          check: (state) => {
            const access = accessOf(state, worldId, uid);
            if (!access) return denied('Not a member of this world');
            const target = access.ws.profiles.get(profileId);
            if (!target || target.archived) return denied('The profile does not exist or is archived');
            return null;
          },
        })),
    },

    tasks: {
      observeOpenTasks: (worldId, profileId, onValue, onError) =>
        observeAsMember(
          worldId,
          (access) => {
            if (!canReadTasksOf(access, profileId)) return { error: denied('Tasks of another profile') };
            const open = [...access.ws.tasks.values()].filter((t) => t.profileId === profileId && t.status === 'open');
            return { value: open.sort((a, b) => a.createdAt - b.createdAt) };
          },
          onValue,
          onError,
        ),

      observeTasks: (worldId, profileId, onValue, onError) =>
        observeAsMember(
          worldId,
          (access) => {
            if (!canReadTasksOf(access, profileId)) return { error: denied('Tasks of another profile') };
            const all = [...access.ws.tasks.values()].filter((t) => t.profileId === profileId).reverse();
            return { value: all.sort((a, b) => b.createdAt - a.createdAt) };
          },
          onValue,
          onError,
        ),

      createAdhocTask(worldId, input: CreateAdhocTaskInput) {
        const taskId = autoId();
        return submit({ taskId }, (view, uid) => {
          checkText('Title', input.title, LIMITS.title);
          if (input.question !== null) checkText('Question', input.question, LIMITS.question);
          const { active } = requireAccess(view, worldId, uid);
          if (!active) throw denied('Choose a profile first');
          const task: Task = {
            ...newDoc(),
            id: taskId,
            profileId: input.profileId,
            title: input.title,
            level: input.level,
            question: input.question,
            source: 'adhoc',
            defId: null,
            periodKey: null,
            createdBy: active.id,
            origin: 'app',
            plan: null,
            status: 'open',
            doneAt: null,
            answer: null,
            talkFlag: false,
            weekKey: null,
          };
          return {
            ops: [{ worldId, collection: 'tasks', id: taskId, create: task }],
            check: (state) => {
              const access = accessOf(state, worldId, uid);
              if (!access?.active || access.active.id !== task.createdBy) return denied('Choose a profile first');
              const target = access.ws.profiles.get(input.profileId);
              if (!target || target.archived) return denied('The profile does not exist or is archived');
              if (!access.isAdmin && access.active.id !== input.profileId) return denied('Only an admin creates tasks for others');
              return null;
            },
          };
        });
      },

      completeTask: (worldId, taskId, input: CompleteTaskInput) =>
        submit(undefined, (view, uid) => {
          const ws = requireWorld(view, worldId);
          const task = requireTask(view, worldId, taskId);
          if (task.question !== null && input.answer !== 'yes') throw invalid('A task with a question is completed by answering yes');
          if (task.question === null && input.answer !== null) throw invalid('A task without a question has no answer');
          if (!(TIERS as readonly string[]).includes(input.rewardTier)) throw invalid(`Unknown reward tier: ${String(input.rewardTier)}`);
          const doneAt = clock();
          const completionWeek = weekKey(doneAt, ws.world.ruleset.timezone);
          const reward: Reward = {
            schemaVersion: SCHEMA_VERSION,
            createdAt: doneAt,
            id: taskId,
            profileId: task.profileId,
            weekKey: completionWeek,
            tier: input.rewardTier,
            openedAt: null,
          };
          return {
            ops: [
              {
                worldId,
                collection: 'tasks',
                id: taskId,
                patch: {
                  status: 'done',
                  doneAt,
                  answer: input.answer,
                  talkFlag: input.talkFlag,
                  weekKey: completionWeek,
                },
              },
              { worldId, collection: 'rewards', id: taskId, create: reward },
            ],
            check: (state) =>
              checkOwnerOfOpenTask(state, worldId, taskId, uid) ??
              (state.get(worldId)?.rewards.has(taskId) ? denied('A reward is never replaced') : null),
          };
        }),

      setTalkFlag: (worldId, taskId, talkFlag) =>
        submit(undefined, (view, uid) => {
          requireTask(view, worldId, taskId);
          return {
            ops: [{ worldId, collection: 'tasks', id: taskId, patch: { talkFlag } }],
            check: (state) => checkOwnerOfOpenTask(state, worldId, taskId, uid),
          };
        }),

      setPlan: (worldId, taskId, plan) =>
        submit(undefined, (view, uid) => {
          const ws = requireWorld(view, worldId);
          const task = requireTask(view, worldId, taskId);
          const def = task.defId === null ? null : (ws.taskDefs.get(task.defId) ?? null);
          assertPlanAllowed(task, def, plan, clock(), ws.world.ruleset.timezone);
          return {
            ops: [{ worldId, collection: 'tasks', id: taskId, patch: { plan: plan === null ? null : { ...plan } } }],
            check: (state) => checkOwnerOfOpenTask(state, worldId, taskId, uid),
          };
        }),

      createRecurringTasks(worldId, tasks) {
        const writes = tasks.map((input) =>
          submit(undefined, (view, uid) => {
            const problem = newRecurringTaskProblem(input);
            if (problem) throw invalid(problem);
            const { active } = requireAccess(view, worldId, uid);
            if (!active) throw denied('Choose a profile first');
            // Already here (open or done): leave it alone, like the rules refuse to rewrite it.
            if (requireWorld(view, worldId).tasks.has(input.id)) {
              throw new DataStoreError('already-exists', `Task ${input.id} already exists`);
            }
            const task: Task = {
              ...newDoc(),
              id: input.id,
              profileId: input.profileId,
              title: input.title,
              level: input.level,
              question: input.question,
              source: 'recurring',
              defId: input.defId,
              periodKey: input.periodKey,
              createdBy: active.id,
              origin: 'app',
              plan: null,
              status: 'open',
              doneAt: null,
              answer: null,
              talkFlag: false,
              weekKey: null,
            };
            return {
              ops: [{ worldId, collection: 'tasks', id: task.id, create: task }],
              check: (state) => checkRecurringCreate(state, worldId, uid, task),
            };
          }),
        );
        return { result: undefined, settled: settleRecurringWrites(writes.map((write) => write.settled)) };
      },

      async whenTasksSynced(worldId, profileId) {
        // The memory adapter has no cache apart from its pending writes: it is always in sync.
        const uid = requireUid();
        await Promise.resolve();
        const access = accessOf(backend.state, worldId, uid);
        if (!access || !canReadTasksOf(access, profileId)) throw denied('Tasks of another profile');
      },
    },

    collectibles: {
      arrangeParty: (worldId, profileId, change) =>
        submit(undefined, (view, uid) => {
          const ws = requireWorld(view, worldId);
          const profile = ws.profiles.get(profileId);
          if (!profile) throw notFound(`Profile ${profileId} does not exist`);
          const owned = [...ws.collectibles.values()].filter((c) => c.profileId === profileId);
          const problem = checkPartyChange(profile, owned, change, ws.world.ruleset.partySize);
          if (problem) throw invalid(`The party change is not valid (${problem})`);
          const now = clock();
          const ops: Op[] = [
            ...change.toReserve.map((id): Op => ({ worldId, collection: 'collectibles', id, patch: { reserveAt: now } })),
            ...change.fromReserve.map((id): Op => ({ worldId, collection: 'collectibles', id, patch: { reserveAt: null } })),
          ];
          if (!sameIds(profile.partyIds, change.partyIds)) {
            ops.push({ worldId, collection: 'profiles', id: profileId, patch: { partyIds: [...change.partyIds] } });
          }
          return {
            ops,
            check: (state) => {
              const access = accessOf(state, worldId, uid);
              if (!access) return denied('Not a member of this world');
              if (access.member.profileId !== profileId) return denied('Only the owner arranges the party');
              if ([...change.toReserve, ...change.fromReserve].some((id) => access.ws.collectibles.get(id)?.profileId !== profileId)) {
                return denied('A collectible is the owner’s to move');
              }
              return null;
            },
          };
        }),

      observeCollectibles: (worldId, profileId, onValue, onError) =>
        observeAsMember(
          worldId,
          (access) => {
            // Every member reads collectibles (the showcase lists other people's); the interface hides the owner.
            const mine = [...access.ws.collectibles.values()].filter((c) => c.profileId === profileId);
            return { value: mine.sort((a, b) => b.obtainedAt - a.obtainedAt || (a.id < b.id ? -1 : 1)) };
          },
          onValue,
          onError,
        ),
    },

    rewards: {
      openReward: (worldId, rewardId, input) =>
        submit(undefined, (view, uid) => {
          checkText('Slot', input.slot, LIMITS.slot);
          const ws = requireWorld(view, worldId);
          const reward = ws.rewards.get(rewardId);
          if (!reward) throw notFound(`Reward ${rewardId} does not exist`);
          const { member } = requireAccess(view, worldId, uid);
          if (member.profileId !== reward.profileId) throw denied('Only the owner opens a reward');
          if (reward.openedAt !== null) throw denied('A reward is opened once');
          const openedAt = clock();
          const collectible: Collectible = {
            schemaVersion: SCHEMA_VERSION,
            createdAt: openedAt,
            id: rewardId,
            profileId: reward.profileId,
            slot: input.slot,
            tier: reward.tier,
            nickname: null,
            obtainedWeekKey: weekKey(openedAt, ws.world.ruleset.timezone),
            obtainedAt: openedAt,
            reserveAt: null,
          };
          return {
            ops: [
              { worldId, collection: 'rewards', id: rewardId, patch: { openedAt } },
              { worldId, collection: 'collectibles', id: rewardId, create: collectible },
            ],
            check: (state) => checkOwnerOpensOnce(state, worldId, uid, rewardId),
          };
        }),

      observeUnopenedRewards: (worldId, profileId, onValue, onError) =>
        observeAsMember(
          worldId,
          (access) => {
            if (!canReadTasksOf(access, profileId)) return { error: denied('Rewards of another profile') };
            const unopened = [...access.ws.rewards.values()].filter((r) => r.profileId === profileId && r.openedAt === null);
            return { value: unopened.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)) };
          },
          onValue,
          onError,
        ),
    },

    taskDefs: {
      observeTaskDefs: (worldId, onValue, onError) =>
        observeAsMember(
          worldId,
          ({ ws }) => ({ value: [...ws.taskDefs.values()].sort(byTitleThenId) }),
          onValue,
          onError,
        ),

      createTaskDef(worldId, input: TaskDefInput) {
        const defId = autoId();
        return submit({ defId }, (view, uid) => {
          const problem = taskDefProblem(input);
          if (problem) throw invalid(problem);
          requireWorld(view, worldId);
          const def: TaskDef = {
            ...newDoc(),
            id: defId,
            title: input.title,
            cadence: input.cadence,
            level: input.level,
            assignedTo: [...input.assignedTo],
            question: input.question,
            big: input.big,
            active: true,
          };
          return {
            ops: [{ worldId, collection: 'taskDefs', id: defId, create: def }],
            check: (state) => (accessOf(state, worldId, uid)?.isAdmin ? null : denied('Only an admin creates task definitions')),
          };
        });
      },

      updateTaskDef: (worldId, defId, patch) =>
        submit(undefined, (view, uid) => {
          const problem = taskDefProblem(patch);
          if (problem) throw invalid(problem);
          if (!requireWorld(view, worldId).taskDefs.has(defId)) throw notFound(`Task definition ${defId} does not exist`);
          return {
            ops: [{ worldId, collection: 'taskDefs', id: defId, patch: definedFields(patch) }],
            check: (state) => {
              const access = accessOf(state, worldId, uid);
              if (!access?.isAdmin) return denied('Only an admin changes task definitions');
              if (!access.ws.taskDefs.has(defId)) return notFound(`Task definition ${defId} does not exist`);
              return null;
            },
          };
        }),
    },
  };
}

/**
 * What the rules require of a recurring task (`validRecurring` in firestore.rules): a new id,
 * the owner's active profile, and an active definition assigned to that profile, copied exactly.
 */
function checkRecurringCreate(state: MemoryState, worldId: WorldId, uid: Uid, task: Task): DataStoreError | null {
  const access = accessOf(state, worldId, uid);
  if (!access?.active || access.active.id !== task.createdBy) return denied('Choose a profile first');
  if (access.ws.tasks.has(task.id)) return denied('A task that exists is never rewritten');
  if (access.active.id !== task.profileId || access.active.archived) return denied('Only the owner creates a recurring task');
  const def = task.defId === null ? undefined : access.ws.taskDefs.get(task.defId);
  if (!def || !def.active) return denied('The definition does not exist or is not active');
  if (def.assignedTo.length > 0 && !def.assignedTo.includes(task.profileId)) return denied('The definition is not assigned to this profile');
  if (task.title !== def.title || task.level !== def.level || task.question !== def.question) {
    return denied('A recurring task copies its definition');
  }
  return null;
}

/** Firestore orders by title, then by document id; the memory adapter does the same. */
function byTitleThenId(a: TaskDef, b: TaskDef): number {
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A patch without the keys set to `undefined`, which must not overwrite anything. */
function definedFields<T extends object>(patch: T): T {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as T;
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

/** Only the owner opens a reward, only once; the collectible is never replaced. */
function checkOwnerOpensOnce(state: MemoryState, worldId: WorldId, uid: Uid, rewardId: TaskId): DataStoreError | null {
  const access = accessOf(state, worldId, uid);
  if (!access) return denied('Not a member of this world');
  const reward = access.ws.rewards.get(rewardId);
  if (!reward) return notFound(`Reward ${rewardId} does not exist`);
  if (access.member.profileId !== reward.profileId) return denied('Only the owner opens a reward');
  if (reward.openedAt !== null) return denied('A reward is opened once');
  if (access.ws.collectibles.has(rewardId)) return denied('A collectible is never replaced');
  return null;
}

/** Only the owner changes a task, and only while it is open. */
function checkOwnerOfOpenTask(state: MemoryState, worldId: WorldId, taskId: TaskId, uid: Uid): DataStoreError | null {
  const access = accessOf(state, worldId, uid);
  if (!access) return denied('Not a member of this world');
  const task = access.ws.tasks.get(taskId);
  if (!task) return notFound(`Task ${taskId} does not exist`);
  if (access.member.profileId !== task.profileId) return denied('Only the owner changes a task');
  if (task.status !== 'open') return denied('A done task never changes');
  return null;
}
