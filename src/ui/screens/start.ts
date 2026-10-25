import { h } from '../dom';
import type { Screen } from '../context';

/** First launch: create a world or join one (SPEC.md §7.1). */
export const renderStart: Screen = (ctx, root) => {
  root.append(
    h('h1', {}, ctx.text('app.name')),
    h('p', {}, ctx.text(ctx.themeKnown ? 'start.intro' : 'start.introNeutral')),
    h('div', { class: 'stack' },
      h('button', { class: 'primary', onClick: () => ctx.go({ name: 'create' }) }, ctx.text(ctx.themeKnown ? 'start.create' : 'start.createNeutral')),
      h('button', { onClick: () => ctx.go({ name: 'join', worldId: null, themeId: null, profileId: null }) }, ctx.text('start.join')),
    ),
    h('p', { class: 'version' }, ctx.text('app.version', { version: ctx.build.version })),
  );
  return () => {};
};
