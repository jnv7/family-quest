import { taskPlanAlert } from '../core/alerts';
import type { Task, TaskDef } from '../core/model';
import type { AppContext } from './context';
import { h, type Child } from './dom';

/** `2026-10-25` as "25 de outubro", in the interface language. */
export const dayLabel = (date: string): string =>
  new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

export interface TaskCardOptions {
  task: Task;
  /** The definition of a recurring task, when known; it gives the "repeats" chip. */
  def: TaskDef | undefined;
  /** The world's time zone, for the plan glow; null until the world has arrived. */
  timeZone: string | null;
  /** The card's one action: it comes first, in front of the title (SPEC.md §7.4). Absent on read-only cards. */
  action?: Child;
  /** Anything that belongs under the title, such as the plan form of a big task. */
  below?: Child[];
  /** A task the person has not seen yet: it carries a "novo" marker (never a number). */
  isNew?: boolean;
  className?: string;
}

/**
 * The one way a task looks, on the board, in the check-in and in the adults' view (SPEC.md §7):
 * the title, large, then chips for how it repeats, its plan and whether it has a question, with
 * the action first. The order of the cards comes from `sortForBoard`, never from the screen.
 */
export function taskCard(ctx: AppContext, { task, def, timeZone, action, below = [], isNew = false, className = '' }: TaskCardOptions): HTMLLIElement {
  const due = timeZone === null ? null : taskPlanAlert(task, ctx.clock(), timeZone);
  const chips = [
    isNew && h('span', { class: 'tag new' }, ctx.text('card.new')),
    def && h('span', { class: 'tag' }, `↻ ${ctx.text(`cadence.${def.cadence}`)}`),
    task.plan && h('span', { class: 'tag plan' }, `${dayLabel(task.plan.date)} · ${task.plan.trigger}`),
  ].filter(Boolean) as HTMLElement[];
  return h('li', { class: `task-card ${due ? `planned-${due} ` : ''}${className}`.trim(), 'data-task-id': task.id },
    action && h('div', { class: 'task-actions' }, action),
    h('div', { class: 'task-body' },
      h('span', { class: 'task-title' }, task.title),
      chips.length > 0 && h('div', { class: 'tags' }, ...chips),
      ...below,
    ),
  );
}
