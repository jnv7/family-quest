import type { ProfileId, Task } from '../../core/model';
import { visibleOpenTasks } from '../../core/tasks';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { pickLine } from '../lines';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';

/**
 * Where a task is completed, in one tap on the task itself (SPEC.md §7.4), so
 * two taps from the map. A task with a question shows it with "yes" and "no":
 * yes completes it, no leaves it open and the character answers kindly, with no
 * failure recorded (the proposal in SPEC.md §6).
 */
export const renderCheckin: WorldScreen = (ctx, root, { worldId }) => {
  const { character } = ctx.theme;
  const bubble = h('p', { class: 'bubble', role: 'status' });
  const list = h('ul', { class: 'rows checkin-tasks' });
  const empty = h('div');
  const problem = h('div');
  let spoken = false;

  const say = (kind: keyof typeof character.lines) => {
    bubble.textContent = pickLine(character.lines[kind], ctx.randomInt);
  };

  const complete = (task: Task, answer: 'yes' | null) => {
    ctx.settle(ctx.store.tasks.completeTask(worldId, task.id, { answer, talkFlag: task.talkFlag }).settled);
    say('congrats');
  };

  const row = (task: Task) => {
    const answers = task.question
      ? [
          h('p', { class: 'question' }, task.question),
          h('div', { class: 'answers' },
            h('button', { class: 'primary', onClick: () => complete(task, 'yes') }, ctx.text('checkin.yes')),
            h('button', { onClick: () => say('doubt') }, ctx.text('checkin.no')),
          ),
        ]
      : [h('button', { class: 'primary', onClick: () => complete(task, null) }, ctx.text('checkin.done'))];
    return h('li', { class: 'checkin-task' },
      h('span', { class: 'task-title' }, task.title),
      ...answers,
      h('button', {
        class: 'better',
        'aria-pressed': String(task.talkFlag),
        onClick: () => ctx.settle(ctx.store.tasks.setTalkFlag(worldId, task.id, !task.talkFlag).settled),
      }, ctx.text('checkin.better')),
    );
  };

  const show = (tasks: Task[]) => {
    if (!spoken) {
      say(tasks.length > 0 ? 'greeting' : 'farewell');
      spoken = true;
    }
    list.replaceChildren(...tasks.map(row));
    empty.replaceChildren(...(tasks.length === 0 ? [h('p', { class: 'message' }, ctx.text('checkin.empty'))] : []));
  };

  root.append(
    h('h1', {}, ctx.text('checkin.title')),
    h('div', { class: 'character' }, artElement(ctx.theme, character.art, 'character-art'), bubble),
    problem,
    list,
    empty,
    h('div', { class: 'stack' }, h('button', { onClick: () => ctx.go({ name: 'map' }) }, ctx.text('app.back'))),
  );

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
