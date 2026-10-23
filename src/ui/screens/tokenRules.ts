import { LIMITS, TIERS, type Ruleset, type Tier, type TaskLevel, type WorldId } from '../../core/model';
import { tokenRulesProblem, type TokenRulesProblem } from '../../core/tokens';
import type { AppContext, Dispose } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';

export interface TokenRulesSection {
  element: HTMLElement;
  dispose: Dispose;
}

const PROBLEM_TEXT: Record<TokenRulesProblem, string> = {
  'not-integer': 'tokenRules.notInteger',
  'out-of-range': 'tokenRules.outOfRange',
  'prices-not-increasing': 'tokenRules.pricesNotIncreasing',
};

/**
 * How many tokens a task earns per level, and what a reward costs per tier, in management (SPEC.md §4, §6).
 * They are the world's `ruleset`, shared by every device, and change only what is earned or bought from then
 * on. Saving runs the same check the data layer runs (`tokenRulesProblem`) and says what is wrong in one line.
 */
export function createTokenRulesSection(ctx: AppContext, worldId: WorldId): TokenRulesSection {
  const problem = h('div');
  const message = h('p', { class: 'message', role: 'alert', hidden: true });
  const earns = {} as Record<TaskLevel, HTMLInputElement>;
  const prices = {} as Record<Tier, HTMLInputElement>;

  const field = (label: string, input: HTMLInputElement, max: number) => {
    Object.assign(input, { type: 'number', inputMode: 'numeric', min: 1, max, step: 1, required: true });
    return h('label', {}, label, artElement(ctx.theme, ctx.theme.tokenArt, 'token-art'), input);
  };

  const earnRows = TIERS.map((level) => field(ctx.text(`level.${level}`), (earns[level] = h('input')), LIMITS.tokensPerLevelMax));
  const priceRows = TIERS.map((tier) => field(ctx.theme.tiers[tier], (prices[tier] = h('input')), LIMITS.tokenPriceMax));

  const form = h('form', { class: 'stack' },
    h('fieldset', {}, h('legend', {}, ctx.text('tokenRules.earns')), ...earnRows),
    h('fieldset', {}, h('legend', {}, ctx.text('tokenRules.prices')), ...priceRows),
    message,
    h('button', { class: 'primary', type: 'submit' }, ctx.text('tokenRules.save')),
  );

  const read = (): Pick<Ruleset, 'tokensPerLevel' | 'tokenPrices'> => ({
    tokensPerLevel: { low: Number(earns.low.value), mid: Number(earns.mid.value), high: Number(earns.high.value) },
    tokenPrices: { low: Number(prices.low.value), mid: Number(prices.mid.value), high: Number(prices.high.value) },
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const rules = read();
    const found = tokenRulesProblem(rules);
    message.hidden = found === null;
    if (found !== null) {
      message.textContent = ctx.text(PROBLEM_TEXT[found], { tokens: LIMITS.tokensPerLevelMax, price: LIMITS.tokenPriceMax });
      return;
    }
    ctx.settle(ctx.store.worlds.setTokenRules(worldId, rules).settled);
  });

  // Follow the world while nobody is typing in the form.
  const stop = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(
      worldId,
      (world) => {
        if (form.contains(document.activeElement)) return;
        for (const tier of TIERS) {
          earns[tier].value = String(world.ruleset.tokensPerLevel[tier]);
          prices[tier].value = String(world.ruleset.tokenPrices[tier]);
        }
      },
      onError,
    ),
  );

  return {
    element: h('section', { class: 'stack' }, h('h2', {}, ctx.text('tokenRules.title')), h('p', {}, ctx.text('tokenRules.explain')), problem, form),
    dispose: stop,
  };
}
