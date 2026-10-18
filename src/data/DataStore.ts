/**
 * The only way the app reads or writes data (SPEC.md §9, docs/architecture.md).
 *
 * Two adapters implement it: `firestore` (production) and `memory` (tests).
 * Operations are named by intent and use domain types only; no Firebase type
 * appears in this file or in any caller.
 *
 * "Admin only" means: the device's active profile is an adult profile.
 *
 * Scope: operations needed up to release 0.2. Recurring task definitions
 * (0.3) and rewards, collectibles and the party (0.6) are added by those
 * releases, as separate sub-interfaces.
 */
import type {
  Answer,
  Member,
  Profile,
  ProfileId,
  ProfileKind,
  Task,
  TaskId,
  TaskLevel,
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
}

export interface CreateAdhocTaskInput {
  profileId: ProfileId;
  title: string;
  level: TaskLevel;
  question: string | null;
}

export interface CompleteTaskInput {
  /** `yes` when the task has a question; null otherwise. */
  answer: Answer | null;
  talkFlag: boolean;
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

  /** Admin only. */
  createProfile(worldId: WorldId, input: CreateProfileInput): Write<{ profileId: ProfileId }>;
  /** Admin only, and only child profiles. Profiles are never deleted. */
  setProfileArchived(worldId: WorldId, profileId: ProfileId, archived: boolean): Write;

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
   * Moves an open task of the active profile to done, with the week of `now`.
   * From 0.6 the same batch also creates the reward.
   */
  completeTask(worldId: WorldId, taskId: TaskId, input: CompleteTaskInput): Write;

  /** Sets or clears the "I think I did better" flag on an open task of the active profile. */
  setTalkFlag(worldId: WorldId, taskId: TaskId, talkFlag: boolean): Write;
}

export interface DataStore {
  readonly session: SessionStore;
  readonly worlds: WorldStore;
  readonly tasks: TaskStore;
}
