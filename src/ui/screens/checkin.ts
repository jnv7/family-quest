import { drawTier, tierOddsFor } from '../../core/draw';
import type { ProfileId, Task, World } from '../../core/model';
import { visibleOpenTasks } from '../../core/tasks';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { pickLine } from '../lines';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';

/**
 * Where a task is completed, in one tap on the task itself (SPEC.md §7.4), so
 * two taps from the map, with its button first. A task with a question shows it with "yes" and "no":
 * yes completes it, no leaves it open and the character answers kindly, with no
 * failure recorded (the proposal in SPEC.md §6). Completing also draws the reward's tier
 * (SPEC.md §6) and says that it went to the vault, which adds no tap.
 */
export const renderCheckin: WorldScreen = (ctx, root, { worldId }) => {
  const { character } = ctx.theme;
  const bubble = h('p', { class: 'bubble', role: 'status' });
  const note = h('p', { class: 'reward-note', role: 'status' });
  // Static text, not a button: talking to the parents about a task done better than expected happens out loud.
  const betterNote = h('p', { class: 'hint', hidden: true }, ctx.text('checkin.betterNote'));
  const list = h('ul', { class: 'rows checkin-tasks' });
  const empty = h('div');
  const problem = h('div');
  let spoken = false;
  // The odds belong to the world, so a task can be completed once the world has arrived (at once, from the cache).
  let world: World | null = null;
  let tasks: Task[] | null = null;

  const say = (kind: keyof typeof character.lines) => {
    bubble.textContent = pickLine(character.lines[kind], ctx.randomInt);
  };

  const complete = (task: Task, answer: 'yes' | null) => {
    if (!world) return;
    const rewardTier = drawTier(tierOddsFor(task.level, world.ruleset), ctx.randomInt);
    ctx.settle(ctx.store.tasks.completeTask(worldId, task.id, { answer, talkFlag: task.talkFlag, rewardTier }).settled);
    say('congrats');
    note.textContent = ctx.text('checkin.reward');
  };

  /** The button that completes the task comes first, then the task (SPEC.md §7.4). */
  const row = (task: Task) => {
    const actions = task.question
      ? h('div', { class: 'task-actions' },
          h('button', { class: 'primary', onClick: () => complete(task, 'yes') }, ctx.text('checkin.yes')),
          h('button', { onClick: () => say('doubt') }, ctx.text('checkin.no')),
        )
      : h('div', { class: 'task-actions' }, h('button', { class: 'primary', onClick: () => complete(task, null) }, ctx.text('checkin.done')));
    return h('li', { class: 'checkin-task' },
      actions,
      h('div', { class: 'task-body' },
        h('span', { class: 'task-title' }, task.title),
        task.question && h('p', { class: 'question' }, task.question),
      ),
    );
  };

  const show = () => {
    if (tasks === null || world === null) return;
    if (!spoken) {
      say(tasks.length > 0 ? 'greeting' : 'farewell');
      spoken = true;
    }
    list.replaceChildren(...tasks.map(row));
    betterNote.hidden = tasks.length === 0;
    empty.replaceChildren(...(tasks.length === 0 ? [h('p', { class: 'message' }, ctx.text('checkin.empty'))] : []));
  };

  // A failure to read the world is shown like any other: the screen cannot complete anything without it.
  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((world = value), show()), onError),
  );

  root.append(
    h('h1', {}, ctx.text('checkin.title')),
    h('div', { class: 'character' }, artElement(ctx.theme, character.art, 'character-art'), bubble),
    note,
    problem,
    betterNote,
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
      ctx.store.tasks.observeOpenTasks(worldId, profile.id, (value) => ((tasks = visibleOpenTasks(value)), show()), onError),
    );
  });
  return () => {
    stopTasks();
    stopWorld();
    stopSelf();
  };
};
