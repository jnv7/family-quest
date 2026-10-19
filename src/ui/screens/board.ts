import { taskPlanAlert } from '../../core/alerts';
import { dateKey, lastDayOfPeriod } from '../../core/calendar';
import { LIMITS, type ProfileId, type Task, type TaskDef, type TaskId, type World } from '../../core/model';
import { validatePlan } from '../../core/plan';
import { visibleOpenTasks } from '../../core/tasks';
import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';

const TRIGGER_SUGGESTIONS = ['plan.suggestion1', 'plan.suggestion2', 'plan.suggestion3'] as const;

/** `2026-10-25` as "25 de outubro", in the interface language. */
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/**
 * All open tasks of the active profile, oldest first, including those from past periods
 * (SPEC.md §7.3). A big task has a "plan" control: a day and a trigger, changed or cleared
 * at will, with no record kept (SPEC.md §6).
 */
export const renderBoard: WorldScreen = (ctx, root, { worldId }) => {
  const list = h('ul', { class: 'rows tasks' });
  const empty = h('div');
  const problem = h('div');

  root.append(
    h('h1', {}, ctx.text('board.title')),
    problem,
    list,
    empty,
    h('div', { class: 'stack' },
      h('button', { class: 'primary', onClick: () => ctx.go({ name: 'newTask' }) }, ctx.text('board.new')),
      h('button', { onClick: () => ctx.go({ name: 'map' }) }, ctx.text('app.back')),
    ),
  );

  let tasks: Task[] = [];
  let defs = new Map<string, TaskDef>();
  let world: World | null = null;
  /** The task whose plan is being edited. */
  let planning: TaskId | null = null;

  const planForm = (task: Task, def: TaskDef, timeZone: string) => {
    const today = dateKey(ctx.clock(), timeZone);
    const date = h('input', {
      type: 'date',
      required: true,
      min: today,
      max: lastDayOfPeriod(def.cadence, task.periodKey ?? today),
      value: task.plan?.date ?? today,
    });
    const trigger = h('input', { type: 'text', required: true, maxLength: LIMITS.trigger, autocomplete: 'off', value: task.plan?.trigger ?? '' });
    const save = (plan: { date: string; trigger: string } | null) => {
      if (plan && validatePlan(task, def, plan, ctx.clock(), timeZone) !== 'ok') return;
      ctx.settle(ctx.store.tasks.setPlan(worldId, task.id, plan).settled);
      planning = null;
      draw();
    };
    const form = h('form', { class: 'stack plan-form' },
      h('label', {}, ctx.text('plan.day'), date),
      h('label', {}, ctx.text('plan.trigger'), trigger),
      h('div', { class: 'suggestions' },
        ...TRIGGER_SUGGESTIONS.map((key) =>
          h('button', { type: 'button', onClick: () => (trigger.value = ctx.text(key)) }, ctx.text(key)),
        ),
      ),
      h('button', { class: 'primary', type: 'submit' }, ctx.text('plan.save')),
      task.plan && h('button', { type: 'button', onClick: () => save(null) }, ctx.text('plan.clear')),
      h('button', { type: 'button', onClick: () => ((planning = null), draw()) }, ctx.text('plan.cancel')),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      save({ date: date.value, trigger: trigger.value.trim() });
    });
    return form;
  };

  function draw(): void {
    const shown = visibleOpenTasks(tasks);
    const timeZone = world?.ruleset.timezone ?? null;
    list.replaceChildren(
      ...shown.map((task) => {
        const def = task.defId === null ? undefined : defs.get(task.defId);
        const canPlan = def?.big === true && timeZone !== null;
        const due = world ? taskPlanAlert(task, ctx.clock(), world.ruleset.timezone) : null;
        return h('li', { class: `board-task${due ? ` planned-${due}` : ''}` },
          h('span', {}, task.title),
          task.plan && h('small', { class: 'plan' }, `${dayLabel(task.plan.date)} · ${task.plan.trigger}`),
          canPlan && planning !== task.id &&
            h('button', { onClick: () => ((planning = task.id), draw()) }, ctx.text(task.plan ? 'plan.change' : 'plan.open')),
          canPlan && planning === task.id && planForm(task, def, timeZone),
        );
      }),
    );
    empty.replaceChildren(...(shown.length === 0 ? [h('p', { class: 'message' }, ctx.text('board.empty'))] : []));
  }

  let watchedProfile: ProfileId | null = null;
  let stopTasks = () => {};
  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((world = value), draw()), onError),
  );
  const stopDefs = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.taskDefs.observeTaskDefs(worldId, (value) => ((defs = new Map(value.map((d) => [d.id, d]))), draw()), onError),
  );
  const stopSelf = observeSelf(ctx, worldId, ({ profile }) => {
    if (!profile) {
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    if (profile.id === watchedProfile) return;
    stopTasks();
    watchedProfile = profile.id;
    stopTasks = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.tasks.observeOpenTasks(worldId, profile.id, (value) => ((tasks = value), draw()), onError),
    );
  });
  return () => {
    stopTasks();
    stopSelf();
    stopDefs();
    stopWorld();
  };
};
