import { activeProfileOf } from '../core/access';
import { recurringTasksToCreate } from '../core/generation';
import type { Member, Profile, ProfileId, Task, TaskDef, World, WorldId } from '../core/model';
import type { Unsubscribe } from '../data/DataStore';
import type { AppContext } from './context';

/** How long to wait for the server before generating from the cache (SPEC.md §6, **[proposal]**). */
export const SYNC_WAIT_MS = 5000;

export interface Generator {
  /** Follows a world (or none). Calling it again with the same world does nothing. */
  follow(worldId: WorldId | null): void;
  stop(): void;
}

/**
 * Creates the recurring tasks the active profile is due (SPEC.md §6): once after the app opens
 * and again after every profile switch. It first waits, for a short while, for the profile's
 * tasks to be read from the server, so it does not generate from an empty cache; then it reads
 * the latest definitions and tasks and asks the domain what is missing. It never blocks the
 * screens: they render from observers, and the new tasks arrive through them.
 */
export function createGenerator(
  ctx: Pick<AppContext, 'store' | 'uid' | 'clock' | 'settle'>,
  options: { syncWaitMs?: number } = {},
): Generator {
  const { store } = ctx;
  const syncWaitMs = options.syncWaitMs ?? SYNC_WAIT_MS;

  let worldId: WorldId | null = null;
  let stops: Unsubscribe[] = [];
  let stopTasks: Unsubscribe = () => {};
  /** Changes whenever the world or the active profile does, which cancels a run in progress. */
  let generation = 0;

  let members: Member[] | null = null;
  let profiles: Profile[] | null = null;
  let world: World | null = null;
  let defs: TaskDef[] | null = null;
  let tasks: Task[] | null = null;
  let activeId: ProfileId | null = null;

  let waiters: Array<() => void> = [];
  const changed = () => {
    const ready = waiters;
    waiters = [];
    for (const wake of ready) wake();
  };

  function refreshActive(): void {
    if (!members || !profiles || worldId === null) return;
    const id = activeProfileOf(ctx.uid, members, profiles)?.id ?? null;
    if (id === activeId) return;
    activeId = id;
    generation++;
    stopTasks();
    stopTasks = () => {};
    tasks = null;
    if (id === null) return;
    const forWorld = worldId;
    stopTasks = store.tasks.observeTasks(forWorld, id, (value) => ((tasks = value), changed()), ignore);
    void run(forWorld, id, generation);
  }

  async function run(forWorld: WorldId, profileId: ProfileId, mine: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), syncWaitMs);
    });
    const synced = store.tasks.whenTasksSynced(forWorld, profileId).then(() => 'synced' as const, () => 'unreadable' as const);
    const outcome = await Promise.race([synced, timeout]);
    clearTimeout(timer);
    // Not readable: there is nothing to generate from. Timed out: the cache is what we have.
    if (outcome === 'unreadable') return;

    while (mine === generation && !(profiles && world && defs && tasks)) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    if (mine !== generation || !profiles || !world || !defs || !tasks) return;

    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return;
    const due = recurringTasksToCreate({ profile, defs, tasks, now: ctx.clock(), timeZone: world.ruleset.timezone });
    if (due.length > 0) ctx.settle(store.tasks.createRecurringTasks(forWorld, due).settled);
  }

  // Errors are for the screens to report; the generator just stays idle.
  const ignore = () => {};

  return {
    follow(next) {
      if (next === worldId) return;
      this.stop();
      worldId = next;
      if (next === null) return;
      stops = [
        store.worlds.observeMembers(next, (value) => ((members = value), refreshActive(), changed()), ignore),
        store.worlds.observeProfiles(next, (value) => ((profiles = value), refreshActive(), changed()), ignore),
        store.worlds.observeWorld(next, (value) => ((world = value), changed()), ignore),
        store.taskDefs.observeTaskDefs(next, (value) => ((defs = value), changed()), ignore),
      ];
    },

    stop() {
      generation++;
      for (const stop of stops) stop();
      stopTasks();
      stops = [];
      stopTasks = () => {};
      worldId = null;
      members = profiles = world = defs = tasks = null;
      activeId = null;
      changed();
    },
  };
}
