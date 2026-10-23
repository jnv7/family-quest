/**
 * One device of the memory adapter (docs/architecture.md §5).
 *
 * Writes are visible to this device's observers at once, as a pending layer
 * over the backend. The backend then accepts or refuses them on a later
 * microtask, like Firestore does; a refusal removes the pending layer, so the
 * observers show the server state again.
 */
import { weekKey } from '../../core/calendar';
import { checkPartyChange } from '../../core/party';
import { canRetire } from '../../core/tasks';
import { isPartySize, isTokenAmount, isTokenPrice, tokenRulesProblem } from '../../core/tokens';
import { taskDefProblem } from '../../core/taskDefs';
import { assertPlanAllowed } from '../plan';
import { newRecurringTaskProblem, settleRecurringWrites } from '../recurring';
import type { NewRecurringTask } from '../../core/generation';
import { nicknameTooLong, normaliseNickname } from '../../core/collection';
import { assertSymbolAllowed } from '../symbols';
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
  type RewardId,
  type Task,
  type TaskDef,
  type TaskDefId,
  type TaskId,
  type Uid,
  type World,
  type WorldId,
  isShowcaseSize,
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
  type ShowcaseItem,
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

/** A memory device. `setOnline` is for tests only: it plays a device that loses and regains its connection. */
export interface MemoryDataStore extends DataStore {
  /**
   * While offline the device sees the committed state as it was when it went offline, plus its own writes,
   * and its batches are held. Back online they are committed in order, each accepted or refused on its own.
   */
  setOnline(online: boolean): void;
}

export function createMemoryStore(backend: MemoryBackend, options: MemoryStoreOptions): MemoryDataStore {
  const { clock, randomInt } = options;
  let signedInUid: Uid | null = null;

  /** Writes applied locally and not yet accepted or refused by the backend. */
  const pending = new Set<Batch>();

  let online = true;
  /** The committed state when the device went offline. */
  let frozen: MemoryState | null = null;
  /** Commits of batches made while offline, in order. */
  const held: Array<() => void> = [];

  const requireUid = (): Uid => {
    if (signedInUid === null) throw new DataStoreError('unavailable', 'The device is not signed in');
    return signedInUid;
  };

  /** Committed state with this device's pending writes on top. */
  function localView(): MemoryState {
    const view = structuredClone(online || frozen === null ? backend.state : frozen);
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
      const run = () => {
        pending.delete(batch);
        const refusal = backend.commit(batch);
        scheduleFlush();
        if (refusal) reject(refusal);
        else resolve();
      };
      if (online) queueMicrotask(run);
      else held.push(run);
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
    setOnline(value) {
      if (value === online) return;
      online = value;
      if (!value) {
        frozen = structuredClone(backend.state);
        return;
      }
      frozen = null;
      for (const run of held.splice(0)) run();
      scheduleFlush();
    },

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

      setShowcaseSize: (worldId, size) =>
        submit(undefined, (view, uid) => {
          const ws = requireWorld(view, worldId);
          if (!isShowcaseSize(size)) throw invalid(`The showcase size must be a whole number from 1 to ${LIMITS.showcaseSizeMax}`);
          const ruleset = { ...ws.world.ruleset, showcaseSize: size };
          return {
            ops: [{ worldId, collection: 'world', id: worldId, patch: { ruleset } }],
            check: (state) => (accessOf(state, worldId, uid)?.isAdmin ? null : denied('Only an admin changes the showcase size')),
          };
        }),

      setTokenRules: (worldId, rules) =>
        submit(undefined, (view, uid) => {
          const ws = requireWorld(view, worldId);
          const problem = tokenRulesProblem(rules);
          if (problem) throw invalid(`The token rules are not valid (${problem})`);
          const ruleset = {
            ...ws.world.ruleset,
            tokensPerLevel: structuredClone(rules.tokensPerLevel),
            tokenPrices: structuredClone(rules.tokenPrices),
          };
          return {
            ops: [{ worldId, collection: 'world', id: worldId, patch: { ruleset } }],
            check: (state) => (accessOf(state, worldId, uid)?.isAdmin ? null : denied('Only an admin changes the token rules')),
          };
        }),

      setPartySize: (worldId, size) =>
        submit(undefined, (view, uid) => {
          const ws = requireWorld(view, worldId);
          if (!isPartySize(size)) throw invalid(`The party size must be a whole number from 1 to ${LIMITS.partySizeMax}`);
          const ruleset = { ...ws.world.ruleset, partySize: size };
          return {
            ops: [{ worldId, collection: 'world', id: worldId, patch: { ruleset } }],
            check: (state) => (accessOf(state, worldId, uid)?.isAdmin ? null : denied('Only an admin changes the party size')),
          };
        }),

      restartUniverse: (worldId) =>
        submit(undefined, (view, uid) => {
          if (!online) throw new DataStoreError('unavailable', 'Restarting needs a connection');
          const ws = requireWorld(view, worldId);
          const ops: Op[] = [
            ...[...ws.tasks.keys()].map((id): Op => ({ worldId, collection: 'tasks', id, delete: true })),
            ...[...ws.taskDefs.keys()].map((id): Op => ({ worldId, collection: 'taskDefs', id, delete: true })),
            ...[...ws.rewards.keys()].map((id): Op => ({ worldId, collection: 'rewards', id, delete: true })),
            ...[...ws.collectibles.keys()].map((id): Op => ({ worldId, collection: 'collectibles', id, delete: true })),
            ...[...ws.profiles.keys()].map((id): Op => ({ worldId, collection: 'profiles', id, reset: true })),
          ];
          return {
            ops,
            check: (state) => (accessOf(state, worldId, uid)?.isAdmin ? null : denied('Only an admin restarts the universe')),
          };
        }),

      createProfile(worldId, input: CreateProfileInput) {
        const profileId = autoId();
        return submit({ profileId }, (view, uid) => {
          checkText('Display name', input.displayName, LIMITS.displayName);
          if (input.kind !== 'adult' && input.kind !== 'child') throw invalid(`Unknown profile kind: ${String(input.kind)}`);
          requireWorld(view, worldId);
          assertSymbolAllowed(input.symbol);
          const profile: Profile = {
            ...newDoc(),
            id: profileId,
            displayName: input.displayName,
            kind: input.kind,
            avatar: { ...DEFAULT_AVATAR, symbol: input.symbol ?? null },
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

      setProfileSymbol: (worldId, profileId, symbol) =>
        submit(undefined, (view, uid) => {
          assertSymbolAllowed(symbol);
          const profile = requireWorld(view, worldId).profiles.get(profileId);
          if (!profile) throw notFound(`Profile ${profileId} does not exist`);
          return {
            ops: [{ worldId, collection: 'profiles', id: profileId, patch: { avatar: { ...profile.avatar, symbol } } }],
            check: (state) => {
              const access = accessOf(state, worldId, uid);
              if (!access) return denied('Not a member of this world');
              return access.member.profileId === profileId || access.isAdmin ? null : denied('Only the owner or an admin chooses a symbol');
            },
          };
        }),

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
            ...(input.big === true ? { big: true } : {}),
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
          if (!isTokenAmount(input.tokens)) throw invalid(`A task earns a whole number of tokens from 1 to ${LIMITS.tokensPerLevelMax}`);
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
                  tokens: input.tokens,
                },
              },
              { worldId, collection: 'profiles', id: task.profileId, increment: { tokens: input.tokens } },
            ],
            check: (state) => checkOwnerOfOpenTask(state, worldId, taskId, uid),
          };
        }),

      retireTask: (worldId, taskId) =>
        submit(undefined, (view, uid) => {
          const task = requireTask(view, worldId, taskId);
          const { active } = requireAccess(view, worldId, uid);
          if (!active || !canRetire(task, active)) throw denied('This profile cannot retire this task');
          return {
            ops: [
              {
                worldId,
                collection: 'tasks',
                id: taskId,
                patch: { status: 'retired', retiredAt: clock(), retiredBy: active.id },
              },
            ],
            check: (state) => {
              const access = accessOf(state, worldId, uid);
              if (!access) return denied('Not a member of this world');
              const current = access.ws.tasks.get(taskId);
              if (!current) return notFound(`Task ${taskId} does not exist`);
              if (!access.active || access.active.id !== active.id || !canRetire(current, access.active)) {
                return denied('This profile cannot retire this task');
              }
              return null;
            },
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

      takeFromReserve: (worldId, collectibleId, change) =>
        submit(undefined, (view, uid) => {
          const ws = requireWorld(view, worldId);
          const { member } = requireAccess(view, worldId, uid);
          const profile = member.profileId === null ? undefined : ws.profiles.get(member.profileId);
          if (!profile) throw denied('Choose a profile first');
          const taken = ws.collectibles.get(collectibleId);
          if (!taken) throw notFound(`Collectible ${collectibleId} does not exist`);
          if (taken.reserveAt === null) throw denied('Only what is in the reserve can be taken');
          if (!change.partyIds.includes(collectibleId) || !change.fromReserve.includes(collectibleId)) {
            throw invalid('The taken collectible joins the party and leaves the reserve');
          }
          // Once taken it is the profile's own, coming from the reserve.
          const owned = [...ws.collectibles.values()].filter((c) => c.profileId === profile.id).concat({ ...taken, profileId: profile.id });
          const problem = checkPartyChange(profile, owned, change, ws.world.ruleset.partySize);
          if (problem) throw invalid(`The party change is not valid (${problem})`);
          const now = clock();
          const ops: Op[] = [
            { worldId, collection: 'collectibles', id: collectibleId, patch: { profileId: profile.id, reserveAt: null } },
            ...change.toReserve.map((id): Op => ({ worldId, collection: 'collectibles', id, patch: { reserveAt: now } })),
            ...change.fromReserve.filter((id) => id !== collectibleId).map((id): Op => ({ worldId, collection: 'collectibles', id, patch: { reserveAt: null } })),
          ];
          if (!sameIds(profile.partyIds, change.partyIds)) {
            ops.push({ worldId, collection: 'profiles', id: profile.id, patch: { partyIds: [...change.partyIds] } });
          }
          return {
            ops,
            check: (state) => {
              const access = accessOf(state, worldId, uid);
              if (!access) return denied('Not a member of this world');
              if (access.member.profileId !== profile.id) return denied('Only the active profile takes');
              if (access.ws.collectibles.get(collectibleId)?.reserveAt == null) return denied('Someone took it first');
              const others = [...change.toReserve, ...change.fromReserve.filter((id) => id !== collectibleId)];
              if (others.some((id) => access.ws.collectibles.get(id)?.profileId !== profile.id)) return denied('A collectible is the owner’s to move');
              return null;
            },
          };
        }),

      setNickname: (worldId, collectibleId, nickname) =>
        submit(undefined, (view, uid) => {
          const value = nickname === null ? null : normaliseNickname(nickname);
          if (nicknameTooLong(value)) throw invalid(`A nickname has at most ${LIMITS.nickname} characters`);
          const ws = requireWorld(view, worldId);
          if (!ws.collectibles.has(collectibleId)) throw notFound(`Collectible ${collectibleId} does not exist`);
          return {
            ops: [{ worldId, collection: 'collectibles', id: collectibleId, patch: { nickname: value } }],
            check: (state) => {
              const access = accessOf(state, worldId, uid);
              if (!access) return denied('Not a member of this world');
              const owner = access.ws.collectibles.get(collectibleId)?.profileId;
              return access.member.profileId === owner || access.isAdmin ? null : denied('Only the owner or an admin renames a collectible');
            },
          };
        }),

      observeShowcase: (worldId, limit, onValue, onError) =>
        observeAsMember(
          worldId,
          (access) => {
            const items = [...access.ws.collectibles.values()]
              .filter((c): c is Collectible & { reserveAt: number } => c.reserveAt !== null)
              // Same order as the Firestore query: reserveAt descending, then document id descending.
              .sort((a, b) => b.reserveAt - a.reserveAt || (a.id < b.id ? 1 : -1))
              .slice(0, limit)
              .map((c): ShowcaseItem => ({ id: c.id, slot: c.slot, tier: c.tier, nickname: c.nickname, reserveAt: c.reserveAt }));
            return { value: items };
          },
          onValue,
          onError,
        ),

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

    tokens: {
      observeBalance: (worldId, profileId, onValue, onError) =>
        observeAsMember(worldId, ({ ws }) => ({ value: ws.balances.get(profileId) ?? 0 }), onValue, onError),

      buyReward(worldId, input) {
        const rewardId: RewardId = autoId();
        return submit({ rewardId }, (view, uid) => {
          checkText('Slot', input.slot, LIMITS.slot);
          if (!(TIERS as readonly string[]).includes(input.tier)) throw invalid(`Unknown reward tier: ${String(input.tier)}`);
          if (!isTokenPrice(input.price)) throw invalid(`A price is a whole number from 1 to ${LIMITS.tokenPriceMax}`);
          const ws = requireWorld(view, worldId);
          const { active } = requireAccess(view, worldId, uid);
          if (!active) throw denied('Choose a profile first');
          if ((ws.balances.get(active.id) ?? 0) < input.price) throw invalid('The balance does not cover the price');
          const profileId = active.id;
          const boughtAt = clock();
          const week = weekKey(boughtAt, ws.world.ruleset.timezone);
          const reward: Reward = {
            schemaVersion: SCHEMA_VERSION,
            createdAt: boughtAt,
            id: rewardId,
            profileId,
            weekKey: week,
            tier: input.tier,
            openedAt: boughtAt,
            price: input.price,
          };
          const collectible: Collectible = {
            schemaVersion: SCHEMA_VERSION,
            createdAt: boughtAt,
            id: rewardId,
            profileId,
            slot: input.slot,
            tier: input.tier,
            nickname: null,
            obtainedWeekKey: week,
            obtainedAt: boughtAt,
            reserveAt: null,
          };
          return {
            ops: [
              { worldId, collection: 'profiles', id: profileId, increment: { tokens: -input.price } },
              { worldId, collection: 'rewards', id: rewardId, create: reward },
              { worldId, collection: 'collectibles', id: rewardId, create: collectible },
            ],
            check: (state) => {
              const access = accessOf(state, worldId, uid);
              if (!access) return denied('Not a member of this world');
              if (access.member.profileId !== profileId) return denied('Only the owner spends tokens');
              if (access.ws.rewards.has(rewardId) || access.ws.collectibles.has(rewardId)) return denied('A reward is never replaced');
              if ((access.ws.balances.get(profileId) ?? 0) < input.price) return denied('The tokens were already spent');
              return null;
            },
          };
        });
      },
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
