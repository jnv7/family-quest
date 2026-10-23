import type { WorldId } from '../../core/model';
import type { AppContext } from '../context';
import { h } from '../dom';

/**
 * The last thing in management: restarting the universe (ADR 0011, SPEC.md §6). It deletes every task, task
 * definition, reward and collectible, and clears everyone's tokens and party; the profiles and devices stay.
 * It cannot be undone, so it asks twice: first it says what goes, then the person types a word before the final
 * button is enabled. It is the one place in the game that deletes, and only an admin can reach it.
 */
export function createRestartSection(ctx: AppContext, worldId: WorldId): HTMLElement {
  const word = ctx.text('restart.word');
  const message = h('p', { class: 'message', role: 'status', hidden: true });
  const start = h('button', { type: 'button', class: 'danger' }, ctx.text('restart.start'));
  const typed = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters' });
  const confirm = h('button', { type: 'submit', class: 'danger', disabled: true }, ctx.text('restart.confirm'));
  const cancel = h('button', { type: 'button' }, ctx.text('restart.cancel'));
  const form = h('form', { class: 'stack restart-confirm', hidden: true },
    h('p', { role: 'alert' }, ctx.text('restart.warn')),
    h('label', {}, ctx.text('restart.type', { word }), typed),
    h('div', { class: 'task-actions' }, confirm, cancel),
  );

  const matches = () => typed.value.trim().toLowerCase() === word.toLowerCase();
  const reset = () => {
    form.hidden = true;
    start.hidden = false;
    typed.value = '';
    confirm.disabled = true;
  };

  typed.addEventListener('input', () => (confirm.disabled = !matches()));
  start.addEventListener('click', () => {
    message.hidden = true;
    start.hidden = true;
    form.hidden = false;
    typed.focus();
  });
  cancel.addEventListener('click', reset);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!matches()) return;
    confirm.disabled = true;
    message.hidden = false;
    message.textContent = ctx.text('restart.working');
    ctx.store.worlds.restartUniverse(worldId).settled.then(
      () => {
        reset();
        message.textContent = ctx.text('restart.done');
      },
      (error: unknown) => {
        reset();
        message.textContent = ctx.text('restart.failed');
        ctx.settle(Promise.reject(error));
      },
    );
  });

  return h('section', { class: 'stack restart' }, h('h2', {}, ctx.text('restart.title')), start, form, message);
}
