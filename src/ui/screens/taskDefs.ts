import type { TaskDef, WorldId } from '../../core/model';
import type { AppContext, Dispose } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';

export interface TaskDefsSection {
  element: HTMLElement;
  dispose: Dispose;
}

/**
 * Recurring task definitions, in management (SPEC.md §7.8). Creating and editing use the one task
 * form. There is no delete: a definition that is no longer wanted is deactivated, and can come back.
 */
export function createTaskDefsSection(ctx: AppContext, worldId: WorldId): TaskDefsSection {
  let defs: TaskDef[] = [];
  const problem = h('div');
  const list = h('ul', { class: 'rows' });

  function drawList(): void {
    list.replaceChildren(
      ...(defs.length === 0
        ? [h('li', {}, h('span', {}, ctx.text('recurring.empty')))]
        : defs.map((def) =>
            h('li', { class: def.active ? '' : 'inactive' },
              h('span', {},
                def.title,
                ` · ${ctx.text(`cadence.${def.cadence}`)}`,
                !def.active && ` (${ctx.text('recurring.inactiveTag')})`,
              ),
              h('button', { onClick: () => ctx.go({ name: 'newTask', defId: def.id, from: 'tasks' }) }, ctx.text('recurring.editButton')),
              h('button', {
                onClick: () => ctx.settle(ctx.store.taskDefs.updateTaskDef(worldId, def.id, { active: !def.active }).settled),
              }, ctx.text(def.active ? 'recurring.deactivate' : 'recurring.activate')),
            ),
          )),
    );
  }

  const stop = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.taskDefs.observeTaskDefs(worldId, (value) => ((defs = value), drawList()), onError),
  );

  return {
    element: h('section', { class: 'stack' },
      h('h2', {}, ctx.text('recurring.title')),
      problem,
      list,
    ),
    dispose: stop,
  };
}
