import type { ProfileId, Reward, WeekKey } from '../../core/model';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { observeSelf } from '../self';

/** Groups rewards by the week they were earned in, oldest week first; each group keeps its order. */
export function groupByWeek(rewards: readonly Reward[]): Array<{ weekKey: WeekKey; rewards: Reward[] }> {
  const groups = new Map<WeekKey, Reward[]>();
  for (const reward of rewards) groups.set(reward.weekKey, [...(groups.get(reward.weekKey) ?? []), reward]);
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([weekKey, list]) => ({ weekKey, rewards: list }));
}

/**
 * The vault: the active profile's own unopened rewards (SPEC.md §7.6), shown with the art of
 * their tier. Nothing here is counted for anyone else or compared (SPEC.md §2).
 */
export const renderVault: WorldScreen = (ctx, root, { worldId }) => {
  const problem = h('div');
  const content = h('div', { class: 'stack' });

  const show = (rewards: Reward[]) => {
    if (rewards.length === 0) {
      content.replaceChildren(h('p', { class: 'message' }, ctx.text('vault.empty')));
      return;
    }
    content.replaceChildren(
      ...groupByWeek(rewards).map((group) =>
        h('section', { class: 'vault-week' },
          h('h2', {}, ctx.text('vault.week', { week: Number(group.weekKey.slice(-2)) })),
          h('ul', { class: 'reward-list' },
            ...group.rewards.map((reward) =>
              h('li', { class: 'reward', 'data-tier': reward.tier }, artElement(ctx.theme, ctx.theme.rewardArt[reward.tier], 'reward-art')),
            ),
          ),
        ),
      ),
    );
  };

  root.append(
    h('h1', {}, ctx.text('vault.title')),
    problem,
    content,
    h('div', { class: 'stack' }, h('button', { onClick: () => ctx.go({ name: 'map' }) }, ctx.text('app.back'))),
  );

  let watchedProfile: ProfileId | null = null;
  let stopRewards = () => {};
  const stopSelf = observeSelf(ctx, worldId, ({ profile }) => {
    if (!profile) {
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    if (profile.id === watchedProfile) return;
    stopRewards();
    watchedProfile = profile.id;
    stopRewards = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.rewards.observeUnopenedRewards(worldId, profile.id, show, onError),
    );
  });
  return () => {
    stopRewards();
    stopSelf();
  };
};
