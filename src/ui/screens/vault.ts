import { drawSlot } from '../../core/draw';
import type { Collectible, Profile, ProfileId, Reward, Ruleset, TaskId, WeekKey } from '../../core/model';
import { collectibleState } from '../../core/party';
import { canOpen } from '../../core/rewards';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { moveOldPendingToReserve } from '../reserve';
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

  const arrange = (partyIds: TaskId[], toReserve: TaskId[]) => {
    if (!profile) return;
    ctx.settle(ctx.store.collectibles.arrangeParty(worldId, profile.id, { partyIds, toReserve, fromReserve: [] }).settled);
  };

  const entryOf = (collectible: Collectible) => {
    const entry = ctx.theme.catalog.slots.find((slot) => slot.slot === collectible.slot);
    if (!entry) console.warn(`The theme has no collectible "${collectible.slot}"`);
    return entry ?? null;
  };

  /** What can be done with a pending collectible: join the party, or choose who leaves it. */
  const choices = (collectible: Collectible): HTMLElement | null => {
    if (!profile || !ruleset || collectibleState(collectible, profile.partyIds) !== 'pending') return null;
    const party = profile.partyIds;
    if (party.length < ruleset.partySize) {
      return h('div', { class: 'choices' },
        h('button', { class: 'primary', onClick: () => arrange([...party, collectible.id], []) }, ctx.text('party.join')),
      );
    }
    const owned = byId();
    return h('div', { class: 'choices' },
      h('p', {}, ctx.text('party.full')),
      ...party.flatMap((memberId) => {
        const member = owned.get(memberId);
        const entry = member ? entryOf(member) : null;
        if (!member || !entry) return [];
        return [
          h('button', {
            class: 'swap',
            onClick: () => arrange(party.map((id) => (id === memberId ? collectible.id : id)), [memberId]),
          }, artElement(ctx.theme, entry.art, 'swap-art'), ctx.text('party.swap', { name: entry.name })),
        ];
      }),
    );
  };

  const revealCard = (collectible: Collectible) => {
    const entry = entryOf(collectible);
    if (!entry) return null;
    const pending = profile !== null && collectibleState(collectible, profile.partyIds) === 'pending';
    return h('div', { class: 'reveal', role: 'status' },
      artElement(ctx.theme, entry.art, 'reveal-art'),
      h('p', {}, ctx.text('vault.revealed')),
      h('p', { class: 'reveal-name' }, entry.name),
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
      h('p', { class: 'reveal-name' }, entry.name),
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
    content.replaceChildren(
      ...groupByWeek(shown).map((group) =>
        h('section', { class: 'vault-week' },
          h('h2', {}, ctx.text('vault.week', { week: Number(group.weekKey.slice(-2)) })),
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
    h('h1', {}, ctx.text('vault.title')),
    problem,
    reveals,
    recent,
    content,
    h('div', { class: 'stack' }, h('button', { onClick: () => ctx.go({ name: 'map' }) }, ctx.text('app.back'))),
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
