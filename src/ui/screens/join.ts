import { DataStoreError } from '../../data/DataStore';
import type { Screen } from '../context';
import { h } from '../dom';
import { mountInstallOffer } from '../installOffer';
import { joinAndChoose } from '../joining';
import { joinLink, parseJoinInput, type Route } from '../routes';

/**
 * Joins with the code from a link, or asks for the code to be typed or pasted.
 * On iOS in a browser tab it does not join: the installed app has its own storage,
 * so joining here would be lost. It offers the installation instead (ADR 0005).
 */
export function renderJoin(route: Extract<Route, { name: 'join' }>): Screen {
  const { worldId, profileId } = route;
  return (ctx, root) => {
    const message = h('p', { class: 'message', role: 'status' });
    let disposed = false;
    const disposers: Array<() => void> = [() => (disposed = true)];

    const join = async (id: string) => {
      message.textContent = ctx.text('join.joining');
      try {
        // A child's link (ADR 0015) saves the choice of profile on the first entry; any other link, or any trouble with it, shows the picker.
        const next = await joinAndChoose(ctx, id, profileId, { childOnly: true });
        if (disposed) return;
        ctx.world.set(id);
        ctx.world.setTheme(ctx.theme.id);
        ctx.go({ name: next }, { replace: true });
      } catch (error) {
        if (disposed) return;
        const notFound = error instanceof DataStoreError && error.code === 'not-found';
        if (!notFound) console.error('Join failed', error);
        message.textContent = ctx.text(notFound ? 'error.codeNotFound' : 'error.generic');
      }
    };

    const back = h('div', { class: 'stack' }, h('button', { onClick: () => ctx.go({ name: 'start' }) }, ctx.text('app.back')));

    if (worldId !== null) {
      const { platform } = ctx.installer;
      if (platform.isIos && !platform.isStandalone) {
        // Install first, then join from the installed app.
        const offer = h('div', { class: 'stack' });
        disposers.push(mountInstallOffer(ctx, offer));
        const link = joinLink(ctx.baseUrl, worldId, ctx.theme.id, profileId);
        const copy = h('button', {
          class: 'primary',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(link);
              message.textContent = ctx.text('share.copied');
            } catch {
              message.textContent = ctx.text('share.copyFailed');
            }
          },
        }, ctx.text('join.copyCode'));
        root.append(h('h1', {}, ctx.text('join.title')), h('p', {}, ctx.text('join.iosInstallFirst')), offer, h('div', { class: 'stack' }, copy), message, back);
      } else {
        root.append(h('h1', {}, ctx.text('join.title')), message, back);
        void join(worldId);
      }
    } else {
      const code = h('input', { type: 'text', required: true, autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
      const go = (text: string) => {
        const target = parseJoinInput(text);
        if (target === null) message.textContent = ctx.text('error.codeInvalid');
        else ctx.go({ name: 'join', worldId: target.worldId, themeId: target.themeId, profileId: target.profileId });
      };
      const form = h('form', { class: 'stack' },
        h('label', {}, ctx.text('join.codeLabel'), code),
        h('button', { class: 'primary', type: 'submit' }, ctx.text('join.submit')),
        h('button', {
          type: 'button',
          onClick: async () => {
            try {
              go(await navigator.clipboard.readText());
            } catch {
              message.textContent = ctx.text('join.pasteFailed');
            }
          },
        }, ctx.text('join.paste')),
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        go(code.value);
      });
      root.append(h('h1', {}, ctx.text('join.title')), form, message, back);
    }
    return () => disposers.forEach((dispose) => dispose());
  };
}
