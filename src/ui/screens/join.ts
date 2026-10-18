import { DataStoreError } from '../../data/DataStore';
import type { Screen } from '../context';
import { h } from '../dom';
import { extractWorldId } from '../routes';

/** Joins with the code from a link, or asks for the code to be typed. */
export function renderJoin(worldId: string | null): Screen {
  return (ctx, root) => {
    const message = h('p', { class: 'message', role: 'status' });
    let disposed = false;

    const join = async (id: string) => {
      message.textContent = ctx.text('join.joining');
      try {
        await ctx.store.worlds.joinWorld(id);
        if (disposed) return;
        ctx.world.set(id);
        ctx.go({ name: 'profiles' }, { replace: true });
      } catch (error) {
        if (disposed) return;
        const notFound = error instanceof DataStoreError && error.code === 'not-found';
        if (!notFound) console.error('Join failed', error);
        message.textContent = ctx.text(notFound ? 'error.codeNotFound' : 'error.generic');
      }
    };

    if (worldId !== null) {
      root.append(h('h1', {}, ctx.text('join.title')), message, h('button', { onClick: () => ctx.go({ name: 'start' }) }, ctx.text('app.back')));
      void join(worldId);
    } else {
      const code = h('input', { type: 'text', required: true, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
      const form = h('form', { class: 'stack' },
        h('label', {}, ctx.text('join.codeLabel'), code),
        h('button', { class: 'primary', type: 'submit' }, ctx.text('join.submit')),
        h('button', { type: 'button', onClick: () => ctx.go({ name: 'start' }) }, ctx.text('app.back')),
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const id = extractWorldId(code.value);
        if (id === null) message.textContent = ctx.text('error.codeInvalid');
        else ctx.go({ name: 'join', worldId: id });
      });
      root.append(h('h1', {}, ctx.text('join.title')), form, message);
    }
    return () => {
      disposed = true;
    };
  };
}
