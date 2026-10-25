import type { WorldScreen } from '../context';
import { h } from '../dom';
import { screenBar } from '../bar';

/**
 * "Como instalar" (SPEC.md §7.10, ADR 0005): one case for the device, chosen from `Installer.mode()`, and
 * always the note about the invite link, which matters on iPhone where a join made in Safari is lost.
 */
export const renderInstall: WorldScreen = (ctx, root) => {
  const body = h('div', { class: 'stack' });
  root.append(screenBar(ctx, { title: ctx.text('install.title'), back: { name: 'map' } }), body);

  const draw = () => {
    const mode = ctx.installer.mode();
    const shown =
      mode === 'installed' ? [h('p', {}, ctx.text('install.done'))]
      : mode === 'prompt' ? [
          h('button', { class: 'primary', onClick: () => void ctx.installer.prompt() }, ctx.text('install.button')),
          h('p', {}, ctx.text('install.promptHelp')),
        ]
      : mode === 'ios' ? [h('p', { class: 'install-steps' }, ctx.text('install.ios', { appName: ctx.theme.install.name }))]
      : mode === 'android' ? [h('p', { class: 'install-steps' }, ctx.text('install.android'))]
      : [h('p', {}, ctx.text('install.other'))];
    body.replaceChildren(...shown, h('p', { class: 'message' }, ctx.text('install.inviteNote')));
  };
  draw();
  return ctx.installer.onChange(draw);
};
