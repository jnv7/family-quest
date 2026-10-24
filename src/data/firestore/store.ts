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
  deleteField,
  getDoc,
  getDocsFromServer,
  increment,
  getDocFromCache,
  limit as limitTo,
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
import { nicknameTooLong, normaliseNickname } from '../../core/collection';
import { assertSymbolAllowed } from '../symbols';
import { checkPartyChange } from '../../core/party';
import { canRetire } from '../../core/tasks';
import { isPartySize, isTokenAmount, isTokenPrice, tokenRulesProblem } from '../../core/tokens';
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
  type Collectible,
  type DocMeta,
  type Member,
  type Profile,
  type RandomInt,
  type Reward,
  type RewardId,
  type Task,
  type TaskDef,
  type Uid,
  type World,
  type WorldId,
  isPendingDays,
  isShowcaseSize,
} from '../../core/model';
import { randomWorldId } from '../../core/random';
import {
  DataStoreError,
  type CompleteTaskInput,
  type DataStore,
  type Observer,
  type ObserverError,
  type ShowcaseItem,
  type Unsubscribe,
  type Write,
} from '../DataStore';
import {
  decodeAll,
  decodeCollectible,
  decodeMember,
  decodeProfile,
  decodeReward,
  decodeTask,
  decodeTaskDef,
  decodeWorld,
  encodeCollectible,
  encodeMember,
  encodeProfile,
  encodeReward,
  encodeReserveAt,
  encodeRewardOpening,
  encodeTask,
  encodeTaskCompletion,
  encodeTaskRetirement,
  encodeTaskDef,
  encodeWorld,
} from './converters';
import { toDataStoreError } from './errors';
import {
  collectibleDoc,
  collectiblesCollection,
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

/** Documents deleted per batch when restarting the universe (a batch holds at most 500 writes). */
const RESTART_BATCH = 200;

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

      setShowcaseSize: (worldId, size) =>
        write(undefined, async () => {
          if (!isShowcaseSize(size)) throw invalid(`The showcase size must be a whole number from 1 to ${LIMITS.showcaseSizeMax}`);
          await updateDoc(worldDoc(db, worldId), { 'ruleset.showcaseSize': size });
        }),

      setTokenRules: (worldId, rules) =>
        write(undefined, async () => {
          const problem = tokenRulesProblem(rules);
          if (problem) throw invalid(`The token rules are not valid (${problem})`);
          await updateDoc(worldDoc(db, worldId), {
            'ruleset.tokensPerLevel': rules.tokensPerLevel,
            'ruleset.tokenPrices': rules.tokenPrices,
          });
        }),

      setPartySize: (worldId, size) =>
        write(undefined, async () => {
          if (!isPartySize(size)) throw invalid(`The party size must be a whole number from 1 to ${LIMITS.partySizeMax}`);
          await updateDoc(worldDoc(db, worldId), { 'ruleset.partySize': size });
        }),

      setPendingDays: (worldId, days) =>
        write(undefined, async () => {
          if (!isPendingDays(days)) throw invalid(`The pending days must be a whole number from 1 to ${LIMITS.pendingDaysMax}`);
          await updateDoc(worldDoc(db, worldId), { 'ruleset.pendingDays': days });
        }),

      restartUniverse: (worldId) =>
        write(undefined, async () => {
          // The server is read, not the cache, so nothing left behind is missed; without a connection this fails.
          const [tasks, taskDefs, rewards, collectibles, profiles] = await Promise.all([
            getDocsFromServer(tasksCollection(db, worldId)),
            getDocsFromServer(taskDefsCollection(db, worldId)),
            getDocsFromServer(rewardsCollection(db, worldId)),
            getDocsFromServer(collectiblesCollection(db, worldId)),
            getDocsFromServer(profilesCollection(db, worldId)),
          ]);
          const refs = [tasks, taskDefs, rewards, collectibles].flatMap((snapshot) => snapshot.docs.map((d) => d.ref));
          // Each batch is atomic, the whole is not: running it again deletes what is left.
          for (let i = 0; i < refs.length; i += RESTART_BATCH) {
            const batch = writeBatch(db);
            for (const ref of refs.slice(i, i + RESTART_BATCH)) batch.delete(ref);
            await batch.commit();
          }
          const batch = writeBatch(db);
          for (const snapshot of profiles.docs) {
            const data = snapshot.data();
            const counted = data.tokens !== undefined || data.tokensFrom !== undefined || data.tokensFor !== undefined;
            if (counted || (Array.isArray(data.partyIds) && data.partyIds.length > 0)) {
              batch.update(snapshot.ref, { tokens: deleteField(), tokensFrom: deleteField(), tokensFor: deleteField(), partyIds: [] });
            }
          }
          await batch.commit();
        }),

      createProfile(worldId, input) {
        const profileId = doc(profilesCollection(db, worldId)).id;
        return write({ profileId }, async () => {
          checkText('Display name', input.displayName, LIMITS.displayName);
          if (input.kind !== 'adult' && input.kind !== 'child') throw invalid(`Unknown profile kind: ${String(input.kind)}`);
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
          await setDoc(profileDoc(db, worldId, profileId), encodeProfile(profile));
        });
      },

      setProfileSymbol: (worldId, profileId, symbol) =>
        write(undefined, async () => {
          assertSymbolAllowed(symbol);
          await updateDoc(profileDoc(db, worldId, profileId), { 'avatar.symbol': symbol });
        }),

      setProfileArchived: (worldId, profileId, archived) =>
        write(undefined, () => updateDoc(profileDoc(db, worldId, profileId), { archived })),

      renameProfile: (worldId, profileId, displayName) =>
        write(undefined, async () => {
          const name = displayName.trim();
          checkText('Display name', name, LIMITS.displayName);
          await updateDoc(profileDoc(db, worldId, profileId), { displayName: name });
        }),

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
            ...(input.big === true ? { big: true } : {}),
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

      completeTask: (worldId, taskId, input: CompleteTaskInput) => {
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
          if (!isTokenAmount(input.tokens)) throw invalid(`A task earns a whole number of tokens from 1 to ${LIMITS.tokensPerLevelMax}`);
          // One batch: the rules accept the tokens only together with the task moving to done.
          const batch = writeBatch(db);
          batch.update(
            taskDoc(db, worldId, taskId),
            encodeTaskCompletion({
              doneAt,
              answer: input.answer,
              talkFlag: input.talkFlag,
              weekKey: weekKey(doneAt, world.ruleset.timezone),
              tokens: input.tokens,
            }),
          );
          batch.update(profileDoc(db, worldId, task.profileId), { tokens: increment(input.tokens), tokensFrom: taskId });
          await batch.commit();
        });
      },

      retireTask: (worldId, taskId) => {
        const retiredAt = clock();
        return write(undefined, async () => {
          const [taskSnapshot, memberSnapshot] = await Promise.all([
            readDoc(taskDoc(db, worldId, taskId)),
            readDoc(memberDoc(db, worldId, requireUid())),
          ]);
          const task = taskSnapshot.exists() ? decodeTask(taskSnapshot) : null;
          if (!task) throw new DataStoreError('not-found', `Task ${taskId} does not exist`);
          const member = memberSnapshot.exists() ? decodeMember(memberSnapshot) : null;
          const profileSnapshot = member?.profileId ? await readDoc(profileDoc(db, worldId, member.profileId)) : null;
          const active = profileSnapshot?.exists() ? decodeProfile(profileSnapshot) : null;
          if (!active || !canRetire(task, active)) throw denied('This profile cannot retire this task');
          await updateDoc(taskDoc(db, worldId, taskId), encodeTaskRetirement(retiredAt, active.id));
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

    tokens: {
      observeBalance: (worldId, profileId, onValue, onError) =>
        onSnapshot(
          profileDoc(db, worldId, profileId),
          (snapshot) => onValue(snapshot.exists() ? ((snapshot.data()?.tokens as number | undefined) ?? 0) : 0),
          (error) => onError?.(toDataStoreError(error)),
        ),

      buyReward(worldId, input) {
        const rewardId: RewardId = doc(rewardsCollection(db, worldId)).id;
        const boughtAt = clock();
        return write({ rewardId }, async () => {
          checkText('Slot', input.slot, LIMITS.slot);
          if (!(TIERS as readonly string[]).includes(input.tier)) throw invalid(`Unknown reward tier: ${String(input.tier)}`);
          if (!isTokenPrice(input.price)) throw invalid(`A price is a whole number from 1 to ${LIMITS.tokenPriceMax}`);
          const [worldSnapshot, memberSnapshot] = await Promise.all([
            readDoc(worldDoc(db, worldId)),
            readDoc(memberDoc(db, worldId, requireUid())),
          ]);
          const world = worldSnapshot.exists() ? decodeWorld(worldSnapshot) : null;
          const member = memberSnapshot.exists() ? decodeMember(memberSnapshot) : null;
          if (!world) throw new DataStoreError('not-found', `World ${worldId} does not exist`);
          if (!member?.profileId) throw denied('Choose a profile first');
          const profileId = member.profileId;
          const profileSnapshot = await readDoc(profileDoc(db, worldId, profileId));
          const balance = profileSnapshot.exists() ? ((profileSnapshot.data()?.tokens as number | undefined) ?? 0) : 0;
          if (balance < input.price) throw invalid('The balance does not cover the price');
          const week = weekKey(boughtAt, world.ruleset.timezone);
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
          // One batch: the rules accept the reward only together with the price leaving the balance and its collectible.
          const batch = writeBatch(db);
          batch.update(profileDoc(db, worldId, profileId), { tokens: increment(-input.price), tokensFor: rewardId });
          batch.set(rewardDoc(db, worldId, rewardId), encodeReward(reward));
          batch.set(collectibleDoc(db, worldId, rewardId), encodeCollectible(collectible));
          await batch.commit();
        });
      },
    },

    rewards: {
      openReward(worldId, rewardId, input) {
        const openedAt = clock();
        return write(undefined, async () => {
          checkText('Slot', input.slot, LIMITS.slot);
          const [worldSnapshot, rewardSnapshot, memberSnapshot] = await Promise.all([
            readDoc(worldDoc(db, worldId)),
            readDoc(rewardDoc(db, worldId, rewardId)),
            readDoc(memberDoc(db, worldId, requireUid())),
          ]);
          const world = worldSnapshot.exists() ? decodeWorld(worldSnapshot) : null;
          const reward = rewardSnapshot.exists() ? decodeReward(rewardSnapshot) : null;
          if (!world || !reward) throw new DataStoreError('not-found', `Reward ${rewardId} does not exist`);
          const member = memberSnapshot.exists() ? decodeMember(memberSnapshot) : null;
          // Refused here as the rules would refuse it, so the screen never shows a false collectible.
          if (member?.profileId !== reward.profileId) throw denied('Only the owner opens a reward');
          if (reward.openedAt !== null) throw denied('A reward is opened once');
          const collectible: Collectible = {
            schemaVersion: SCHEMA_VERSION,
            createdAt: openedAt,
            id: rewardId,
            profileId: reward.profileId,
            slot: input.slot,
            tier: reward.tier,
            nickname: null,
            obtainedWeekKey: weekKey(openedAt, world.ruleset.timezone),
            obtainedAt: openedAt,
            reserveAt: null,
          };
          // One batch: the rules accept the collectible only together with the reward being opened.
          const batch = writeBatch(db);
          batch.update(rewardDoc(db, worldId, rewardId), encodeRewardOpening(openedAt));
          batch.set(collectibleDoc(db, worldId, rewardId), encodeCollectible(collectible));
          await batch.commit();
        });
      },

      // Equality filters only, so no composite index is needed; the order is applied here.
      observeUnopenedRewards: (worldId, profileId, onValue, onError) =>
        onSnapshot(
          query(rewardsCollection(db, worldId), where('profileId', '==', profileId), where('openedAt', '==', null)),
          (snapshot) =>
            onValue(decodeAll(snapshot.docs, decodeReward).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))),
          (error) => onError?.(toDataStoreError(error)),
        ),
    },

    collectibles: {
      arrangeParty(worldId, profileId, change) {
        const now = clock();
        return write(undefined, async () => {
          const ids = [...new Set([...change.partyIds, ...change.toReserve, ...change.fromReserve])];
          const [worldSnapshot, profileSnapshot, memberSnapshot, ...collectibleSnapshots] = await Promise.all([
            readDoc(worldDoc(db, worldId)),
            readDoc(profileDoc(db, worldId, profileId)),
            readDoc(memberDoc(db, worldId, requireUid())),
            ...ids.map((id) => readDoc(collectibleDoc(db, worldId, id))),
          ]);
          const world = worldSnapshot.exists() ? decodeWorld(worldSnapshot) : null;
          const profile = profileSnapshot.exists() ? decodeProfile(profileSnapshot) : null;
          if (!world || !profile) throw new DataStoreError('not-found', `Profile ${profileId} does not exist`);
          const member = memberSnapshot.exists() ? decodeMember(memberSnapshot) : null;
          if (member?.profileId !== profileId) throw denied('Only the owner arranges the party');
          // The party's current members are read too, so a stale id in it is reported, not ignored.
          const current = await Promise.all(
            profile.partyIds.filter((id) => !ids.includes(id)).map((id) => readDoc(collectibleDoc(db, worldId, id))),
          );
          const owned = [...collectibleSnapshots, ...current].flatMap((snapshot) => {
            const collectible = snapshot.exists() ? decodeCollectible(snapshot) : null;
            return collectible && collectible.profileId === profileId ? [collectible] : [];
          });
          const problem = checkPartyChange(profile, owned, change, world.ruleset.partySize);
          if (problem) throw invalid(`The party change is not valid (${problem})`);

          const batch = writeBatch(db);
          for (const id of change.toReserve) batch.update(collectibleDoc(db, worldId, id), encodeReserveAt(now));
          for (const id of change.fromReserve) batch.update(collectibleDoc(db, worldId, id), encodeReserveAt(null));
          const same = profile.partyIds.length === change.partyIds.length && profile.partyIds.every((id, i) => id === change.partyIds[i]);
          if (!same) batch.update(profileDoc(db, worldId, profileId), { partyIds: change.partyIds });
          await batch.commit();
        });
      },

      takeFromReserve(worldId, collectibleId, change) {
        const now = clock();
        return write(undefined, async () => {
          if (!change.partyIds.includes(collectibleId) || !change.fromReserve.includes(collectibleId)) {
            throw invalid('The taken collectible joins the party and leaves the reserve');
          }
          const ids = [...new Set([...change.partyIds, ...change.toReserve, ...change.fromReserve])];
          const [worldSnapshot, memberSnapshot, ...collectibleSnapshots] = await Promise.all([
            readDoc(worldDoc(db, worldId)),
            readDoc(memberDoc(db, worldId, requireUid())),
            ...ids.map((id) => readDoc(collectibleDoc(db, worldId, id))),
          ]);
          const world = worldSnapshot.exists() ? decodeWorld(worldSnapshot) : null;
          const member = memberSnapshot.exists() ? decodeMember(memberSnapshot) : null;
          if (!world) throw new DataStoreError('not-found', `World ${worldId} does not exist`);
          if (!member?.profileId) throw denied('Choose a profile first');
          const profileId = member.profileId;
          const profileSnapshot = await readDoc(profileDoc(db, worldId, profileId));
          const profile = profileSnapshot.exists() ? decodeProfile(profileSnapshot) : null;
          if (!profile) throw new DataStoreError('not-found', `Profile ${profileId} does not exist`);
          const current = await Promise.all(
            profile.partyIds.filter((id) => !ids.includes(id)).map((id) => readDoc(collectibleDoc(db, worldId, id))),
          );
          const known = [...collectibleSnapshots, ...current].flatMap((snapshot) => {
            const collectible = snapshot.exists() ? decodeCollectible(snapshot) : null;
            return collectible ? [collectible] : [];
          });
          const taken = known.find((collectible) => collectible.id === collectibleId);
          if (!taken) throw new DataStoreError('not-found', `Collectible ${collectibleId} does not exist`);
          if (taken.reserveAt === null) throw denied('Only what is in the reserve can be taken');
          // Once taken it is the profile's own, coming from the reserve.
          const owned = known.filter((collectible) => collectible.profileId === profileId && collectible.id !== collectibleId).concat({ ...taken, profileId });
          const problem = checkPartyChange(profile, owned, change, world.ruleset.partySize);
          if (problem) throw invalid(`The party change is not valid (${problem})`);

          const batch = writeBatch(db);
          batch.update(collectibleDoc(db, worldId, collectibleId), { profileId, ...encodeReserveAt(null) });
          for (const id of change.toReserve) batch.update(collectibleDoc(db, worldId, id), encodeReserveAt(now));
          for (const id of change.fromReserve) if (id !== collectibleId) batch.update(collectibleDoc(db, worldId, id), encodeReserveAt(null));
          const same = profile.partyIds.length === change.partyIds.length && profile.partyIds.every((id, i) => id === change.partyIds[i]);
          if (!same) batch.update(profileDoc(db, worldId, profileId), { partyIds: change.partyIds });
          await batch.commit();
        });
      },

      // A single inequality on the field it orders by: the automatic single-field index serves it.
      observeShowcase: (worldId, limit, onValue, onError) =>
        onSnapshot(
          query(collectiblesCollection(db, worldId), where('reserveAt', '!=', null), orderBy('reserveAt', 'desc'), limitTo(limit)),
          (snapshot) =>
            onValue(
              decodeAll(snapshot.docs, decodeCollectible).map((c): ShowcaseItem => ({
                id: c.id,
                slot: c.slot,
                tier: c.tier,
                nickname: c.nickname,
                reserveAt: c.reserveAt!,
              })),
            ),
          (error) => onError?.(toDataStoreError(error)),
        ),

      setNickname: (worldId, collectibleId, nickname) =>
        write(undefined, async () => {
          const value = nickname === null ? null : normaliseNickname(nickname);
          if (nicknameTooLong(value)) throw invalid(`A nickname has at most ${LIMITS.nickname} characters`);
          await updateDoc(collectibleDoc(db, worldId, collectibleId), { nickname: value });
        }),

      // One equality filter, so no composite index is needed; the order is applied here.
      observeCollectibles: (worldId, profileId, onValue, onError) =>
        onSnapshot(
          query(collectiblesCollection(db, worldId), where('profileId', '==', profileId)),
          (snapshot) =>
            onValue(decodeAll(snapshot.docs, decodeCollectible).sort((a, b) => b.obtainedAt - a.obtainedAt || (a.id < b.id ? -1 : 1))),
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
