import { drawTier, tierOddsFor } from '../../core/draw';
import type { ProfileId, Task, TaskDef, World } from '../../core/model';
import { isNewTask } from '../../core/alerts';
import { sortForBoard } from '../../core/tasks';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { pickLine } from '../lines';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';
import { taskCard } from '../taskCard';
import { screenBar } from '../bar';

const UNDO_MS = 4000;

/**
 * Where a task is completed, in one tap on the task itself (SPEC.md §7.4), so
 * two taps from the map, with its button first. A task with a question shows it with "yes" and "no":
 * yes completes it, no leaves it open and the character answers kindly, with no
 * failure recorded (the proposal in SPEC.md §6). Completing also draws the reward's tier
 * (SPEC.md §6) and says that it went to the vault, which adds no tap.
 */
export const renderCheckin = (focusId: string | null): WorldScreen => (ctx, root, { worldId }) => {
  const { character } = ctx.theme;
  const bubble = h('p', { class: 'bubble', role: 'status' });
  const note = h('p', { class: 'reward-note', role: 'status' });
  // Static text, not a button: talking to the parents about a task done better than expected happens out loud.
  const betterNote = h('p', { class: 'hint', hidden: true }, ctx.text('checkin.betterNote'));
  const list = h('ul', { class: 'rows checkin-tasks' });
  const empty = h('div');
  const problem = h('div');
  let spoken = false;
  let scrolled = false;
  // The odds belong to the world, so a task can be completed once the world has arrived (at once, from the cache).
  let world: World | null = null;
  let tasks: Task[] | null = null;
  let defs = new Map<string, TaskDef>();
  let seenBefore: number | null = null;
  const isNew = (task: Task) => isNewTask(task, defs, seenBefore);

  const say = (kind: keyof typeof character.lines) => {
    bubble.textContent = pickLine(character.lines[kind], ctx.randomInt);
  };

  /**
   * A completion is written when the undo window ends, so "Desfazer" writes nothing and nothing is
   * ever reopened in the data (SPEC.md §6). Hiding the page, or leaving the screen, writes at once.
   */
  const pending = new Map<string, { run: () => void; cancel: () => void }>();

  const complete = (task: Task, answer: 'yes' | null) => {
    if (!world || pending.has(task.id)) return;
    const current = world;
    const run = () => {
      const entry = pending.get(task.id);
      if (!entry) return;
      entry.cancel();
      pending.delete(task.id);
      const rewardTier = drawTier(tierOddsFor(task.level, current.ruleset), ctx.randomInt);
      ctx.settle(ctx.store.tasks.completeTask(worldId, task.id, { answer, talkFlag: task.talkFlag, rewardTier }).settled);
    };
    pending.set(task.id, { run, cancel: ctx.later(run, UNDO_MS) });
    say('congrats');
    note.textContent = ctx.text('checkin.reward');
    show();
  };

  const undo = (task: Task) => {
    pending.get(task.id)?.cancel();
    pending.delete(task.id);
    if (pending.size === 0) note.textContent = '';
    say('greeting');
    show();
  };

  const flush = () => [...pending.values()].forEach((entry) => entry.run());
  const onHidden = () => {
    if (document.hidden) flush();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', flush);

  /** The button that completes the task comes first, then the task (SPEC.md §7.4). */
  const row = (task: Task, timeZone: string) => {
    const asking = task.question !== null && !pending.has(task.id);
    const action = pending.has(task.id)
      ? h('button', { onClick: () => undo(task) }, ctx.text('checkin.undo'))
      : task.question
        ? undefined
        : h('button', { class: 'primary', onClick: () => complete(task, null) }, ctx.text('checkin.done'));
    return taskCard(ctx, {
      task,
      def: task.defId === null ? undefined : defs.get(task.defId),
      timeZone,
      action,
      below: [
        pending.has(task.id) && h('p', { class: 'message', role: 'status' }, ctx.text('checkin.doneNow')),
        // The character asks the question, so the answer is a reply to them (SPEC.md §7.4).
        asking &&
          h('div', { class: 'ask' },
            artElement(ctx.theme, character.art, 'character-art ask-art'),
            h('div', { class: 'ask-bubble' },
              h('p', { class: 'question' }, task.question),
              h('div', { class: 'task-actions' },
                h('button', { class: 'primary', onClick: () => complete(task, 'yes') }, ctx.text('checkin.yes')),
                h('button', { onClick: () => say('doubt') }, ctx.text('checkin.no')),
              ),
            ),
          ),
      ],
      focus: task.id === focusId,
      isNew: isNew(task),
      className: 'checkin-task',
    });
  };

  const show = () => {
    if (tasks === null || world === null) return;
    const shown = sortForBoard(tasks, ctx.clock(), world.ruleset.timezone, isNew);
    if (!spoken) {
      say(shown.length > 0 ? 'greeting' : 'farewell');
      spoken = true;
    }
    list.replaceChildren(...shown.map((task) => row(task, world!.ruleset.timezone)));
    betterNote.hidden = shown.length === 0;
    // The task the person was sent to from the board is brought into view, once.
    if (focusId !== null && !scrolled && shown.some((task) => task.id === focusId)) {
      scrolled = true;
      list.querySelector('.focus')?.scrollIntoView?.({ block: 'center' });
    }
    empty.replaceChildren(...(shown.length === 0 ? [h('p', { class: 'message' }, ctx.text('checkin.empty'))] : []));
  };

  // A failure to read the world is shown like any other: the screen cannot complete anything without it.
  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((world = value), show()), onError),
  );

  root.append(
    screenBar(ctx, { title: ctx.text('checkin.title'), back: { name: 'map' } }),
    h('div', { class: 'character' }, artElement(ctx.theme, character.art, 'character-art'), bubble),
    note,
    problem,
    betterNote,
    list,
    empty,
  );

  let watchedProfile: ProfileId | null = null;
  let stopTasks = () => {};
  const stopDefs = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.taskDefs.observeTaskDefs(worldId, (value) => ((defs = new Map(value.map((d) => [d.id, d]))), show()), onError),
  );
  const stopSelf = observeSelf(ctx, worldId, ({ profile }) => {
    if (!profile) {
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    if (profile.id === watchedProfile) return;
    stopTasks();
    watchedProfile = profile.id;
    seenBefore = ctx.world.getLastSeen(worldId, profile.id);
    ctx.world.setLastSeen(worldId, profile.id, ctx.clock());
    stopTasks = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.tasks.observeOpenTasks(worldId, profile.id, (value) => ((tasks = value), show()), onError),
    );
  });
  return () => {
    flush();
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', flush);
    stopTasks();
    stopWorld();
    stopDefs();
    stopSelf();
  };
};
