import { adhocPermission } from '../../core/tasks';
import { LIMITS, type Profile, type Task, type TaskLevel, type World } from '../../core/model';
import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';

const LEVELS: readonly TaskLevel[] = ['low', 'mid', 'high'];

/**
 * Creates an ad hoc task. An adult picks who it is for; a child creates only for
 * themselves, up to the daily limit, which the rules cannot enforce (SPEC.md §5).
 */
export const renderNewTask: WorldScreen = (ctx, root, { worldId }) => {
  const title = h('input', { type: 'text', required: true, maxLength: LIMITS.title, autocomplete: 'off' });
  const level = h('select', {}, ...LEVELS.map((value) => h('option', { value, selected: value === 'mid' }, ctx.text(`level.${value}`))));
  const question = h('input', { type: 'text', maxLength: LIMITS.question, autocomplete: 'off' });
  const target = h('select', {});
  const targetField = h('label', {}, ctx.text('newTask.forWho'), target);
  const submit = h('button', { class: 'primary', type: 'submit', disabled: true }, ctx.text('newTask.submit'));
  const limitMessage = h('div');
  const worldProblem = h('div');
  const tasksProblem = h('div');
  const form = h('form', { class: 'stack' },
    h('label', {}, ctx.text('newTask.title'), title),
    h('label', {}, ctx.text('newTask.level'), level),
    h('label', {}, ctx.text('newTask.question'), question, h('small', {}, ctx.text('newTask.questionHint'))),
    targetField,
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
    const profileId = self.profile.kind === 'adult' ? target.value : self.profile.id;
    const created = ctx.store.tasks.createAdhocTask(worldId, {
      profileId,
      title: text,
      level: level.value as TaskLevel,
      question: question.value.trim() || null,
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
    targetField.hidden = profile.kind !== 'adult';
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
