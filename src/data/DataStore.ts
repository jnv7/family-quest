/**
 * The only way the app reads or writes data (SPEC.md §9, docs/architecture.md).
 *
 * Two adapters implement it: `firestore` (production) and `memory` (tests).
 * Operations are named by intent and use domain types only; no Firebase type
 * appears in this file or in any caller.
 *
 * "Admin only" means: the device's active profile is an adult profile.
 *
 * Scope: operations needed up to release 0.7 (rewards, collectibles, the party, the showcase and profile symbols).
 */
import type { NewRecurringTask } from '../core/generation';
import type { PartyChange } from '../core/party';
import type {
  Answer,
  Cadence,
  Collectible,
  Member,
  Millis,
  Plan,
  Profile,
  ProfileId,
  ProfileKind,
  Reward,
  RewardId,
  Ruleset,
  Slot,
  Task,
  TaskDef,
  TaskDefId,
  TaskId,
  TaskLevel,
  Tier,
  Uid,
  World,
  WorldId,
} from '../core/model';

// ---------------------------------------------------------------------------
// Reading: observers

/** Stops an observer. Calling it twice is harmless. */
export type Unsubscribe = () => void;

/**
 * Receives the current value, first from the local cache and then on every
 * change, including the app's own pending writes and their reversal when the
 * server rejects them. The interface renders only from observers, which is
 * how a rejected write never leaves the screen in a false state (SPEC.md §10).
 */
export type Observer<T> = (value: T) => void;

/** Receives a failure of an observer, such as losing read access. */
export type ObserverError = (error: DataStoreError) => void;

// ---------------------------------------------------------------------------
// Writing

/**
 * The outcome of a write.
 *
 * The write is applied locally (and visible to observers) before the method
 * returns. `result` is available at once, for example a generated id.
 * `settled` resolves when the server accepts the write and rejects with a
 * `DataStoreError` when it refuses it. Offline, `settled` stays pending until
 * the device reconnects, so callers never await it before updating the screen.
 */
export interface Write<T = void> {
  result: T;
  settled: Promise<void>;
}

export type DataStoreErrorCode =
  /** The rules refused the write or read. */
  | 'permission-denied'
  /** The document already exists (for example, a duplicate recurring task). */
  | 'already-exists'
  | 'not-found'
  /** The input broke a domain invariant; checked before anything is written. */
  | 'invalid-argument'
  /** Network or backend unavailable for an operation that needs it (signing in the first time). */
  | 'unavailable'
  | 'unknown';

export class DataStoreError extends Error {
  readonly code: DataStoreErrorCode;

  constructor(code: DataStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DataStoreError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Inputs

export interface CreateWorldInput {
  name: string;
  themeId: string;
  /** Name of the creator's own adult profile, created in the same batch. */
  creatorDisplayName: string;
}

export interface CreateProfileInput {
  displayName: string;
  kind: ProfileKind;
  /** One of the theme's `profileSymbols`; otherwise `invalid-argument` before any write. */
  symbol?: string | null;
}

export interface CreateAdhocTaskInput {
  profileId: ProfileId;
  title: string;
  level: TaskLevel;
  question: string | null;
  /** Makes the task big, so its owner can plan it (SPEC.md §6). The form offers it to adults only; stored only when true. */
  big?: boolean;
}

export interface TaskDefInput {
  title: string;
  cadence: Cadence;
  level: TaskLevel;
  /** Empty means every non-archived profile. */
  assignedTo: ProfileId[];
  question: string | null;
  big: boolean;
}

export interface CompleteTaskInput {
  /** `yes` when the task has a question; null otherwise. */
  answer: Answer | null;
  talkFlag: boolean;
  /** Computed by the caller with `tokensFor(task.level, ruleset)`; a whole number from 1 to `LIMITS.tokensPerLevelMax`, else `invalid-argument`. */
  tokens: number;
}

// ---------------------------------------------------------------------------
// Sub-interfaces

export interface SessionStore {
  /**
   * Signs the device in anonymously, or restores its existing session.
   * Needs a network connection the very first time on a device.
   */
  signIn(): Promise<Uid>;
  /** The signed-in device, or null before `signIn` resolves. */
  currentUid(): Uid | null;
}

export interface WorldStore {
  /**
   * Creates, in one batch, the world, the creator's adult profile and this
   * device's membership on that profile, which makes the device admin.
   * The world id is random, at least `LIMITS.worldIdMinLength` characters.
   */
  createWorld(input: CreateWorldInput): Write<{ worldId: WorldId; profileId: ProfileId }>;

  /** Joins with no active profile. A no-op if already a member. */
  joinWorld(worldId: WorldId): Promise<Member>;

  /** This device's membership, or null if it is not a member. */
  getMembership(worldId: WorldId): Promise<Member | null>;

  observeWorld(worldId: WorldId, onValue: Observer<World>, onError?: ObserverError): Unsubscribe;
  observeMembers(worldId: WorldId, onValue: Observer<Member[]>, onError?: ObserverError): Unsubscribe;

  /** Every profile, archived ones included; the caller filters. */
  observeProfiles(worldId: WorldId, onValue: Observer<Profile[]>, onError?: ObserverError): Unsubscribe;

  /**
   * Admin only. Replaces the tokens a task earns per level and the price of a reward per tier. `tokenRulesProblem`
   * first (`invalid-argument`, before any write). Writes only `ruleset.tokensPerLevel` and `ruleset.tokenPrices`.
   */
  setTokenRules(worldId: WorldId, rules: Pick<Ruleset, 'tokensPerLevel' | 'tokenPrices'>): Write;

  /**
   * Admin only. Sets `ruleset.partySize`: a whole number from 1 to `LIMITS.partySizeMax`, otherwise `invalid-argument`
   * before any write. Nobody is removed from any party: a party above the size may only lose members.
   */
  setPartySize(worldId: WorldId, size: number): Write;

  /**
   * Admin only. Sets how many collectibles the showcase shows (`ruleset.showcaseSize`): a whole number from
   * 1 to `LIMITS.showcaseSizeMax`, otherwise `invalid-argument` before any write. Nothing is deleted:
   * the ones beyond the limit stay stored, out of reach (SPEC.md §6).
   */
  setShowcaseSize(worldId: WorldId, size: number): Write;

  /** Admin only. */
  createProfile(worldId: WorldId, input: CreateProfileInput): Write<{ profileId: ProfileId }>;
  /** Admin only, and only child profiles. Profiles are never deleted. */
  setProfileArchived(worldId: WorldId, profileId: ProfileId, archived: boolean): Write;

  /**
   * Owner or admin. `symbol` must be one of the theme's `profileSymbols`, or null; otherwise
   * `invalid-argument` before any write. Only `avatar.symbol` changes.
   */
  setProfileSymbol(worldId: WorldId, profileId: ProfileId, symbol: string | null): Write;

  /**
   * Sets this device's active profile (Netflix-style picker). Choosing an
   * adult profile gives the device admin rights.
   */
  chooseProfile(worldId: WorldId, profileId: ProfileId): Write;
}

export interface TaskStore {
  /** Open tasks of one profile, oldest first. */
  observeOpenTasks(worldId: WorldId, profileId: ProfileId, onValue: Observer<Task[]>, onError?: ObserverError): Unsubscribe;

  /** All tasks of one profile, newest first (admin view). */
  observeTasks(worldId: WorldId, profileId: ProfileId, onValue: Observer<Task[]>, onError?: ObserverError): Unsubscribe;

  /**
   * An admin creates for any profile; any device creates for its active profile.
   * The child daily limit is checked by the caller, in the domain.
   */
  createAdhocTask(worldId: WorldId, input: CreateAdhocTaskInput): Write<{ taskId: TaskId }>;

  /**
   * One batch: the open task of the active profile moves to done, with the week of `now` and `input.tokens`, and its
   * profile gets `increment(tokens)` and `tokensFrom: taskId`. No reward. The server adds the tokens to the real
   * balance, so two offline devices that each complete a task end with the sum of both.
   */
  completeTask(worldId: WorldId, taskId: TaskId, input: CompleteTaskInput): Write;

  /**
   * `canRetire` first (`permission-denied`, before any write); then the task's status becomes `retired`, `retiredAt` is
   * now and `retiredBy` is the active profile (ADR 0009). A retired task leaves `observeOpenTasks` and is never
   * generated again for its period.
   */
  retireTask(worldId: WorldId, taskId: TaskId): Write;

  /** Sets or clears the "I think I did better" flag on an open task of the active profile. */
  setTalkFlag(worldId: WorldId, taskId: TaskId, talkFlag: boolean): Write;

  /**
   * Owner only, on an open task whose definition is `big`. `null` clears the plan.
   * A plan the domain refuses (`validatePlan`) is `invalid-argument`, before any write.
   */
  setPlan(worldId: WorldId, taskId: TaskId, plan: Plan | null): Write;

  /**
   * Creates each task with its deterministic id, one write per task (not one
   * batch: a rejected task must not block the others). Rejections with
   * `permission-denied` or `already-exists` are expected and silent (SPEC.md §10);
   * `settled` rejects only on any other error.
   */
  createRecurringTasks(worldId: WorldId, tasks: readonly NewRecurringTask[]): Write;

  /**
   * Resolves once this profile's tasks have been read from the server at least
   * once since the app started. It never resolves while offline.
   * Firestore: onSnapshot with includeMetadataChanges, until metadata.fromCache is false.
   */
  whenTasksSynced(worldId: WorldId, profileId: ProfileId): Promise<void>;
}

export interface TaskDefStore {
  /** Every definition, active and inactive, ordered by title. */
  observeTaskDefs(worldId: WorldId, onValue: Observer<TaskDef[]>, onError?: ObserverError): Unsubscribe;
  /** Admin only. Created active. */
  createTaskDef(worldId: WorldId, input: TaskDefInput): Write<{ defId: TaskDefId }>;
  /**
   * Admin only. Definitions are never deleted: deactivate them with `active: false`.
   * Tasks already created keep the title, level and question they copied.
   */
  updateTaskDef(worldId: WorldId, defId: TaskDefId, patch: Partial<TaskDefInput & { active: boolean }>): Write;
}

export interface TokenStore {
  /**
   * The profile's balance (0 when it has none yet). The interface calls it only for the active profile and shows it
   * only at the top of the vault (SPEC.md §2); no other type carries it.
   */
  observeBalance(worldId: WorldId, profileId: ProfileId, onValue: Observer<number>, onError?: ObserverError): Unsubscribe;

  /**
   * One batch, for the active profile: the profile gets `increment(-price)` and `tokensFor`; `rewards/{id}` is created
   * already opened, with the tier, the price, the week of now and `openedAt` now; `collectibles/{id}` is created with
   * the given slot (pending: no nickname, `reserveAt: null`). The id is random and returned at once. The caller passes
   * `priceOf(tier, ruleset)` and a slot drawn with `drawSlot(catalogue, tier, randomInt)`.
   *
   * Before any write: `invalid-argument` if the price is not a whole number from 1 to `LIMITS.tokenPriceMax`, or if the
   * balance this device knows is below it. The server refuses a double spend: `settled` rejects with `permission-denied`
   * and nothing changes.
   */
  buyReward(worldId: WorldId, input: { tier: Tier; price: number; slot: Slot }): Write<{ rewardId: RewardId }>;
}

export interface RewardStore {
  /** The profile's unopened rewards, oldest first. Owner or admin. */
  observeUnopenedRewards(worldId: WorldId, profileId: ProfileId, onValue: Observer<Reward[]>, onError?: ObserverError): Unsubscribe;

  /**
   * One batch: sets `openedAt` to now on the reward and creates `collectibles/{rewardId}` with the
   * reward's profile and tier, the given `slot`, no nickname, `obtainedWeekKey` of now,
   * `obtainedAt` now and `reserveAt: null`. Owner only, once: a reward already opened (here or
   * on another device) is `permission-denied`, and nothing changes. The caller checks `canOpen`
   * first and draws the slot with `drawSlot(theme catalogue, reward.tier, randomInt)`.
   */
  openReward(worldId: WorldId, rewardId: RewardId, input: { slot: Slot }): Write;
}

/** What the showcase may show about a collectible: never the owner (SPEC.md §2, §6). */
export interface ShowcaseItem {
  id: TaskId;
  slot: Slot;
  tier: Tier;
  nickname: string | null;
  reserveAt: Millis;
}

export interface CollectibleStore {
  /** The profile's collectibles, newest first. Every member can read them (the showcase needs other people's); the interface never shows the owner. */
  observeCollectibles(worldId: WorldId, profileId: ProfileId, onValue: Observer<Collectible[]>, onError?: ObserverError): Unsubscribe;

  /**
   * One batch: `profile.partyIds := change.partyIds`, plus the `reserveAt` changes (`toReserve`
   * get the time of the call, `fromReserve` get null). Owner only. The adapter runs
   * `checkPartyChange` first and rejects with `invalid-argument` before any write if it fails.
   * The profile is not written when its `partyIds` do not change, so the silent move of old
   * pending collectibles to the reserve never overwrites a party another device just edited.
   */
  arrangeParty(worldId: WorldId, profileId: ProfileId, change: PartyChange): Write;

  /**
   * ADR 0010: the active profile takes a collectible from the reserve, whoever owned it. One batch: the collectible's
   * `profileId` becomes the active profile's and `reserveAt` becomes null (its name stays), and the profile gets
   * `change.partyIds`, which must contain it; `change.fromReserve` must contain it too. The rest of `change` is as
   * in `arrangeParty` (who leaves a full party goes to the reserve). Checked with `checkPartyChange` first
   * (`invalid-argument`). A collectible that is no longer in the reserve, because someone took it first, is
   * `permission-denied` and nothing changes.
   */
  takeFromReserve(worldId: WorldId, collectibleId: TaskId, change: PartyChange): Write;

  /**
   * Sets or clears a collectible's nickname (SPEC.md §4). The text is trimmed; empty means null;
   * longer than `LIMITS.nickname` is `invalid-argument` before any write. Owner, or an admin
   * (moderation: the showcase shows nicknames to everyone).
   */
  /**
   * The world's collectibles in the reserve (`reserveAt` set), newest first, at most `limit`
   * (`ruleset.showcaseSize`). Any member. The adapter maps each document to a `ShowcaseItem`, so
   * the owner never reaches the interface; the data itself stays readable by members (SPEC.md §5).
   * The others stay stored.
   */
  observeShowcase(worldId: WorldId, limit: number, onValue: Observer<ShowcaseItem[]>, onError?: ObserverError): Unsubscribe;

  setNickname(worldId: WorldId, collectibleId: TaskId, nickname: string | null): Write;
}

export interface DataStore {
  readonly session: SessionStore;
  readonly worlds: WorldStore;
  readonly tasks: TaskStore;
  readonly taskDefs: TaskDefStore;
  readonly rewards: RewardStore;
  readonly tokens: TokenStore;
  readonly collectibles: CollectibleStore;
}
