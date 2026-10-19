import { oddsProblem } from '../../core/draw';
import { TIERS, type Ruleset, type Tier, type TaskLevel, type WorldId } from '../../core/model';
import type { AppContext, Dispose } from '../context';
import { h } from '../dom';
import { observeWithRetry } from '../observe';

type Odds = Ruleset['tierOdds'];

export interface OddsSection {
  element: HTMLElement;
  dispose: Dispose;
}

/**
 * The reward odds of the world, in management: for each task level, the chance of each tier.
 * A world keeps the odds it was created with, so this is how they change (docs/plans/0.6.md).
 * Each row must be integers summing to 100, checked with the same rule as the draw.
 */
export function createOddsSection(ctx: AppContext, worldId: WorldId): OddsSection {
  const problem = h('div');
  const message = h('p', { class: 'message', role: 'alert', hidden: true }, ctx.text('odds.invalid'));
  const inputs = {} as Record<TaskLevel, Record<Tier, HTMLInputElement>>;
  const sums = {} as Record<TaskLevel, HTMLElement>;

  const rows = TIERS.map((level) => {
    inputs[level] = {} as Record<Tier, HTMLInputElement>;
    sums[level] = h('small');
    const fields = TIERS.map((tier) => {
      const input = h('input', { type: 'number', inputMode: 'numeric', min: 0, max: 100, step: 1, required: true });
      input.addEventListener('input', () => refreshSum(level));
      inputs[level][tier] = input;
      return h('label', {}, ctx.theme.tiers[tier], input);
    });
    return h('fieldset', {}, h('legend', {}, ctx.text('odds.row', { level: ctx.text(`level.${level}`) })), ...fields, sums[level]);
  });

  const rowOdds = (level: TaskLevel): Odds[TaskLevel] => ({
    low: Number(inputs[level].low.value),
    mid: Number(inputs[level].mid.value),
    high: Number(inputs[level].high.value),
  });

  function refreshSum(level: TaskLevel): void {
    const odds = rowOdds(level);
    sums[level].textContent = ctx.text('odds.sum', { sum: odds.low + odds.mid + odds.high });
  }

  const form = h('form', { class: 'stack' }, ...rows, message, h('button', { class: 'primary', type: 'submit' }, ctx.text('odds.save')));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const odds = { low: rowOdds('low'), mid: rowOdds('mid'), high: rowOdds('high') };
    message.hidden = TIERS.every((level) => oddsProblem(odds[level]) === null);
    if (!message.hidden) return;
    ctx.settle(ctx.store.worlds.setTierOdds(worldId, odds).settled);
  });

  // Follow the world while the form is untouched by a person typing in it.
  const stop = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(
      worldId,
      (world) => {
        if (form.contains(document.activeElement)) return;
        for (const level of TIERS) {
          for (const tier of TIERS) inputs[level][tier].value = String(world.ruleset.tierOdds[level][tier]);
          refreshSum(level);
        }
      },
      onError,
    ),
  );

  return {
    element: h('section', { class: 'stack' }, h('h2', {}, ctx.text('odds.title')), h('p', {}, ctx.text('odds.explain')), problem, form),
    dispose: stop,
  };
}
