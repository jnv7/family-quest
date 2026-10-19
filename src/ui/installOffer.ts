import type { AppContext, Dispose } from './context';
import { h } from './dom';

/**
 * Fills `container` with what can be done to install the app here, and keeps it
 * up to date. Nothing is offered until the theme is known (ADR 0005), and nothing
 * when the app is already installed or this browser cannot install it.
 *
 * - Android and desktop Chrome: a button that opens the browser's own dialog.
 * - iOS: the steps, with the theme's app name, because there is no install API.
 */
export function mountInstallOffer(ctx: AppContext, container: HTMLElement): Dispose {
  const draw = () => {
    if (!ctx.themeKnown) return container.replaceChildren();
    const mode = ctx.installer.mode();
    if (mode === 'prompt') {
      container.replaceChildren(
        h('button', { class: 'primary', onClick: () => void ctx.installer.prompt() }, ctx.text('install.button')),
      );
    } else if (mode === 'ios') {
      container.replaceChildren(
        h('p', { class: 'install-steps' }, ctx.text('install.ios', { appName: ctx.theme.install.name })),
      );
    } else {
      container.replaceChildren();
    }
  };
  draw();
  return ctx.installer.onChange(draw);
}

/** Whether there is anything to offer right now. */
export function canOfferInstall(ctx: AppContext): boolean {
  const mode = ctx.installer.mode();
  return ctx.themeKnown && (mode === 'prompt' || mode === 'ios');
}
