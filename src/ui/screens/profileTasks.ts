import { dateKey } from '../../core/calendar';
import type { Profile, ProfileId, Task, TaskDef, World, WorldId } from '../../core/model';
import { doneRecently, sortForBoard } from '../../core/tasks';
import type { AppContext, Dispose } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { createRetireControl } from '../retire';
import { dayLabel, taskCard } from '../taskCard';

export interface ProfileTasksSection {
  element: HTMLElement;
  /** The world's profiles, for the choice. Call again whenever they change. */
  setProfiles(profiles: readonly Profile[]): void;
  /** The active profile, who may retire what its rights allow. */
  setActive(profile: Profile | null): void;
  dispose: Dispose;
}

const RECENT_DAYS = 7;

/**
 * "Tasks per profile", in management (SPEC.md §7.8): pick a profile and see its open tasks as the
 * same read-only cards the profile sees, and what it finished in the last week as a list with the
 * day. It is where a task made by mistake is found. Never a count, a ranking or a total (SPEC.md §2).
 */
export function createProfileTasksSection(ctx: AppContext, worldId: WorldId): ProfileTasksSection {
  let profiles: readonly Profile[] = [];
  let chosen: ProfileId | null = null;
  let world: World | null = null;
  let tasks: Task[] = [];
  let defs = new Map<string, TaskDef>();
  let watched: ProfileId | null = null;
  let stopTasks = () => {};
  let active: Profile | null = null;
  const retire = createRetireControl(ctx, worldId, () => draw());

  const problem = h('div');
  const choice = h('div', { class: 'chips' });
  const openList = h('ul', { class: 'rows tasks' });
  const doneList = h('ul', { class: 'rows' });
  const body = h('div', { class: 'stack', hidden: true });
  body.append(
    h('h3', {}, ctx.text('manage.tasksOpen')),
    openList,
    h('h3', {}, ctx.text('manage.tasksDone')),
    doneList,
  );

  function watch(): void {
    if (chosen === watched) return;
    stopTasks();
    watched = chosen;
    tasks = [];
    if (chosen === null) return;
    stopTasks = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.tasks.observeTasks(worldId, chosen!, (value) => ((tasks = value), draw()), onError),
    );
  }

  function draw(): void {
    choice.replaceChildren(
      ...profiles.filter((p) => !p.archived).map((p) =>
        h('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(p.id === chosen),
          onClick: () => ((chosen = chosen === p.id ? null : p.id), watch(), draw()),
        }, p.avatar.symbol ? `${p.avatar.symbol} ${p.displayName}` : p.displayName),
      ),
    );
    body.hidden = chosen === null || world === null;
    if (chosen === null || world === null) {
      openList.replaceChildren();
      doneList.replaceChildren();
      return;
    }
    const timeZone = world.ruleset.timezone;
    const open = sortForBoard(tasks, ctx.clock(), timeZone);
    openList.replaceChildren(
      ...(open.length === 0
        ? [h('li', {}, h('span', {}, ctx.text('manage.tasksNoneOpen')))]
        : open.map((task) => {
            const retiring = retire.parts(task, active);
            return taskCard(ctx, { task, def: task.defId === null ? undefined : defs.get(task.defId), timeZone, corner: retiring?.corner, below: [retiring?.below] });
          })),
    );
    const recent = doneRecently(tasks, ctx.clock(), RECENT_DAYS);
    doneList.replaceChildren(
      ...(recent.length === 0
        ? [h('li', {}, h('span', {}, ctx.text('manage.tasksNoneDone')))]
        : recent.map((task) => h('li', {}, h('span', {}, task.title), h('small', {}, dayLabel(dateKey(task.doneAt!, timeZone)))))),
    );
  }

  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((world = value), draw()), onError),
  );
  const stopDefs = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.taskDefs.observeTaskDefs(worldId, (value) => ((defs = new Map(value.map((d) => [d.id, d]))), draw()), onError),
  );

  return {
    element: h('section', { class: 'stack' }, h('h2', {}, ctx.text('manage.tasksTitle')), problem, choice, body),
    setProfiles(value) {
      profiles = value;
      if (chosen !== null && !value.some((p) => p.id === chosen)) chosen = null;
      watch();
      draw();
    },
    setActive(profile) {
      active = profile;
      draw();
    },
    dispose() {
      stopTasks();
      stopWorld();
      stopDefs();
    },
  };
}
