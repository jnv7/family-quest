# 0011 — Restarting the universe

- **Status:** Proposed (waiting for the product owner)
- **Date:** 2026-10-23
- **Decided by:** product owner (the feature, 2026-10-23: a button at the end of management, in another colour, that restarts the universe: it keeps the users and removes the counters, chests, tokens, purchase history, collectibles, tasks and so on). The design below is the developer's proposal.
- **Deviates from:** `CLAUDE.md` rule 5 ("Nothing earned is deleted"), `CONTRIBUTING.md` ("no document type is deletable") and the principle in `firestore.rules` and `SPEC.md` §5. **This is flagged on purpose** (`GOVERNANCE.md` §1): the feature cannot be built without breaking it, or without hiding data instead of removing it.

## Context

Everything the game stores has so far been permanent. The product owner now wants an admin to start over, for example after a trial week: the family keeps its profiles and devices, and everything that was earned or created goes away.

## Options

### A. Delete the documents (recommended)

An admin deletes the world's `tasks`, `rewards` and `collectibles`, and clears each profile's counters. The rules gain a narrow exception to "nothing is deleted".

- **Rules.**
  - `delete` is allowed on `tasks`, `rewards` and `collectibles` for an admin only; every other collection stays undeletable (`worlds`, `members`, `profiles`, `taskDefs`).
  - A profile update by an admin is allowed when it removes `tokens`, `tokensFrom` and `tokensFor` and empties `partyIds`, and changes nothing else.
- **Client.**
  - `worlds.restartUniverse(worldId)` reads the three collections from the server, so it needs a connection and says so when there is none.
  - It deletes in batches of up to 500 and then clears the profiles.
  - Each batch is atomic; the whole is not. If it stops half way, running it again finishes the job, because it only deletes what is left.
- **Other devices.** They see the documents go through their observers. A device that was offline with a queued completion has it refused at sync, which is the right result. Recurring tasks for today are generated again at the next open, so the new universe starts with today's tasks.
- **Cost.** Simple, and the data is really gone, which is what "restart" suggests. It breaks the rule the product owner wrote, for an action that only an admin can take, behind a confirmation. It cannot be undone.

### B. Hide what came before

The world records a `restartedAt`; every screen ignores whatever was created before it, and the profiles' counters are cleared. Nothing is deleted, as with the collectibles that "left for another island".

- **Cost.** Much heavier and fragile.
  - Every query and observer must filter by date; the `showcase` query cannot do it on the server without a new composite index, which the product owner would have to publish.
  - A recurring task keeps its deterministic id, so today's task cannot be created again until tomorrow.
  - The hidden data stays in the free quota forever.
- **Benefit.** The principle holds, and a mistaken restart could be undone by an admin in principle.

### C. A new world with the same profiles

Create a new world, copy the profiles, and have every device join it. Rejected: the world id is the access code, so every phone would have to join again.

## Decision proposed

Option A, with these limits:

1. **What is removed.**
   - All tasks (open, done and retired), all rewards (including the bought ones, which are the purchase history) and all collectibles.
   - Every profile's token balance and its reason fields, and its party.
   - **What stays.** The profiles (name, kind, symbol, archived or not), the devices and their active profiles, the task definitions (the recurring tasks, which are the family's setup rather than something earned), the world and its `ruleset` (token rules, sizes).
2. **Who and how.** An admin only. The button is the last thing in management, in a warning colour. It asks first, naming what will go and saying that it cannot be undone, and then asks the person to type a word before the final button is enabled.
3. **After it.** Everyone starts at zero: no tokens, no party, no showcase, no tasks except what the recurring definitions generate.
4. **Documentation.** `CLAUDE.md` rule 5, `CONTRIBUTING.md`, `SPEC.md` §2 and §5 and `docs/architecture.md` are updated to say that only a restart by an admin deletes, and nothing else ever does.

## Questions for the product owner

1. Option A (delete, simple, irreversible) or B (hide, heavier)?
2. Do the task definitions (the recurring tasks) stay, as proposed, or go too?
3. Is "type a word" the right amount of care, or should it be enough to tap twice?
