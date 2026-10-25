import type { WorldScreen } from '../context';
import { h } from '../dom';
import { observeSelf } from '../self';
import { screenBar } from '../bar';
import { createPartySizeSection } from './partySize';
import { createPendingDaysSection } from './pendingDays';
import { createRestartSection } from './restart';
import { createShowcaseSizeSection } from './showcaseSize';
import { createTokenRulesSection } from './tokenRules';

/** The rules of the game, for admins only (SPEC.md §7.8): the token rules and the limits, then restarting the world, last. */
export const renderRules: WorldScreen = (ctx, root, { worldId }) => {
  const tokenRules = createTokenRulesSection(ctx, worldId);
  const partySize = createPartySizeSection(ctx, worldId);
  const reserveSize = createShowcaseSizeSection(ctx, worldId);
  const pendingDays = createPendingDaysSection(ctx, worldId);
  root.append(
    screenBar(ctx, { title: ctx.text('rules.title'), back: { name: 'map' } }),
    tokenRules.element,
    h('section', { class: 'stack' }, h('h2', {}, ctx.text('rules.limits')), partySize.element, reserveSize.element, pendingDays.element),
    createRestartSection(ctx, worldId),
  );
  const stopSelf = observeSelf(ctx, worldId, ({ isAdmin }) => {
    if (!isAdmin) ctx.go({ name: 'map' }, { replace: true });
  });
  return () => {
    stopSelf();
    tokenRules.dispose();
    partySize.dispose();
    reserveSize.dispose();
    pendingDays.dispose();
  };
};
