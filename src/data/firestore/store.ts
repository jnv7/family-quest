/**
 * The Firestore adapter (docs/architecture.md §5).
 *
 * Writes are not transactions: they work offline and are checked by the rules
 * when they reach the server. A write is applied to the local cache as soon as
 * its `setDoc`/`updateDoc` runs, which is synchronous unless the operation has
 * to read something first (the active profile, the world's time zone, the
 * task); those reads come from the cache and never wait for the network.
 */
import {
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import { signInAnonymously, type Auth } from 'firebase/auth';
import { weekKey } from '../../core/calendar';
import { oddsProblem } from '../../core/draw';
import { taskDefProblem } from '../../core/taskDefs';
import { assertPlanAllowed } from '../plan';
import { newRecurringTaskProblem, settleRecurringWrites } from '../recurring';
import {
  DEFAULT_AVATAR,
  DEFAULT_RULESET,
  LIMITS,
  SCHEMA_VERSION,
  TIERS,
  type Clock,
  type DocMeta,
  type Member,
  type Profile,
  type RandomInt,
  type Reward,
  type Task,
  type TaskDef,
  type Uid,
  type World,
} from '../../core/model';
import { randomWorldId } from '../../core/random';
import {
  DataStoreError,
  type DataStore,
  type Observer,
  type ObserverError,
  type Unsubscribe,
  type Write,
} from '../DataStore';
import {
  decodeAll,
  decodeMember,
  decodeProfile,
  decodeReward,
  decodeTask,
  decodeTaskDef,
  decodeWorld,
  encodeMember,
  encodeProfile,
  encodeReward,
  encodeTask,
  encodeTaskCompletion,
  encodeTaskDef,
  encodeWorld,
} from './converters';
import { toDataStoreError } from './errors';
import {
  membersCollection,
  memberDoc,
  profileDoc,
  profilesCollection,
  rewardDoc,
  rewardsCollection,
  taskDefDoc,
  taskDefsCollection,
  taskDoc,
  tasksCollection,
  worldDoc,
} from './paths';

export interface FirestoreStoreOptions {
  firestore: Firestore;
  auth: Auth;
  clock: Clock;
  randomInt: RandomInt;
}

const invalid = (message: string) => new DataStoreError('invalid-argument', message);
const denied = (message: string) => new DataStoreError('permission-denied', message);

function checkText(label: string, value: string, max: number): void {
  if (value.length < 1 || value.length > max) throw invalid(`${label} must have 1 to ${max} characters`);
}

export function createFirestoreStore(options: FirestoreStoreOptions): DataStore {
  const { firestore: db, auth, clock } = options;

  const requireUid = (): Uid => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new DataStoreError('unavailable', 'The device is not signed in');
    return uid;
  };

  /**
   * Metadata stamped with the time of the call. Operations take it before
   * their first `await`, so a slow cache read never moves the timestamp.
   */
  const newDoc = (): DocMeta => ({ schemaVersion: SCHEMA_VERSION, createdAt: clock() });

  /** Runs a write; whatever it throws reaches `settled` as a `DataStoreError`. */
  function write<T>(result: T, run: () => Promise<void>): Write<T> {
    return { result, settled: run().catch((error: unknown) => Promise.reject(toDataStoreError(error))) };
  }

  /** From the cache when it has the document, otherwise from the server. */
  async function readDoc(ref: DocumentReference): Promise<DocumentSnapshot> {
    try {
      const cached = await getDocFromCache(ref);
      if (cached.exists()) return cached;
    } catch {
      // Not in the cache: fall through to the server.
    }
    return getDoc(ref);
  }

  function observeDoc<T>(
    ref: DocumentReference,
    decode: (snapshot: DocumentSnapshot) => T | null,
    onValue: Observer<T>,
    onError?: ObserverError,
  ): Unsubscribe {
    return onSnapshot(
      ref,
      (snapshot) => {
        const value = snapshot.exists() ? decode(snapshot) : null;
        if (value !== null) onValue(value);
      },
      (error) => onError?.(toDataStoreError(error)),
    );
  }

  async function getMembership(worldId: string): Promise<Member | null> {
    const uid = requireUid();
    try {
      // Cache first, so launching the app offline does not wait for the network to give up.
      const snapshot = await readDoc(memberDoc(db, worldId, uid));
      return snapshot.exists() ? decodeMember(snapshot) : null;
    } catch (error) {
      const mapped = toDataStoreError(error);
      // Non-members may not read the membership collection at all.
      if (mapped.code === 'permission-denied') return null;
      throw mapped;
    }
  }

  return {
    session: {
      async signIn() {
        await auth.authStateReady();
        if (auth.currentUser) return auth.currentUser.uid;
        try {
          return (await signInAnonymously(auth)).user.uid;
        } catch (error) {
          throw toDataStoreError(error);
        }
      },
      currentUid: () => auth.currentUser?.uid ?? null,
    },

    worlds: {
      createWorld(input) {
        const worldId = randomWorldId(options.randomInt);
        const profileId = doc(profilesCollection(db, worldId)).id;
        return write({ worldId, profileId }, async () => {
          checkText('World name', input.name, LIMITS.worldName);
          checkText('Display name', input.creatorDisplayName, LIMITS.displayName);
          const uid = requireUid();
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
          const batch = writeBatch(db);
          batch.set(worldDoc(db, worldId), encodeWorld(world));
          batch.set(profileDoc(db, worldId, profileId), encodeProfile(profile));
          batch.set(memberDoc(db, worldId, uid), encodeMember(member));
          await batch.commit();
        });
      },

      async joinWorld(worldId) {
        const uid = requireUid();
        const existing = await getMembership(worldId);
        if (existing) return existing;
        const member: Member = { ...newDoc(), uid, profileId: null };
        try {
          await setDoc(memberDoc(db, worldId, uid), encodeMember(member));
        } catch (error) {
          const mapped = toDataStoreError(error);
          // The rules refuse a membership only when the world does not exist.
          if (mapped.code === 'permission-denied') {
            throw new DataStoreError('not-found', `World ${worldId} does not exist`, { cause: error });
          }
          throw mapped;
        }
        return member;
      },

      getMembership,

      observeWorld: (worldId, onValue, onError) => observeDoc(worldDoc(db, worldId), decodeWorld, onValue, onError),

      observeMembers: (worldId, onValue, onError) =>
        onSnapshot(
          membersCollection(db, worldId),
          (snapshot) => onValue(decodeAll(snapshot.docs, decodeMember)),
          (error) => onError?.(toDataStoreError(error)),
        ),

      observeProfiles: (worldId, onValue, onError) =>
        onSnapshot(
          profilesCollection(db, worldId),
          (snapshot) => onValue(decodeAll(snapshot.docs, decodeProfile)),
          (error) => onError?.(toDataStoreError(error)),
        ),

      setTierOdds: (worldId, tierOdds) =>
        write(undefined, async () => {
          for (const level of TIERS) {
            const problem = oddsProblem(tierOdds[level]);
            if (problem) throw invalid(`The reward odds of level ${level} are not valid (${problem})`);
          }
          await updateDoc(worldDoc(db, worldId), { 'ruleset.tierOdds': tierOdds });
        }),

      createProfile(worldId, input) {
        const profileId = doc(profilesCollection(db, worldId)).id;
        return write({ profileId }, async () => {
          checkText('Display name', input.displayName, LIMITS.displayName);
          if (input.kind !== 'adult' && input.kind !== 'child') throw invalid(`Unknown profile kind: ${String(input.kind)}`);
          const profile: Profile = {
            ...newDoc(),
            id: profileId,
            displayName: input.displayName,
            kind: input.kind,
            avatar: { ...DEFAULT_AVATAR },
            partyIds: [],
            archived: false,
          };
          await setDoc(profileDoc(db, worldId, profileId), encodeProfile(profile));
        });
      },

      setProfileArchived: (worldId, profileId, archived) =>
        write(undefined, () => updateDoc(profileDoc(db, worldId, profileId), { archived })),

      chooseProfile: (worldId, profileId) =>
        write(undefined, async () => {
          await updateDoc(memberDoc(db, worldId, requireUid()), { profileId });
        }),
    },

    tasks: {
      observeOpenTasks: (worldId, profileId, onValue, onError) =>
        onSnapshot(
          query(
            tasksCollection(db, worldId),
            where('profileId', '==', profileId),
            where('status', '==', 'open'),
            orderBy('createdAt', 'asc'),
          ),
          (snapshot) => onValue(decodeAll(snapshot.docs, decodeTask)),
          (error) => onError?.(toDataStoreError(error)),
        ),

      observeTasks: (worldId, profileId, onValue, onError) =>
        onSnapshot(
          query(tasksCollection(db, worldId), where('profileId', '==', profileId), orderBy('createdAt', 'desc')),
          (snapshot) => onValue(decodeAll(snapshot.docs, decodeTask)),
          (error) => onError?.(toDataStoreError(error)),
        ),

      createAdhocTask(worldId, input) {
        const taskId = doc(tasksCollection(db, worldId)).id;
        const meta = newDoc();
        return write({ taskId }, async () => {
          checkText('Title', input.title, LIMITS.title);
          if (input.question !== null) checkText('Question', input.question, LIMITS.question);
          const member = decodeMember(await readDoc(memberDoc(db, worldId, requireUid())));
          if (!member?.profileId) throw denied('Choose a profile first');
          const task: Task = {
            ...meta,
            id: taskId,
            profileId: input.profileId,
            title: input.title,
            level: input.level,
            question: input.question,
            source: 'adhoc',
            defId: null,
            periodKey: null,
            createdBy: member.profileId,
            origin: 'app',
            plan: null,
            status: 'open',
            doneAt: null,
            answer: null,
            talkFlag: false,
            weekKey: null,
          };
          await setDoc(taskDoc(db, worldId, taskId), encodeTask(task));
        });
      },

      completeTask: (worldId, taskId, input) => {
        const doneAt = clock();
        return write(undefined, async () => {
          const [worldSnapshot, taskSnapshot] = await Promise.all([
            readDoc(worldDoc(db, worldId)),
            readDoc(taskDoc(db, worldId, taskId)),
          ]);
          const world = worldSnapshot.exists() ? decodeWorld(worldSnapshot) : null;
          const task = taskSnapshot.exists() ? decodeTask(taskSnapshot) : null;
          if (!world || !task) throw new DataStoreError('not-found', `Task ${taskId} does not exist`);
          if (task.question !== null && input.answer !== 'yes') throw invalid('A task with a question is completed by answering yes');
          if (task.question === null && input.answer !== null) throw invalid('A task without a question has no answer');
          if (!(TIERS as readonly string[]).includes(input.rewardTier)) throw invalid(`Unknown reward tier: ${String(input.rewardTier)}`);
          const completionWeek = weekKey(doneAt, world.ruleset.timezone);
          const reward: Reward = {
            schemaVersion: SCHEMA_VERSION,
            createdAt: doneAt,
            id: taskId,
            profileId: task.profileId,
            weekKey: completionWeek,
            tier: input.rewardTier,
            openedAt: null,
          };
          // One batch: the rules accept the reward only together with the task moving to done.
          const batch = writeBatch(db);
          batch.update(
            taskDoc(db, worldId, taskId),
            encodeTaskCompletion({ doneAt, answer: input.answer, talkFlag: input.talkFlag, weekKey: completionWeek }),
          );
          batch.set(rewardDoc(db, worldId, taskId), encodeReward(reward));
          await batch.commit();
        });
      },

      setTalkFlag: (worldId, taskId, talkFlag) =>
        write(undefined, () => updateDoc(taskDoc(db, worldId, taskId), { talkFlag })),

      setPlan: (worldId, taskId, plan) => {
        const now = clock();
        return write(undefined, async () => {
          const [worldSnapshot, taskSnapshot] = await Promise.all([
            readDoc(worldDoc(db, worldId)),
            readDoc(taskDoc(db, worldId, taskId)),
          ]);
          const world = worldSnapshot.exists() ? decodeWorld(worldSnapshot) : null;
          const task = taskSnapshot.exists() ? decodeTask(taskSnapshot) : null;
          if (!world || !task) throw new DataStoreError('not-found', `Task ${taskId} does not exist`);
          let def: TaskDef | null = null;
          if (task.defId !== null) {
            const defSnapshot = await readDoc(taskDefDoc(db, worldId, task.defId));
            def = defSnapshot.exists() ? decodeTaskDef(defSnapshot) : null;
          }
          assertPlanAllowed(task, def, plan, now, world.ruleset.timezone);
          await updateDoc(taskDoc(db, worldId, taskId), { plan });
        });
      },

      createRecurringTasks(worldId, tasks) {
        const meta = newDoc();
        return write(undefined, async () => {
          for (const input of tasks) {
            const problem = newRecurringTaskProblem(input);
            if (problem) throw invalid(problem);
          }
          const member = decodeMember(await readDoc(memberDoc(db, worldId, requireUid())));
          if (!member?.profileId) throw denied('Choose a profile first');
          const createdBy = member.profileId;
          // One write per task: the server judges each on its own, so one refusal blocks no other.
          await settleRecurringWrites(
            tasks.map((input) => {
              const task: Task = {
                ...meta,
                id: input.id,
                profileId: input.profileId,
                title: input.title,
                level: input.level,
                question: input.question,
                source: 'recurring',
                defId: input.defId,
                periodKey: input.periodKey,
                createdBy,
                origin: 'app',
                plan: null,
                status: 'open',
                doneAt: null,
                answer: null,
                talkFlag: false,
                weekKey: null,
              };
              return setDoc(taskDoc(db, worldId, task.id), encodeTask(task)).catch((error: unknown) =>
                Promise.reject(toDataStoreError(error)),
              );
            }),
          );
        });
      },

      whenTasksSynced: (worldId, profileId) =>
        new Promise<void>((resolve, reject) => {
          let stop: Unsubscribe = () => {};
          let finished = false;
          stop = onSnapshot(
            query(tasksCollection(db, worldId), where('profileId', '==', profileId)),
            { includeMetadataChanges: true },
            (snapshot) => {
              if (finished || snapshot.metadata.fromCache) return;
              finished = true;
              stop();
              resolve();
            },
            (error) => {
              finished = true;
              reject(toDataStoreError(error));
            },
          );
          if (finished) stop();
        }),
    },

    rewards: {
      // Equality filters only, so no composite index is needed; the order is applied here.
      observeUnopenedRewards: (worldId, profileId, onValue, onError) =>
        onSnapshot(
          query(rewardsCollection(db, worldId), where('profileId', '==', profileId), where('openedAt', '==', null)),
          (snapshot) =>
            onValue(decodeAll(snapshot.docs, decodeReward).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))),
          (error) => onError?.(toDataStoreError(error)),
        ),
    },

    taskDefs: {
      observeTaskDefs: (worldId, onValue, onError) =>
        onSnapshot(
          query(taskDefsCollection(db, worldId), orderBy('title', 'asc')),
          (snapshot) => onValue(decodeAll(snapshot.docs, decodeTaskDef)),
          (error) => onError?.(toDataStoreError(error)),
        ),

      createTaskDef(worldId, input) {
        const defId = doc(taskDefsCollection(db, worldId)).id;
        const meta = newDoc();
        return write({ defId }, async () => {
          const problem = taskDefProblem(input);
          if (problem) throw invalid(problem);
          const def: TaskDef = {
            ...meta,
            id: defId,
            title: input.title,
            cadence: input.cadence,
            level: input.level,
            assignedTo: [...input.assignedTo],
            question: input.question,
            big: input.big,
            active: true,
          };
          await setDoc(taskDefDoc(db, worldId, defId), encodeTaskDef(def));
        });
      },

      updateTaskDef: (worldId, defId, patch) =>
        write(undefined, async () => {
          const problem = taskDefProblem(patch);
          if (problem) throw invalid(problem);
          // `updateDoc` rejects `undefined` values, so only the fields that were given are sent.
          const fields = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
          await updateDoc(taskDefDoc(db, worldId, defId), fields);
        }),
    },
  };
}
