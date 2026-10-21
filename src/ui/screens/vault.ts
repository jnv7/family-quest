import { weekRange, weekRelation } from '../../core/calendar';
import { drawSlot } from '../../core/draw';
import type { Collectible, Profile, ProfileId, Reward, Ruleset, TaskId, WeekKey } from '../../core/model';
import { collectibleState } from '../../core/party';
import { canOpen } from '../../core/rewards';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { moveOldPendingToReserve } from '../reserve';
import { createPartyControls, createRenamer, entryOf as entryOfTheme } from '../party';
import { observeSelf } from '../self';
import { screenBar } from '../bar';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

/** Groups rewards by the week they were earned in, oldest week first; each group keeps its order. */
export function groupByWeek(rewards: readonly Reward[]): Array<{ weekKey: WeekKey; rewards: Reward[] }> {
  const groups = new Map<WeekKey, Reward[]>();
  for (const reward of rewards) groups.set(reward.weekKey, [...(groups.get(reward.weekKey) ?? []), reward]);
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([weekKey, list]) => ({ weekKey, rewards: list }));
}

/**
 * The vault: the active profile's own unopened rewards (SPEC.md §7.6), shown with the art of
 * their tier, which a person opens from the opening day on (SPEC.md §6). A collectible that comes
 * out of a reward is pending: it can join the party at once, or stay in "recent" for a while
 * (SPEC.md §6). Nothing here is counted for anyone else or compared (SPEC.md §2), and nothing can
 * be deleted.
 *
 * The reveal is drawn from the collectibles the store reports, not from what this device drew:
 * if another device opened the same reward first, this one shows that device's collectible.
 */
export const renderVault: WorldScreen = (ctx, root, { worldId }) => {
  const problem = h('div');
  const reveals = h('div', { class: 'stack' });
  const recent = h('section', { class: 'stack', hidden: true });
  const content = h('div', { class: 'stack' });

  let ruleset: Ruleset | null = null;
  let profile: Profile | null = null;
  let rewards: Reward[] | null = null;
  let collectibles: Collectible[] | null = null;
  /** Rewards this person opened on this screen, in the order they were opened, until dismissed. */
  let revealed: TaskId[] = [];
  let tidied = false;

  const byId = () => new Map((collectibles ?? []).map((collectible) => [collectible.id, collectible]));

  const open = (reward: Reward) => {
    const slot = drawSlot(ctx.theme.catalog.slots, reward.tier, ctx.randomInt);
    revealed = [...revealed, reward.id];
    ctx.settle(ctx.store.rewards.openReward(worldId, reward.id, { slot }).settled);
    draw();
  };

  const controls = createPartyControls(ctx, worldId, () =>
    profile && ruleset && collectibles ? { profile, ruleset, owned: collectibles } : null,
  );
  const choices = (collectible: Collectible) => controls.choices(collectible);
  const renamer = createRenamer(ctx, worldId, () => draw());
  const entryOf = (collectible: Collectible) => entryOfTheme(ctx, collectible);

  const revealCard = (collectible: Collectible) => {
    const entry = entryOf(collectible);
    if (!entry) return null;
    const pending = profile !== null && collectibleState(collectible, profile.partyIds) === 'pending';
    return h('div', { class: 'reveal', role: 'status' },
      artElement(ctx.theme, entry.art, 'reveal-art'),
      h('p', {}, ctx.text('vault.revealed')),
      renamer.tag(collectible, true, ctx.text('vault.giveName')),
      h('p', { class: 'reveal-tier' }, ctx.theme.tiers[collectible.tier]),
      choices(collectible),
      h('button', { onClick: () => ((revealed = revealed.filter((id) => id !== collectible.id)), draw()) }, ctx.text(pending ? 'party.later' : 'vault.close')),
    );
  };

  const recentCard = (collectible: Collectible) => {
    const entry = entryOf(collectible);
    if (!entry) return null;
    return h('div', { class: 'recent-card' },
      artElement(ctx.theme, entry.art, 'recent-art'),
      renamer.tag(collectible, true),
      h('small', {}, ctx.theme.tiers[collectible.tier]),
      choices(collectible),
    );
  };

  const rewardItem = (reward: Reward, rules: Ruleset) => {
    const art = artElement(ctx.theme, ctx.theme.rewardArt[reward.tier], 'reward-art');
    if (canOpen(reward, ctx.clock(), rules)) {
      return h('li', { class: 'reward', 'data-tier': reward.tier }, art, h('button', { class: 'primary', onClick: () => open(reward) }, ctx.text('vault.open')));
    }
    return h('li', { class: 'reward waiting', 'data-tier': reward.tier }, art, h('small', {}, ctx.text('vault.notYet', { weekday: ctx.text(`weekday.${WEEKDAYS[rules.openingDay - 1]}`) })));
  };

  /** The days of a week as "19–25 out.", with the month names from the locale file. */
  const rangeLabel = (week: WeekKey): string => {
    const { start, end } = weekRange(week);
    const part = (date: string) => ({ day: Number(date.slice(8, 10)), month: ctx.text(`month.${MONTHS[Number(date.slice(5, 7)) - 1]}`) });
    const [from, to] = [part(start), part(end)];
    return from.month === to.month ? `${from.day}–${to.day} ${to.month}` : `${from.day} ${from.month}–${to.day} ${to.month}`;
  };

  /** "Esta semana", "Semana passada", or the days of the week; never an ISO week number. */
  const weekHeading = (week: WeekKey): string => {
    const relation = ruleset ? weekRelation(week, ctx.clock(), ruleset.timezone) : 'other';
    return relation === 'this' ? ctx.text('vault.thisWeek') : relation === 'last' ? ctx.text('vault.lastWeek') : rangeLabel(week);
  };

  function draw(): void {
    const owned = byId();
    reveals.replaceChildren(
      ...revealed.flatMap((id) => {
        const collectible = owned.get(id);
        const card = collectible ? revealCard(collectible) : null;
        return card ? [card] : [];
      }),
    );

    // Pending collectibles not already on show as a reveal, newest first.
    const pending = profile
      ? (collectibles ?? []).filter((c) => collectibleState(c, profile!.partyIds) === 'pending' && !revealed.includes(c.id))
      : [];
    recent.hidden = pending.length === 0;
    recent.replaceChildren(
      ...(pending.length === 0 ? [] : [h('h2', {}, ctx.text('vault.recent')), ...pending.flatMap((c) => recentCard(c) ?? [])]),
    );

    if (rewards === null || ruleset === null) return;
    const rules = ruleset;
    const shown = rewards.filter((reward) => !revealed.includes(reward.id) || !owned.has(reward.id));
    if (shown.length === 0) {
      const somethingElse = revealed.length > 0 || pending.length > 0;
      content.replaceChildren(somethingElse ? '' : h('p', { class: 'message' }, ctx.text('vault.empty')));
      return;
    }
    const openable = shown.filter((reward) => canOpen(reward, ctx.clock(), rules));
    content.replaceChildren(
      ...(openable.length >= 2
        ? [h('button', { class: 'primary', onClick: () => openable.forEach(open) }, ctx.text('vault.openAll'))]
        : []),
      ...groupByWeek(shown).map((group) =>
        h('section', { class: 'vault-week' },
          h('h2', {}, weekHeading(group.weekKey)),
          h('ul', { class: 'reward-list' }, ...group.rewards.map((reward) => rewardItem(reward, rules))),
        ),
      ),
    );
  }

  /** Opening the vault tidies the reserve once the lists have arrived (SPEC.md §6). */
  function tidy(): void {
    if (tidied || !profile || !ruleset || collectibles === null) return;
    tidied = true;
    moveOldPendingToReserve(ctx, worldId, profile, collectibles, ruleset);
  }

  root.append(
    screenBar(ctx, { title: ctx.text('vault.title'), back: { name: 'map' } }),
    problem,
    reveals,
    recent,
    content,
  );

  const stopWorld = observeWithRetry(ctx, problem, (onError) =>
    ctx.store.worlds.observeWorld(worldId, (value) => ((ruleset = value.ruleset), tidy(), draw()), onError),
  );
  let watchedProfile: ProfileId | null = null;
  let stopData = () => {};
  const stopSelf = observeSelf(ctx, worldId, ({ profile: active }) => {
    if (!active) {
      ctx.go({ name: 'profiles' }, { replace: true });
      return;
    }
    profile = active;
    if (active.id === watchedProfile) {
      draw();
      return;
    }
    stopData();
    watchedProfile = active.id;
    rewards = null;
    collectibles = null;
    revealed = [];
    tidied = false;
    const stopRewards = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.rewards.observeUnopenedRewards(worldId, active.id, (value) => ((rewards = value), draw()), onError),
    );
    const stopCollectibles = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.collectibles.observeCollectibles(worldId, active.id, (value) => ((collectibles = value), tidy(), draw()), onError),
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
