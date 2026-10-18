/**
 * One device of the memory adapter (docs/architecture.md §5).
 *
 * Writes are visible to this device's observers at once, as a pending layer
 * over the backend. The backend then accepts or refuses them on a later
 * microtask, like Firestore does; a refusal removes the pending layer, so the
 * observers show the server state again.
 */
import { weekKey } from '../../core/calendar';
import {
  DEFAULT_AVATAR,
  DEFAULT_RULESET,
  LIMITS,
  SCHEMA_VERSION,
  type Clock,
  type DocMeta,
  type Member,
  type Profile,
  type ProfileId,
  type RandomInt,
  type Task,
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
          const doneAt = clock();
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
                  weekKey: weekKey(doneAt, ws.world.ruleset.timezone),
                },
              },
            ],
            check: (state) => checkOwnerOfOpenTask(state, worldId, taskId, uid),
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
    },
  };
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
