# 0010 — Anyone can take a collectible from the reserve

- **Status:** Proposed (waiting for the product owner)
- **Date:** 2026-10-23
- **Decided by:** product owner (the behaviour, 2026-10-23: "anyone can take any collectible from the reserve, even if it came from, and was even named by, someone else"). The data and rules design below is the developer's proposal.
- **Refines:** `SPEC.md` §4 (collectible), §5, §6 (party and reserve) and §7 (showcase). Replaces "a person can bring back only their own".

## Context

Until now a collectible belongs to the profile that opened it (`profileId`), and only that profile may change its `reserveAt` or add it to its party. The reserve is shown to everyone in the `showcase`, but only as something to look at. The product owner wants the reserve to be common: a collectible sent there can be taken by anyone, into their own party, and keeps the name it was given.

## Decision

1. **Taking changes the owner.** A person who takes a collectible from the reserve becomes its owner: its `profileId` becomes theirs, `reserveAt` becomes `null`, and its id joins their `partyIds`. Its `nickname` stays. From then on it is theirs in every way (they can rename it, and send it back to the reserve). The previous owner no longer has it.
2. **One batch.** `collectibles.takeFromReserve(worldId, collectibleId, change)` is a single `writeBatch`:
   - the collectible: `profileId := active profile`, `reserveAt := null`;
   - the active profile: the new `partyIds`;
   - if the party was full, the collectible that leaves it goes to the reserve (`reserveAt := now`), exactly as `arrangeParty` does.

   The party rules do not change: the party must fit `partySize`, and the interface asks who leaves when it is full. `checkPartyChange` is reused, with the taken collectible counted as the active profile's own and as coming from the reserve.
3. **The rules.** A new branch on collectible `update`, besides the owner's and the admin's:
   - the collectible is in the reserve now (`resource.data.reserveAt != null`);
   - only `profileId` and `reserveAt` change, `profileId` becomes the active profile's, and `reserveAt` becomes `null`;
   - in the same batch the active profile's `partyIds` contains the collectible's id (`getAfter`), so a collectible is never taken without being put in a party.

   Nothing else about the collectible changes: `slot`, `tier`, `nickname` and `obtainedAt` are fixed.
4. **Two people at once.** The second batch finds `reserveAt` already `null`, so the rules refuse it as a whole. The second person's screen shows the collectible for a moment (local-first) and then loses it, with a short neutral line ("Alguém foi mais rápido.", themed nouns from the glossary). Nobody loses anything they had.
5. **What stays the same.**
   - The reserve still never shows an owner, a date or a count, and the store still does not hand over `profileId` for the `showcase`.
   - Nothing is deleted. A collectible that left its first owner was sent to the reserve by that owner. It is not taken from their party.
   - The `reward` that produced it keeps its `profileId` (a record of who earned it); it is no longer related to who owns the collectible.
   - Beyond the newest `showcaseSize` of the reserve, a collectible stays stored and out of reach, as today.
6. **Not done.** Taking a collectible out of someone's party or pending list, trading, or asking permission. Only what is in the reserve can be taken.

## Consequences

- **Rules.** `firestore.rules` changes the collectible update rule and adds tests: a taking works; ✗ without the party change; ✗ of a collectible not in the reserve; ✗ of one in someone's party or pending; ✗ with another `profileId`; ✗ changing other fields; two takings in a row (the second is refused). The product owner must publish them (`firebase deploy --only firestore:rules`) before devices can take.
- **The trust limit** in `SPEC.md` §5 and `docs/architecture.md` §10 stays the same: the rules cannot check that every id in `partyIds` is the profile's own collectible.
- **Compatibility.** A 0.9 device that has not updated simply cannot take. Its own party and reserve moves are unaffected.
- **Interface.** In the `showcase`, every item opened in detail offers the same choices as an own item (join the party, or who leaves). The detail never says whose it was.
- **Tests.** The contract suite (both adapters) gets taking, a full party, the race of two profiles, and a nickname that survives. The `showcase` screen test replaces "and nobody else" with "anyone".
- **Documentation.** `SPEC.md` §4, §5, §6 and §7, `docs/architecture.md`, `CHANGELOG.md`, and the ADR index.
