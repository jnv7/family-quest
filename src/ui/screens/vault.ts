import { drawSlot } from '../../core/draw';
import { TIERS, type Collectible, type Profile, type ProfileId, type Reward, type Ruleset, type TaskId, type Tier } from '../../core/model';
import { collectibleState } from '../../core/party';
import { canAfford, priceOf } from '../../core/tokens';
import { DataStoreError } from '../../data/DataStore';
import type { WorldScreen } from '../context';
import { artElement } from '../art';
import { h } from '../dom';
import { observeWithRetry } from '../observe';
import { moveOldPendingToReserve } from '../reserve';
import { createPartyControls, createRenamer, entryOf as entryOfTheme } from '../party';
import { observeSelf } from '../self';
import { screenBar } from '../bar';

/**
 * The vault (SPEC.md §7.6). From top to bottom: the balance of the active profile, which is the one place
 * a count is shown (SPEC.md §2); the rewards found before 0.9, which open for free; the depth, where the
 * three tiers wait for tokens; what has just been revealed; and the recent collectibles. Choosing an
 * affordable tier and tapping "open for N" buys a reward, already opened (ADR 0008). A collectible is
 * pending until its owner decides: join the party, send it to the reserve, or leave it for later. Nothing
 * here is compared with anyone else, and nothing can be deleted.
 *
 * The reveal is drawn from the collectibles the store reports, not from what this device drew: if the
 * server refuses a purchase (the tokens were spent on another device), the reveal goes away and a line says why.
 */
export const renderVault: WorldScreen = (ctx, root, { worldId }) => {
  const problem = h('div');
  const balanceBox = h('div', { class: 'balance', hidden: true });
  const found = h('section', { class: 'stack', hidden: true });
  const depth = h('div', { class: 'stack' });
  const reveals = h('div', { class: 'stack' });
  const recent = h('section', { class: 'stack', hidden: true });

  let ruleset: Ruleset | null = null;
  let profile: Profile | null = null;
  let rewards: Reward[] | null = null;
  let collectibles: Collectible[] | null = null;
  let balance: number | null = null;
  /** Rewards this person opened or bought on this screen, in order, until dismissed. */
  let revealed: TaskId[] = [];
  /** The tier chosen in the depth, waiting for "open for N". */
  let selected: Tier | null = null;
  let spentElsewhere = false;
  let tidied = false;

  const byId = () => new Map((collectibles ?? []).map((collectible) => [collectible.id, collectible]));
  const tokenIcon = () => artElement(ctx.theme, ctx.theme.tokenArt, 'token-art');

  /** A reward from before 0.9: opens for free, on any day. */
  const open = (reward: Reward) => {
    const slot = drawSlot(ctx.theme.catalog.slots, reward.tier, ctx.randomInt);
    revealed = [...revealed, reward.id];
    ctx.settle(ctx.store.rewards.openReward(worldId, reward.id, { slot }).settled);
    draw();
  };

  const buy = (tier: Tier) => {
    if (!ruleset || balance === null || !canAfford(balance, tier, ruleset)) return;
    const slot = drawSlot(ctx.theme.catalog.slots, tier, ctx.randomInt);
    const purchase = ctx.store.tokens.buyReward(worldId, { tier, price: priceOf(tier, ruleset), slot });
    const { rewardId } = purchase.result;
    selected = null;
    spentElsewhere = false;
    revealed = [...revealed, rewardId];
    purchase.settled.catch((error: unknown) => {
      // Another device of this profile spent the same tokens first: the server refused this one (ADR 0008).
      if (error instanceof DataStoreError && error.code === 'permission-denied') {
        revealed = revealed.filter((id) => id !== rewardId);
        spentElsewhere = true;
        draw();
        return;
      }
      ctx.settle(Promise.reject(error));
    });
    draw();
  };

  const controls = createPartyControls(ctx, worldId, () =>
    profile && ruleset && collectibles ? { profile, ruleset, owned: collectibles } : null,
  );
  const choices = (collectible: Collectible) => controls.choices(collectible);
  const renamer = createRenamer(ctx, worldId, () => draw());
  const entryOf = (collectible: Collectible) => entryOfTheme(ctx, collectible);

  const dismiss = (id: TaskId) => {
    revealed = revealed.filter((revealedId) => revealedId !== id);
    draw();
  };

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
      pending &&
        h('button', {
          onClick: () => {
            controls.toReserve(collectible);
            dismiss(collectible.id);
          },
        }, ctx.text('vault.letGo')),
      h('button', { onClick: () => dismiss(collectible.id) }, ctx.text(pending ? 'party.later' : 'vault.close')),
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

  const foundItem = (reward: Reward) =>
    h('li', { class: 'reward', 'data-tier': reward.tier },
      artElement(ctx.theme, ctx.theme.rewardArt[reward.tier], 'reward-art'),
      h('button', { class: 'primary', onClick: () => open(reward) }, ctx.text('vault.open')),
    );

  /** One tier of the depth: its art, the line that invites going deeper, and its price. */
  const tierButton = (tier: Tier, rules: Ruleset, placement: Record<string, string> | null) => {
    const affordable = balance !== null && canAfford(balance, tier, rules);
    return h('button', {
      type: 'button',
      class: `tier${selected === tier ? ' selected' : ''}${affordable ? '' : ' dimmed'}${placement ? ' placed' : ''}`,
      'data-tier': tier,
      'aria-disabled': affordable ? 'false' : 'true',
      'aria-pressed': selected === tier ? 'true' : 'false',
      style: placement ? `left:${placement.left};top:${placement.top};width:${placement.width};height:${placement.height}` : undefined,
      onClick: () => {
        if (!affordable) return;
        selected = selected === tier ? null : tier;
        spentElsewhere = false;
        draw();
      },
    },
      artElement(ctx.theme, ctx.theme.rewardArt[tier], 'reward-art'),
      h('span', { class: 'invite' }, ctx.theme.vault.invite[tier]),
      h('span', { class: 'price' }, tokenIcon(), String(priceOf(tier, rules))),
      !affordable && h('span', { class: 'sr-only' }, ctx.text('vault.cannotAfford')),
    );
  };

  const drawDepth = (rules: Ruleset) => {
    const { background, aspectRatio, spots } = ctx.theme.vault;
    const placed = background !== undefined && aspectRatio !== undefined && spots !== undefined;
    const tiers = TIERS.map((tier) =>
      tierButton(
        tier,
        rules,
        placed ? { left: `${spots[tier].x}%`, top: `${spots[tier].y}%`, width: `${spots[tier].width}%`, height: `${spots[tier].height}%` } : null,
      ),
    );
    const chosen = selected;
    depth.replaceChildren(
      ...([
      placed
        ? h('div', { class: 'depth placed', style: `aspect-ratio:${aspectRatio}` }, artElement(ctx.theme, background, 'depth-bg'), ...tiers)
        : h('div', { class: 'depth stacked' }, ...tiers),
      spentElsewhere && h('p', { class: 'message', role: 'alert' }, ctx.text('vault.spentElsewhere')),
      chosen !== null &&
        h('button', { class: 'primary open-for', type: 'button', onClick: () => buy(chosen) },
          ctx.text('vault.openFor', { count: priceOf(chosen, rules) }),
          tokenIcon(),
        ),
      ] as Array<HTMLElement | false>).filter((node): node is HTMLElement => node !== false),
    );
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

    // The balance is shown to its owner only, here and nowhere else.
    balanceBox.hidden = balance === null;
    if (balance !== null) {
      const label = ctx.text(balance === 1 ? 'vault.balanceOne' : 'vault.balance', { count: balance });
      balanceBox.replaceChildren(h('span', { role: 'img', 'aria-label': label }, tokenIcon(), h('strong', {}, String(balance))));
    }

    const unopened = (rewards ?? []).filter((reward) => !revealed.includes(reward.id) || !owned.has(reward.id));
    found.hidden = unopened.length === 0;
    found.replaceChildren(
      ...(unopened.length === 0
        ? []
        : [
            h('h2', {}, ctx.text('vault.found')),
            ...(unopened.length >= 2 ? [h('button', { class: 'primary', onClick: () => unopened.forEach(open) }, ctx.text('vault.openAll'))] : []),
            h('ul', { class: 'reward-list' }, ...unopened.map(foundItem)),
          ]),
    );

    if (ruleset === null) return;
    if (selected !== null && (balance === null || !canAfford(balance, selected, ruleset))) selected = null;
    drawDepth(ruleset);
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
    balanceBox,
    found,
    depth,
    reveals,
    recent,
  );

  // Tapping anywhere but a tier or "open for N" cancels the choice.
  const onTap = (event: Event) => {
    if (selected === null || (event.target as Element | null)?.closest('.tier, .open-for')) return;
    selected = null;
    draw();
  };
  root.addEventListener('click', onTap);

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
    balance = null;
    revealed = [];
    selected = null;
    tidied = false;
    const stopRewards = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.rewards.observeUnopenedRewards(worldId, active.id, (value) => ((rewards = value), draw()), onError),
    );
    const stopCollectibles = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.collectibles.observeCollectibles(worldId, active.id, (value) => ((collectibles = value), tidy(), draw()), onError),
    );
    const stopBalance = observeWithRetry(ctx, problem, (onError) =>
      ctx.store.tokens.observeBalance(worldId, active.id, (value) => ((balance = value), draw()), onError),
    );
    stopData = () => {
      stopRewards();
      stopCollectibles();
      stopBalance();
    };
  });
  return () => {
    root.removeEventListener('click', onTap);
    stopData();
    stopWorld();
    stopSelf();
  };
};
