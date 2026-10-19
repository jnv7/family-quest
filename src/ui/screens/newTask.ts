import { adhocPermission } from '../../core/tasks';
import { LIMITS, type Profile, type Task, type TaskLevel, type World } from '../../core/model';
import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';

const LEVELS: readonly TaskLevel[] = ['low', 'mid', 'high'];

/**
 * Creates an ad hoc task. An adult sets the difficulty, an optional question and
 * who it is for. A child only names the task: it is for themselves, of normal
 * difficulty and without a question, and limited per day, which the rules cannot
 * enforce (SPEC.md §5 and §6).
 */
export const renderNewTask: WorldScreen = (ctx, root, { worldId }) => {
  const title = h('input', { type: 'text', required: true, maxLength: LIMITS.title, autocomplete: 'off' });
  const level = h('select', {}, ...LEVELS.map((value) => h('option', { value, selected: value === 'mid' }, ctx.text(`level.${value}`))));
  const question = h('input', { type: 'text', maxLength: LIMITS.question, autocomplete: 'off' });
  const target = h('select', {});
  /** The fields only an adult sees; they are not drawn at all for a child. */
  const adultFields = [
    h('label', {}, ctx.text('newTask.level'), level),
    h('label', {}, ctx.text('newTask.question'), question, h('small', {}, ctx.text('newTask.questionHint'))),
    h('label', {}, ctx.text('newTask.forWho'), target),
  ];
  const extra = h('div', { class: 'stack' });
  const submit = h('button', { class: 'primary', type: 'submit', disabled: true }, ctx.text('newTask.submit'));
  const limitMessage = h('div');
  const worldProblem = h('div');
  const tasksProblem = h('div');
  const form = h('form', { class: 'stack' },
    h('label', {}, ctx.text('newTask.title'), title),
    extra,
    submit,
  );
  root.append(
    h('h1', {}, ctx.text('newTask.heading')),
    worldProblem,
    tasksProblem,
    form,
    limitMessage,
    h('div', { class: 'stack' }, h('button', { onClick: () => ctx.go({ name: 'board' }) }, ctx.text('app.back'))),
  );

  // Everything the permission needs arrives from three observers.
  let self: { profile: Profile; profiles: Profile[] } | null = null;
  let world: World | null = null;
  let myTasks: Task[] | null = null;
  let watchedProfile: string | null = null;
  let stopTasks = () => {};

  const permission = () =>
    self && world && myTasks
      ? adhocPermission({
          creator: self.profile,
          targetProfileId: self.profile.kind === 'adult' ? target.value || self.profile.id : self.profile.id,
          creatorTasks: myTasks,
          now: ctx.clock(),
          ruleset: world.ruleset,
        })
      : null;

  const refresh = () => {
    const ready = permission();
    const limitReached = ready === 'limit-reached';
    submit.disabled = ready !== 'allowed';
    form.hidden = limitReached;
    limitMessage.replaceChildren(
      ...(limitReached ? [h('p', { class: 'message', role: 'status' }, ctx.text('newTask.limitReached'))] : []),
    );
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = title.value.trim();
    if (!self || permission() !== 'allowed' || !text) return;
    const adult = self.profile.kind === 'adult';
    const created = ctx.store.tasks.createAdhocTask(worldId, {
      profileId: adult ? target.value : self.profile.id,
      title: text,
      level: adult ? (level.value as TaskLevel) : 'mid',
      question: adult ? question.value.trim() || null : null,
    });
    ctx.settle(created.settled);
    ctx.notify('notice.taskCreated');
    ctx.go({ name: 'board' });
  });
  target.addEventListener('change', refresh);

  const stopWorld = observeWithRetry(ctx, worldProblem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((world = value), refresh()), onError),
  );
  const stopSelf = observeSelf(ctx, worldId, ({ profile, profiles }) => {
    if (!profile) {
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    self = { profile, profiles };
    extra.replaceChildren(...(profile.kind === 'adult' ? adultFields : []));
    const previous = target.value;
    target.replaceChildren(
      ...profiles
        .filter((p) => !p.archived)
        .map((p) => h('option', { value: p.id, selected: p.id === (previous || profile.id) }, p.displayName)),
    );
    if (profile.id !== watchedProfile) {
      stopTasks();
      watchedProfile = profile.id;
      myTasks = null;
      stopTasks = observeWithRetry(ctx, tasksProblem, (onError) =>
        ctx.store.tasks.observeTasks(worldId, profile.id, (tasks) => ((myTasks = tasks), refresh()), onError),
      );
    }
    refresh();
  });
  return () => {
    stopTasks();
    stopSelf();
    stopWorld();
  };
};
