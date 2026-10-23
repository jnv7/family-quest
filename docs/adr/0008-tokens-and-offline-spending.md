# 0008 — Tokens, and spending them offline without double spending

- **Status:** Proposed (tech lead, 2026-10-23), awaiting the product owner
- **Date:** 2026-10-23
- **Decided by:** product owner (the token model: `docs/plans/0.9-product-brief.md`); the data and rules design is the tech lead's proposal
- **Supersedes:** "Reward pieces" (`SPEC.md` §6, decision D5 in `docs/plans/0.8.md`), which was never built
- **Refines:** ADR 0002 (write semantics), `SPEC.md` §4, §5, §6 and §10

## Context

From 0.9 a completed task earns **tokens** by its `level`, and a person spends them in the `vault` to open a reward of the tier they choose (brief §2 and §3). Three things must hold, offline included (brief §9):

1. a person can never spend more tokens than they have;
2. two devices of the same profile, both offline, can never spend the same tokens, and their balances agree once synced;
3. a device can never spend another profile's tokens.

The constraints are the usual ones:

- no transactions, because they do not run offline (`SPEC.md` §10);
- no Cloud Functions (Spark plan);
- rules cannot count or sum documents;
- nothing earned is deleted;
- a `done` task never reopens.

The brief suggested tokens as single-use documents with deterministic ids. That works, but opening a `high` reward (25 tokens by default) would mean one batch of 25 token updates plus the reward and the collectible. Each update needs its own rule evaluation, which runs into the rules' limit on document reads per batch. It also adds up to 4 documents per completed task. The design below gives the same guarantees with one document write per completion and one per opening.

## Decision

### 1. A balance counter on the profile, changed only by `increment()`

- `profiles/{profileId}` gains three optional fields:
  - `tokens`: an integer, the balance (absent means 0);
  - `tokensFrom`: the id of the task that last added tokens;
  - `tokensFor`: the id of the reward that last spent them.
- Clients never write `tokens` as a value. They write only `increment(+n)` when completing a task and `increment(-price)` when buying a reward, always in the same batch as the document that justifies the change.
- Firestore applies an increment to the value **on the server** when the write arrives, and the rules see the result (`request.resource.data`). So two offline devices that each add or subtract compose correctly, whatever each one had in its cache.

### 2. The rules check every change against its reason

On the profile, the owner may change only `tokens` plus one of the two reason fields:

- **Earning** (`tokens`, `tokensFrom`):
  - the task named in `tokensFrom` moves from `open` to `done` in the same batch;
  - it belongs to this profile;
  - the new balance is the old one plus the task's `tokens`.
- **Spending** (`tokens`, `tokensFor`):
  - the reward named in `tokensFor` did not exist before the batch and exists after it;
  - it belongs to this profile;
  - the new balance is the old one minus the reward's `price`, and it is **0 or more**.

The checks also run the other way:

- a task completed the new way (with `tokens`) is accepted only if the same batch adds those tokens to its profile;
- a bought reward (with `price`) is accepted only if the same batch takes the price from its profile and creates its collectible.

**Why this prevents double spending.** Take two devices of one profile, both offline, both with a balance of 25 in their caches, and both buying a reward for 25:

- the first batch to reach the server leaves 0;
- the second arrives as `increment(-25)` on 0, which would give -25, so the rules refuse the whole batch: no reward, no collectible, and no change to the balance;
- both devices then read 0 from the server.

The same holds for any number of devices and any mix of earning and spending: the server applies each batch to the real balance, and only accepts it if the result is valid.

### 3. What is recorded

Nothing is deleted, and every token has a written reason:

- each earning is a `done` task with its `tokens` (fixed at completion);
- each spending is a reward with its `price`.

The balance always equals the sum of `tokens` over the profile's done tasks minus the sum of `price` over its bought rewards. The counter is the form of that sum that the rules can check.

### 4. Bought rewards

- A reward bought in the `vault` has a random id (it no longer comes from a task) and a `price`.
- It is created already opened (`openedAt` set), in the same batch that spends the tokens and creates its collectible with the same id.
- The rules accept it only in that batch.
- A reward from before 0.9 has no `price`, keeps its task's id, and still opens for free, once (unchanged rules).

### 5. Trust: amounts are checked by range, not against the `ruleset`

The rules check that:

- a task's `tokens` is a whole number from 1 to `LIMITS.tokensPerLevelMax` (10);
- a `price` is a whole number from 1 to `LIMITS.tokenPriceMax` (200).

They do **not** check that the values equal the world's current `ruleset`:

- **Local-first.** A device offline when an adult changes the values would have its completions refused at sync. Its tasks would then return to open, which breaks "a done task never reopens" (`CLAUDE.md` rule 6).
- **Precedent.** The rules already trust the client for the reward `tier` and the collectible `slot` (`SPEC.md` §5), under the family trust model of ADR 0003.

The rules guarantee what matters between devices and people: no balance below zero, no double spending, and nobody touching another profile's tokens. The exact amounts come from the domain (`tokensFor`, `priceOf`) and are tested there. For the same reason, the `low` level of a child's self-created task is enforced in the client, like the daily limit.

### 6. Compatibility with 0.8 clients

The rules keep accepting the 0.8 way of completing a task: no `tokens`, with a reward created from the task. Writes that a device queued offline while on 0.8 are therefore not refused after the deploy, and a done task never reopens. A reward created that way is a "reward from before 0.9": it opens for free.

The legacy path also checks that the task has no `tokens`, so one completion can never give both tokens and a reward. It is removed in a later release, once no 0.8 client is left (proposed for the radar).

### 7. Order of deployment

1. The new rules (delivery 0.9.1) accept both the 0.8 and the 0.9 shapes. The product owner publishes them (`firebase deploy --only firestore:rules`) as soon as CI is green.
2. Only then is code that writes tokens pushed (0.9.5), because every push to `release/0.9` is deployed to Pages.

## Consequences

- **Rare reveal reversal.** In the double-spend case above, the second device shows the collectible at once (local-first) and loses it when the server refuses the batch. The `vault` then says, in neutral words, that the tokens had already been spent on another device. Nothing earned is lost: those tokens bought the first device's reward. This happens only for two devices of one profile, both offline, both buying.
- **Visibility.** Like the rest of a profile, the balance is readable by members of the world. The interface shows it only to its owner, only in the `vault` (the brief's exception to "no counts"). The `Profile` domain type does not carry it: only `observeBalance` returns it, so no other screen can show it by accident.
- **`partySize` becomes editable** (brief §4). The profile rule that compared `partyIds` with `partySize` on every update would then refuse any write to a profile whose `party` is above a lowered size, including earning tokens. The rule changes: the size is checked only when `partyIds` changes, and a `party` above the size may only lose members (`newDoc().partyIds.hasOnly(resource.data.partyIds)`).
- **Tests.** `firebase/tests/firestore.rules.test.ts` covers earning, spending, the legacy path and the negative cases (brief §9). The Firestore adapter's emulator test plays the two-offline-devices case with `disableNetwork`, and the memory adapter plays it in the contract tests.
- **Documentation.** `SPEC.md` §1–§8, §10, §11 and §14, `CLAUDE.md` rule 6, `docs/architecture.md` and `CHANGELOG.md`.
- **Not done.** Tokens are never given by hand, transferred between people, or taken away. An admin cannot edit a balance. Three identical collectibles making a "super" one is on the radar (brief §7).
