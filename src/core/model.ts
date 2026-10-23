/**
 * Domain model: the neutral schema from SPEC.md §4, as TypeScript types.
 *
 * Rules for this file:
 * - Pure types and constants only. No Firebase, no DOM.
 * - Names follow the neutral glossary (SPEC.md §3). No theme vocabulary.
 * - Timestamps are epoch milliseconds (`Millis`), taken from the device clock.
 *   Adapters convert them to and from their storage format.
 */

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Scalars

/** Epoch milliseconds, device clock. */
export type Millis = number;

/** Injected clock; production uses `Date.now`. */
export type Clock = () => Millis;

/** Injected randomness: an unbiased integer in `[0, maxExclusive)`. */
export type RandomInt = (maxExclusive: number) => number;

/** Calendar date in the world's timezone: `YYYY-MM-DD`. */
export type DateKey = string;

/** ISO week in the world's timezone: `YYYY-Www` (e.g. `2026-W53`). */
export type WeekKey = string;

/** Calendar month in the world's timezone: `YYYY-MM`. */
export type MonthKey = string;

/** The period a recurring task belongs to; its format depends on the cadence. */
export type PeriodKey = DateKey | WeekKey | MonthKey;

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type WorldId = string;
/** Anonymous-auth user id of a device. */
export type Uid = string;
export type ProfileId = string;
export type TaskDefId = string;
/** Also the id of the task's reward and collectible (SPEC.md §4). */
export type TaskId = string;
/** Stable identifier of a collectible in a theme catalogue. */
export type Slot = string;

// ---------------------------------------------------------------------------
// Enumerations (single source for the allowed values)

export const TIERS = ['low', 'mid', 'high'] as const;
export type Tier = (typeof TIERS)[number];

/** A task's difficulty uses the same three values as a reward tier. */
export type TaskLevel = Tier;

export const CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const PROFILE_KINDS = ['adult', 'child'] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

export type TaskStatus = 'open' | 'done' | 'retired';
export type TaskSource = 'recurring' | 'adhoc';
export type TaskOrigin = 'app' | 'api';
export type Answer = 'yes' | 'no';

// ---------------------------------------------------------------------------
// Field limits, shared by the client validation and firestore.rules

export const LIMITS = {
  worldName: 60,
  displayName: 40,
  title: 80,
  question: 140,
  trigger: 80,
  nickname: 30,
  /** A catalogue slot id (`firestore.rules`). */
  slot: 60,
  /** World ids are random and act as the access code (SPEC.md §5). */
  worldIdMinLength: 24,
  /** `showcaseSize` is a whole number from 1 to this (SPEC.md §4). */
  showcaseSizeMax: 30,
  /** Tokens a task can earn, per level (SPEC.md §4, firestore.rules). */
  tokensPerLevelMax: 10,
  /** The price of a reward, per tier (SPEC.md §4, firestore.rules). */
  tokenPriceMax: 200,
  /** `partySize` is a whole number from 1 to this. */
  partySizeMax: 10,
} as const;

/** Whether `size` is a valid `showcaseSize`: a whole number from 1 to `LIMITS.showcaseSizeMax`. */
export const isShowcaseSize = (size: number): boolean => Number.isInteger(size) && size >= 1 && size <= LIMITS.showcaseSizeMax;

// ---------------------------------------------------------------------------
// Documents. Every stored document carries these two fields.

export interface DocMeta {
  schemaVersion: typeof SCHEMA_VERSION;
  createdAt: Millis;
}

export interface Ruleset {
  partySize: number;
  showcaseSize: number;
  childDailyTaskLimit: number;
  timezone: 'Europe/Lisbon';
  weekStartsOn: 1;
  pendingDays: number;
  /** Tokens earned by completing a task, per level; fixed on the task when it is completed. */
  tokensPerLevel: Record<TaskLevel, number>;
  /** The price of a reward, per tier; strictly increasing from low to high. */
  tokenPrices: Record<Tier, number>;
  /** Extension point; always null until the product owner decides (SPEC.md §4). */
  guarantee: null;
}

export const DEFAULT_RULESET: Ruleset = {
  partySize: 5,
  showcaseSize: 10,
  childDailyTaskLimit: 3,
  timezone: 'Europe/Lisbon',
  weekStartsOn: 1,
  pendingDays: 1,
  tokensPerLevel: { low: 1, mid: 2, high: 4 },
  tokenPrices: { low: 5, mid: 12, high: 25 },
  guarantee: null,
};

/** `worlds/{worldId}` */
export interface World extends DocMeta {
  id: WorldId;
  name: string;
  /** Immutable after creation. */
  themeId: string;
  createdBy: Uid;
  ruleset: Ruleset;
}

/**
 * `worlds/{worldId}/members/{uid}`: one device.
 * A device has admin rights while its active profile is an adult profile.
 */
export interface Member extends DocMeta {
  uid: Uid;
  /** The device's active profile; null right after joining. */
  profileId: ProfileId | null;
}

/** Avatar layers as indices into the theme's art. Never an image. */
export interface Avatar {
  body: number;
  hair: number;
  outfit: number;
  accessory: number;
  /** One emoji from the theme's `profileSymbols`, shown on the profile's boat; null until chosen. */
  symbol: string | null;
}

export const DEFAULT_AVATAR: Avatar = { body: 0, hair: 0, outfit: 0, accessory: 0, symbol: null };

/** `worlds/{worldId}/profiles/{profileId}`: one person. */
export interface Profile extends DocMeta {
  id: ProfileId;
  displayName: string;
  /** Immutable. Adult profiles carry admin rights and are never archived. */
  kind: ProfileKind;
  avatar: Avatar;
  /** Source of truth for the party; at most `ruleset.partySize`. */
  partyIds: TaskId[];
  /** Profiles are never deleted; only child profiles can be archived. */
  archived: boolean;
}

/** `worlds/{worldId}/taskDefs/{defId}`: a recurring task definition. */
export interface TaskDef extends DocMeta {
  id: TaskDefId;
  title: string;
  cadence: Cadence;
  level: TaskLevel;
  /** Empty means every non-archived profile. */
  assignedTo: ProfileId[];
  question: string | null;
  /** Only big tasks can carry a plan (SPEC.md §6). */
  big: boolean;
  active: boolean;
}

export interface Plan {
  date: DateKey;
  trigger: string;
}

/** `worlds/{worldId}/tasks/{taskId}` */
export interface Task extends DocMeta {
  id: TaskId;
  profileId: ProfileId;
  title: string;
  level: TaskLevel;
  question: string | null;
  source: TaskSource;
  /** Set when `source` is `recurring`. */
  defId: TaskDefId | null;
  /** Set when `source` is `recurring`. */
  periodKey: PeriodKey | null;
  /** Profile id of whoever created the task. */
  createdBy: ProfileId;
  origin: TaskOrigin;
  /**
   * Set (true) only on an ad hoc task made big: it can then be planned, like a task of a big recurring
   * definition (whose `big` lives on the definition). Absent otherwise, and never changed after creation.
   */
  big?: boolean;
  plan: Plan | null;
  /** A done task never returns to open. */
  status: TaskStatus;
  doneAt: Millis | null;
  answer: Answer | null;
  talkFlag: boolean;
  /** Week of completion; null while open. */
  weekKey: WeekKey | null;
  /** Tokens earned, set at completion from 0.9; absent on tasks completed before 0.9 and on open or retired tasks. */
  tokens?: number;
  /** Set only when retired (ADR 0009). */
  retiredAt?: Millis;
  retiredBy?: ProfileId;
}

/** A reward id: a task's id for rewards from before 0.9, random for bought ones. Also the id of its collectible. */
export type RewardId = string;

/** `worlds/{worldId}/rewards/{rewardId}` */
export interface Reward extends DocMeta {
  id: RewardId;
  profileId: ProfileId;
  weekKey: WeekKey;
  tier: Tier;
  openedAt: Millis | null;
  /** Present only on a reward bought with tokens (from 0.9). Such a reward is created already opened. */
  price?: number;
}

/** `worlds/{worldId}/collectibles/{rewardId}` */
export interface Collectible extends DocMeta {
  id: TaskId;
  profileId: ProfileId;
  slot: Slot;
  tier: Tier;
  nickname: string | null;
  obtainedWeekKey: WeekKey;
  obtainedAt: Millis;
  /** Null while in the party or pending; set once moved to the reserve. */
  reserveAt: Millis | null;
}

// ---------------------------------------------------------------------------
// Ids

/** Deterministic id of a recurring task (SPEC.md §4). */
export function recurringTaskId(defId: TaskDefId, periodKey: PeriodKey, profileId: ProfileId): TaskId {
  return `${defId}_${periodKey}_${profileId}`;
}
