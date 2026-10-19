import { CADENCES, LIMITS, TIERS, type Cadence, type Profile, type TaskDef, type TaskLevel, type WorldId } from '../../core/model';
import type { TaskDefInput } from '../../data/DataStore';
import type { AppContext, Dispose } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';

export interface TaskDefsSection {
  element: HTMLElement;
  /** The world's profiles, for the "for whom" choice. Call again whenever they change. */
  setProfiles(profiles: readonly Profile[]): void;
  dispose: Dispose;
}

/**
 * Recurring task definitions, in management (SPEC.md §7.8). There is no delete:
 * a definition that is no longer wanted is deactivated, and can come back.
 */
export function createTaskDefsSection(ctx: AppContext, worldId: WorldId): TaskDefsSection {
  let defs: TaskDef[] = [];
  let profiles: readonly Profile[] = [];
  /** The definition being edited, or null when the form creates a new one. */
  let editing: TaskDef | null = null;

  const problem = h('div');
  const list = h('ul', { class: 'rows' });

  const title = h('input', { type: 'text', required: true, maxLength: LIMITS.title, autocomplete: 'off' });
  const cadence = h('select', {}, ...CADENCES.map((value) => h('option', { value }, ctx.text(`cadence.${value}`))));
  const level = h('select', {}, ...TIERS.map((value) => h('option', { value, selected: value === 'mid' }, ctx.text(`level.${value}`))));
  const question = h('input', { type: 'text', maxLength: LIMITS.question, autocomplete: 'off' });
  const big = h('input', { type: 'checkbox' });
  const people = h('div', { class: 'stack' });
  const formHeading = h('h3');
  const form = h('form', { class: 'stack', hidden: true },
    formHeading,
    h('label', {}, ctx.text('newTask.title'), title),
    h('label', {}, ctx.text('recurring.cadence'), cadence),
    h('label', {}, ctx.text('newTask.level'), level),
    h('label', {}, ctx.text('newTask.question'), question, h('small', {}, ctx.text('newTask.questionHint'))),
    h('label', { class: 'check' }, big, ctx.text('recurring.big')),
    h('fieldset', {}, h('legend', {}, ctx.text('recurring.forWho')), people, h('small', {}, ctx.text('recurring.forWhoHint'))),
    h('button', { class: 'primary', type: 'submit' }, ctx.text('recurring.save')),
    h('button', { type: 'button', onClick: () => closeForm() }, ctx.text('recurring.cancel')),
  );
  const addButton = h('button', { onClick: () => openForm(null) }, ctx.text('recurring.new'));

  /** Profiles to choose from: the active ones, plus any archived one this definition is already assigned to. */
  const choosable = (assigned: readonly string[]) => profiles.filter((p) => !p.archived || assigned.includes(p.id));

  function drawPeople(assigned: readonly string[]): void {
    people.replaceChildren(
      ...choosable(assigned).map((profile) =>
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', value: profile.id, checked: assigned.includes(profile.id) }),
          profile.displayName,
          profile.archived && ` (${ctx.text('manage.archivedTag')})`,
        ),
      ),
    );
  }

  const chosenPeople = (): string[] =>
    [...people.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].filter((box) => box.checked).map((box) => box.value);

  function openForm(def: TaskDef | null): void {
    editing = def;
    formHeading.textContent = ctx.text(def ? 'recurring.edit' : 'recurring.new');
    title.value = def?.title ?? '';
    cadence.value = def?.cadence ?? 'daily';
    level.value = def?.level ?? 'mid';
    question.value = def?.question ?? '';
    big.checked = def?.big ?? false;
    drawPeople(def?.assignedTo ?? []);
    form.hidden = false;
    addButton.hidden = true;
  }

  function closeForm(): void {
    editing = null;
    form.hidden = true;
    addButton.hidden = false;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = title.value.trim();
    if (!text) return;
    const input: TaskDefInput = {
      title: text,
      cadence: cadence.value as Cadence,
      level: level.value as TaskLevel,
      assignedTo: chosenPeople(),
      question: question.value.trim() || null,
      big: big.checked,
    };
    ctx.settle((editing ? ctx.store.taskDefs.updateTaskDef(worldId, editing.id, input) : ctx.store.taskDefs.createTaskDef(worldId, input)).settled);
    closeForm();
  });

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
              h('button', { onClick: () => openForm(def) }, ctx.text('recurring.editButton')),
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
    element: h('section', { class: 'stack' }, h('h2', {}, ctx.text('recurring.title')), problem, list, addButton, form),
    setProfiles(value) {
      profiles = value;
      // Redraw the choice only when the form is open, keeping what is ticked.
      if (!form.hidden) drawPeople(chosenPeople());
    },
    dispose: stop,
  };
}
