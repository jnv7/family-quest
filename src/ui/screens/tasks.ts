import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeSelf } from '../self';
import { screenBar } from '../bar';
import { createProfileTasksSection } from './profileTasks';
import { createTaskDefsSection } from './taskDefs';

/** Tasks, for admins only (SPEC.md §7.8): every task of a profile, and the definitions of the ones that repeat. */
export const renderTasks: WorldScreen = (ctx, root, { worldId }) => {
  const profileTasks = createProfileTasksSection(ctx, worldId);
  const recurring = createTaskDefsSection(ctx, worldId);
  root.append(
    screenBar(ctx, {
      title: ctx.text('tasks.title'),
      back: { name: 'map' },
      action: h('button', { onClick: () => ctx.go({ name: 'newTask', defId: null, from: 'tasks' }) }, ctx.text('recurring.new')),
    }),
    profileTasks.element,
    recurring.element,
  );
  const stopSelf = observeSelf(ctx, worldId, ({ profiles, profile, isAdmin }) => {
    if (!isAdmin) {
      ctx.go({ name: 'map' }, { replace: true });
      return;
    }
    profileTasks.setActive(profile);
    profileTasks.setProfiles(profiles);
  });
  return () => {
    stopSelf();
    recurring.dispose();
    profileTasks.dispose();
  };
};
