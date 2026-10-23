import { canRetire } from '../core/tasks';
import type { Profile, Task, TaskId, WorldId } from '../core/model';
import type { AppContext } from './context';
import { h, type Child } from './dom';

/** What a card shows for retiring: the "⋯" button at its corner, and the question once the menu item is chosen. */
export interface RetireParts {
  corner: Child;
  below: Child;
}

/**
 * Retiring an open task (ADR 0009, SPEC.md §6), shared by the check-in and the adults' view. A "⋯" button
 * at the far corner of the card, shown only when the active profile may retire the task (`canRetire`), opens a
 * small menu with one item; choosing it asks once, in the card; confirming retires the task, which then leaves
 * every list through the observers. It adds no tap to completing a task, and it is never next to "done".
 */
export function createRetireControl(ctx: AppContext, worldId: WorldId, redraw: () => void) {
  let menuFor: TaskId | null = null;
  let confirming: TaskId | null = null;

  const close = () => {
    menuFor = null;
    confirming = null;
    redraw();
  };

  return {
    /** The parts for one card, or null when this person may not retire the task. */
    parts(task: Task, active: Profile | null): RetireParts | null {
      if (!active || !canRetire(task, active)) return null;
      const label = ctx.text('task.more');
      const corner = h('div', { class: 'task-corner' },
        h('button', {
          type: 'button',
          class: 'more',
          'aria-label': label,
          'aria-expanded': String(menuFor === task.id),
          onClick: () => {
            confirming = null;
            menuFor = menuFor === task.id ? null : task.id;
            redraw();
          },
        }, '⋯'),
        menuFor === task.id &&
          h('div', { class: 'task-menu', role: 'menu' },
            h('button', { type: 'button', role: 'menuitem', onClick: () => ((menuFor = null), (confirming = task.id), redraw()) }, ctx.text('task.retire')),
          ),
      );
      const below =
        confirming === task.id &&
        h('div', { class: 'retire-confirm', role: 'alert' },
          h('p', {}, ctx.text('task.retireConfirm')),
          h('div', { class: 'task-actions' },
            h('button', {
              class: 'primary',
              type: 'button',
              onClick: () => {
                confirming = null;
                ctx.settle(ctx.store.tasks.retireTask(worldId, task.id).settled);
                redraw();
              },
            }, ctx.text('task.retireDo')),
            h('button', { type: 'button', onClick: close }, ctx.text('task.retireCancel')),
          ),
        );
      return { corner, below };
    },
  };
}
