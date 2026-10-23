/**
 * The shared "server" of the memory adapter: committed state plus the check
 * that every batch must pass, standing in for `firestore.rules`.
 */
import type { Collectible, Member, Profile, Reward, Task, TaskDef, Uid, World, WorldId } from '../../core/model';
import type { DataStoreError, Unsubscribe } from '../DataStore';

export interface WorldState {
  world: World;
  members: Map<Uid, Member>;
  profiles: Map<string, Profile>;
  tasks: Map<string, Task>;
  taskDefs: Map<string, TaskDef>;
  rewards: Map<string, Reward>;
  collectibles: Map<string, Collectible>;
  /**
   * Token balances by profile id (absent means 0). They live apart from `Profile`, which does not carry the
   * balance (SPEC.md §2), and change only by increments applied to the committed value at commit time, like
   * Firestore's `increment()` (docs/architecture.md §5).
   */
  balances: Map<string, number>;
}

export type MemoryState = Map<WorldId, WorldState>;

/**
 * One document write. `create` sets a whole document; `patch` merges fields into an existing one;
 * `increment` adds to a profile's token balance on the committed value, whatever the writer last saw.
 */
export type Op =
  | { worldId: WorldId; collection: 'world'; id: WorldId; create: World }
  | { worldId: WorldId; collection: 'world'; id: WorldId; patch: Partial<World> }
  | { worldId: WorldId; collection: 'members'; id: Uid; create: Member }
  | { worldId: WorldId; collection: 'members'; id: Uid; patch: Partial<Member> }
  | { worldId: WorldId; collection: 'profiles'; id: string; create: Profile }
  | { worldId: WorldId; collection: 'profiles'; id: string; patch: Partial<Profile> }
  | { worldId: WorldId; collection: 'profiles'; id: string; increment: { tokens: number } }
  /** Clears a profile's balance and party (restarting the universe). */
  | { worldId: WorldId; collection: 'profiles'; id: string; reset: true }
  | { worldId: WorldId; collection: 'tasks' | 'taskDefs' | 'rewards' | 'collectibles'; id: string; delete: true }
  | { worldId: WorldId; collection: 'tasks'; id: string; create: Task }
  | { worldId: WorldId; collection: 'tasks'; id: string; patch: Partial<Task> }
  | { worldId: WorldId; collection: 'taskDefs'; id: string; create: TaskDef }
  | { worldId: WorldId; collection: 'taskDefs'; id: string; patch: Partial<TaskDef> }
  | { worldId: WorldId; collection: 'rewards'; id: string; create: Reward }
  | { worldId: WorldId; collection: 'rewards'; id: string; patch: Partial<Reward> }
  | { worldId: WorldId; collection: 'collectibles'; id: string; create: Collectible }
  | { worldId: WorldId; collection: 'collectibles'; id: string; patch: Partial<Collectible> };

/** An atomic group of writes, with the server-side check that may refuse all of them. */
export interface Batch {
  ops: Op[];
  /** Runs against the committed state at commit time; returns the refusal, if any. */
  check(state: MemoryState): DataStoreError | null;
}

export interface MemoryBackend {
  /** Committed state. Read-only for callers; copy before changing. */
  readonly state: MemoryState;
  /** Checks and applies a batch atomically. Returns the refusal, or null when accepted. */
  commit(batch: Batch): DataStoreError | null;
  /** Called after every accepted commit. */
  subscribe(listener: () => void): Unsubscribe;
}

/** Applies `ops` to `state` in place. A patch to a missing document does nothing. */
export function applyOps(state: MemoryState, ops: readonly Op[]): void {
  for (const op of ops) {
    if (op.collection === 'world') {
      if ('create' in op) {
        state.set(op.worldId, {
          world: structuredClone(op.create),
          members: new Map(),
          profiles: new Map(),
          tasks: new Map(),
          taskDefs: new Map(),
          rewards: new Map(),
          collectibles: new Map(),
          balances: new Map(),
        });
      } else {
        const existing = state.get(op.worldId);
        if (existing) Object.assign(existing.world, structuredClone(op.patch));
      }
      continue;
    }
    const world = state.get(op.worldId);
    if (!world) continue;
    if ('reset' in op) {
      world.balances.delete(op.id);
      const profile = world.profiles.get(op.id);
      if (profile) profile.partyIds = [];
      continue;
    }
    if ('delete' in op) {
      (world[op.collection] as Map<string, object>).delete(op.id);
      continue;
    }
    if ('increment' in op) {
      world.balances.set(op.id, (world.balances.get(op.id) ?? 0) + op.increment.tokens);
      continue;
    }
    const documents = world[op.collection] as Map<string, object>;
    if ('create' in op) {
      documents.set(op.id, structuredClone(op.create));
    } else {
      const existing = documents.get(op.id);
      if (existing) Object.assign(existing, structuredClone(op.patch));
    }
  }
}

export function createMemoryBackend(): MemoryBackend {
  const state: MemoryState = new Map();
  const listeners = new Set<() => void>();

  return {
    state,
    commit(batch) {
      const refusal = batch.check(state);
      if (refusal) return refusal;
      applyOps(state, batch.ops);
      for (const listener of [...listeners]) listener();
      return null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
