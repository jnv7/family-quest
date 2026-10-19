import type { ProfileId, Task } from '../../core/model';
import { visibleOpenTasks } from '../../core/tasks';
import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';

/** All open tasks of the active profile, oldest first, including those from past periods (SPEC.md §7.3). */
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

  const show = (tasks: Task[]) => {
    list.replaceChildren(...tasks.map((task) => h('li', {}, h('span', {}, task.title))));
    empty.replaceChildren(...(tasks.length === 0 ? [h('p', { class: 'message' }, ctx.text('board.empty'))] : []));
  };

  let watchedProfile: ProfileId | null = null;
  let stopTasks = () => {};
  const stopSelf = observeSelf(ctx, worldId, ({ profile }) => {
    if (!profile) {
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    if (profile.id === watchedProfile) return;
    stopTasks();
    watchedProfile = profile.id;
    stopTasks = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.tasks.observeOpenTasks(worldId, profile.id, (tasks) => show(visibleOpenTasks(tasks)), onError),
    );
  });
  return () => {
    stopTasks();
    stopSelf();
  };
};
