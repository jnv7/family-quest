import { drawSlot } from '../../core/draw';
import type { Collectible, ProfileId, Reward, Ruleset, TaskId, WeekKey } from '../../core/model';
import { canOpen } from '../../core/rewards';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/** Groups rewards by the week they were earned in, oldest week first; each group keeps its order. */
export function groupByWeek(rewards: readonly Reward[]): Array<{ weekKey: WeekKey; rewards: Reward[] }> {
  const groups = new Map<WeekKey, Reward[]>();
  for (const reward of rewards) groups.set(reward.weekKey, [...(groups.get(reward.weekKey) ?? []), reward]);
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([weekKey, list]) => ({ weekKey, rewards: list }));
}

/**
 * The vault: the active profile's own unopened rewards (SPEC.md §7.6), shown with the art of
 * their tier, which a person opens from the opening day on (SPEC.md §6). Nothing here is counted
 * for anyone else or compared (SPEC.md §2).
 *
 * The reveal is drawn from the collectibles the store reports, not from what this device drew:
 * if another device opened the same reward first, this one shows that device's collectible.
 */
export const renderVault: WorldScreen = (ctx, root, { worldId }) => {
  const problem = h('div');
  const reveals = h('div', { class: 'stack' });
  const content = h('div', { class: 'stack' });

  let ruleset: Ruleset | null = null;
  let rewards: Reward[] | null = null;
  let collectibles = new Map<TaskId, Collectible>();
  /** Rewards this person opened on this screen, in the order they were opened, until dismissed. */
  let revealed: TaskId[] = [];

  const open = (reward: Reward) => {
    const slot = drawSlot(ctx.theme.catalog.slots, reward.tier, ctx.randomInt);
    revealed = [...revealed, reward.id];
    ctx.settle(ctx.store.rewards.openReward(worldId, reward.id, { slot }).settled);
    draw();
  };

  const revealCard = (collectible: Collectible) => {
    const entry = ctx.theme.catalog.slots.find((slot) => slot.slot === collectible.slot);
    if (!entry) {
      console.warn(`The theme has no collectible "${collectible.slot}"`);
      return null;
    }
    return h('div', { class: 'reveal', role: 'status' },
      artElement(ctx.theme, entry.art, 'reveal-art'),
      h('p', {}, ctx.text('vault.revealed')),
      h('p', { class: 'reveal-name' }, entry.name),
      h('p', { class: 'reveal-tier' }, ctx.theme.tiers[collectible.tier]),
      h('button', { onClick: () => ((revealed = revealed.filter((id) => id !== collectible.id)), draw()) }, ctx.text('vault.close')),
    );
  };

  const rewardItem = (reward: Reward, rules: Ruleset) => {
    const art = artElement(ctx.theme, ctx.theme.rewardArt[reward.tier], 'reward-art');
    if (canOpen(reward, ctx.clock(), rules)) {
      return h('li', { class: 'reward', 'data-tier': reward.tier }, art, h('button', { class: 'primary', onClick: () => open(reward) }, ctx.text('vault.open')));
    }
    return h('li', { class: 'reward waiting', 'data-tier': reward.tier }, art, h('small', {}, ctx.text('vault.notYet', { weekday: ctx.text(`weekday.${WEEKDAYS[rules.openingDay - 1]}`) })));
  };

  function draw(): void {
    reveals.replaceChildren(
      ...revealed.flatMap((id) => {
        const collectible = collectibles.get(id);
        const card = collectible ? revealCard(collectible) : null;
        return card ? [card] : [];
      }),
    );
    if (rewards === null || ruleset === null) return;
    const rules = ruleset;
    const shown = rewards.filter((reward) => !revealed.includes(reward.id) || !collectibles.has(reward.id));
    if (shown.length === 0) {
      content.replaceChildren(revealed.length > 0 ? '' : h('p', { class: 'message' }, ctx.text('vault.empty')));
      return;
    }
    content.replaceChildren(
      ...groupByWeek(shown).map((group) =>
        h('section', { class: 'vault-week' },
          h('h2', {}, ctx.text('vault.week', { week: Number(group.weekKey.slice(-2)) })),
          h('ul', { class: 'reward-list' }, ...group.rewards.map((reward) => rewardItem(reward, rules))),
        ),
      ),
    );
  }

  root.append(
    h('h1', {}, ctx.text('vault.title')),
    problem,
    reveals,
    content,
    h('div', { class: 'stack' }, h('button', { onClick: () => ctx.go({ name: 'map' }) }, ctx.text('app.back'))),
  );

  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((ruleset = value.ruleset), draw()), onError),
  );
  let watchedProfile: ProfileId | null = null;
  let stopData = () => {};
  const stopSelf = observeSelf(ctx, worldId, ({ profile }) => {
    if (!profile) {
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    if (profile.id === watchedProfile) return;
    stopData();
    watchedProfile = profile.id;
    rewards = null;
    collectibles = new Map();
    revealed = [];
    const stopRewards = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.rewards.observeUnopenedRewards(worldId, profile.id, (value) => ((rewards = value), draw()), onError),
    );
    const stopCollectibles = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.collectibles.observeCollectibles(worldId, profile.id, (value) => ((collectibles = new Map(value.map((c) => [c.id, c]))), draw()), onError),
    );
    stopData = () => {
      stopRewards();
      stopCollectibles();
    };
  });
  return () => {
    stopData();
    stopWorld();
    stopSelf();
  };
};
