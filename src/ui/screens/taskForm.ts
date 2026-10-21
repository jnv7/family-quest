import { CADENCES, LIMITS, TIERS, type Cadence, type Profile, type ProfileId, type Task, type TaskDef, type TaskLevel, type World } from '../../core/model';
import { adhocPermission } from '../../core/tasks';
import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';
import { screenBar } from '../bar';

/** What a task repeats as. `once` makes ad hoc tasks; the others make a recurring definition. */
type Repeat = 'once' | Cadence;
const REPEATS: readonly Repeat[] = ['once', ...CADENCES];

/**
 * The one form that creates a task (SPEC.md §7.4), for the board and for management, and edits a
 * recurring definition when `defId` is given. An adult chooses who it is for, how often it repeats,
 * the difficulty and an optional question. A child only names the task: it is for themselves, once,
 * of normal difficulty and without a question, and limited per day, which the rules cannot enforce
 * (SPEC.md §5 and §6).
 */
export const renderTaskForm = (defId: string | null): WorldScreen => (ctx, root, { worldId }) => {
  const editing = defId !== null;

  const title = h('input', { type: 'text', required: true, maxLength: LIMITS.title, autocomplete: 'off' });
  const question = h('input', { type: 'text', maxLength: LIMITS.question, autocomplete: 'off' });
  const big = h('input', { type: 'checkbox' });
  const questionField = h('label', { hidden: true }, ctx.text('newTask.question'), question, h('small', {}, ctx.text('newTask.questionHint')));
  const addQuestion = h('button', { type: 'button', class: 'link', onClick: () => ((questionField.hidden = false), (addQuestion.hidden = true), question.focus()) }, ctx.text('newTask.addQuestion'));
  const bigField = h('label', { class: 'check' }, big, ctx.text('recurring.big'));

  /** Single choice among options, drawn as a row of buttons; the chosen one is pressed. */
  const segmented = <T extends string>(legend: string, values: readonly T[], label: (value: T) => string, initial: T, onChange: () => void) => {
    let current = initial;
    const buttons = new Map<T, HTMLButtonElement>();
    const paint = () => buttons.forEach((button, value) => button.setAttribute('aria-pressed', String(value === current)));
    for (const value of values) {
      buttons.set(value, h('button', { type: 'button', class: 'chip', onClick: () => ((current = value), paint(), onChange()) }, label(value)));
    }
    paint();
    return {
      element: h('div', { class: 'field', role: 'group', 'aria-label': legend }, h('span', { class: 'field-label' }, legend), h('div', { class: 'chips' }, ...buttons.values())),
      get: () => current,
      set(value: T) {
        current = value;
        paint();
      },
      hide(options: readonly T[]) {
        for (const [value, button] of buttons) button.hidden = options.includes(value);
      },
    };
  };

  const repeat = segmented(ctx.text('recurring.cadence'), REPEATS, (value) => ctx.text(value === 'once' ? 'cadence.once' : `cadence.${value}`), 'once', () => refresh());
  const level = segmented(ctx.text('newTask.level'), TIERS, (value) => ctx.text(`level.${value}`), 'mid', () => {});

  // Who it is for: a chip per profile and an "everyone" chip, with no default.
  let chosen = new Set<ProfileId>();
  let everyone = false;
  const people = h('div', { class: 'chips' });
  const everyoneHint = h('small', { hidden: true }, ctx.text('newTask.everyoneHint'));
  let profiles: readonly Profile[] = [];

  function drawPeople(): void {
    const assigned = editing ? [...chosen] : [];
    const shown = profiles.filter((p) => !p.archived || assigned.includes(p.id));
    const chip = (content: Array<string | HTMLElement>, pressed: boolean, onClick: () => void) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), onClick }, ...content);
    people.replaceChildren(
      chip([ctx.text('newTask.everyone')], everyone, () => {
        everyone = !everyone;
        chosen = new Set();
        drawPeople();
        refresh();
      }),
      ...shown.map((p) =>
        chip([p.avatar.symbol ? `${p.avatar.symbol} ` : '', p.displayName], !everyone && chosen.has(p.id), () => {
          everyone = false;
          if (!chosen.delete(p.id)) chosen.add(p.id);
          drawPeople();
          refresh();
        }),
      ),
    );
  }

  const adultFields = [
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, ctx.text('newTask.forWho')), people, everyoneHint),
    repeat.element,
    level.element,
    addQuestion,
    questionField,
    bigField,
  ];

  const heading = screenBar(ctx, { title: ctx.text(editing ? 'recurring.edit' : 'newTask.heading'), back: { name: editing ? 'manage' : 'board' } });
  const extra = h('div', { class: 'stack' });
  const submit = h('button', { class: 'primary', type: 'submit', disabled: true }, ctx.text(editing ? 'recurring.save' : 'newTask.submit'));
  const limitMessage = h('div');
  const worldProblem = h('div');
  const tasksProblem = h('div');
  const form = h('form', { class: 'stack' }, h('label', {}, ctx.text('newTask.title'), title), extra, submit);
  root.append(
    heading,
    worldProblem,
    tasksProblem,
    form,
    limitMessage,
  );

  let self: { profile: Profile; profiles: Profile[] } | null = null;
  let world: World | null = null;
  let myTasks: Task[] | null = null;
  let watchedProfile: string | null = null;
  let stopTasks = () => {};
  /** The definition being edited, applied to the fields once. */
  let loaded = !editing;

  const adult = () => self?.profile.kind === 'adult';

  const permission = () =>
    self && world && myTasks
      ? adhocPermission({ creator: self.profile, targetProfileId: self.profile.id, creatorTasks: myTasks, now: ctx.clock(), ruleset: world.ruleset })
      : null;

  function refresh(): void {
    if (!self) return;
    const recurring = adult() && repeat.get() !== 'once';
    bigField.hidden = !recurring;
    everyoneHint.hidden = !(recurring && everyone);
    if (editing) repeat.hide(['once']); // a definition is not a task: to stop it, deactivate it
    if (adult()) {
      submit.disabled = !loaded || !(everyone || chosen.size > 0);
      form.hidden = false;
      limitMessage.replaceChildren();
      return;
    }
    const ready = permission();
    const limitReached = ready === 'limit-reached';
    submit.disabled = ready !== 'allowed';
    form.hidden = limitReached;
    limitMessage.replaceChildren(...(limitReached ? [h('p', { class: 'message', role: 'status' }, ctx.text('newTask.limitReached'))] : []));
  }

  function applyDefinition(def: TaskDef): void {
    title.value = def.title;
    repeat.set(def.cadence);
    level.set(def.level);
    question.value = def.question ?? '';
    if (def.question) {
      questionField.hidden = false;
      addQuestion.hidden = true;
    }
    big.checked = def.big;
    everyone = def.assignedTo.length === 0;
    chosen = new Set(def.assignedTo);
    loaded = true;
    drawPeople();
    refresh();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = title.value.trim();
    if (!self || !text || submit.disabled) return;
    if (!adult()) {
      ctx.settle(ctx.store.tasks.createAdhocTask(worldId, { profileId: self.profile.id, title: text, level: 'mid', question: null }).settled);
      ctx.notify('notice.taskCreated');
      ctx.go({ name: 'board' });
      return;
    }
    const asked = question.value.trim() || null;
    const cadence = repeat.get();
    if (cadence === 'once') {
      const targets = everyone ? profiles.filter((p) => !p.archived).map((p) => p.id) : [...chosen];
      for (const profileId of targets) {
        ctx.settle(ctx.store.tasks.createAdhocTask(worldId, { profileId, title: text, level: level.get(), question: asked }).settled);
      }
      ctx.notify('notice.taskCreated');
      ctx.go({ name: 'board' });
      return;
    }
    const input = { title: text, cadence, level: level.get() as TaskLevel, assignedTo: everyone ? [] : [...chosen], question: asked, big: big.checked };
    ctx.settle((editing ? ctx.store.taskDefs.updateTaskDef(worldId, defId, input) : ctx.store.taskDefs.createTaskDef(worldId, input)).settled);
    ctx.go({ name: 'manage' });
  });

  const stopWorld = observeWithRetry(ctx, worldProblem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((world = value), refresh()), onError),
  );
  const stopDefs = editing
    ? observeWithRetry(ctx, worldProblem, (onError) =>
        ctx.store.taskDefs.observeTaskDefs(worldId, (value) => {
          const def = value.find((d) => d.id === defId);
          if (def && !loaded) applyDefinition(def);
        }, onError),
      )
    : () => {};
  const stopSelf = observeSelf(ctx, worldId, ({ profile, profiles: all, isAdmin }) => {
    if (!profile) {
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    if (editing && !isAdmin) {
      ctx.go({ name: 'map' }, { replace: true });
      return;
    }
    self = { profile, profiles: all };
    profiles = all;
    extra.replaceChildren(...(profile.kind === 'adult' ? adultFields : []));
    drawPeople();
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
    stopDefs();
    stopWorld();
  };
};
