# 0016 — A join link joins in an iPhone's browser tab

- **Status:** Accepted (product owner, 2026-11-01)
- **Date:** 2026-11-01
- **Decided by:** product owner, on the tech lead's proposal, after an adult on an iPhone scanned the general invite's QR code and could not get in from Safari
- **Supersedes:** ADR 0005 decision 5 ("On iOS in a browser tab, a join link does not join"). **Amends:** ADR 0014 (decision 5) and ADR 0015 (the carry never fixes a device).

## Context

ADR 0005 stopped a join link from joining in an iPhone's browser tab. The installed app has storage of its own, so a join made in Safari was lost when the page was added to the home screen, and the order had to be "install first, then open the link". The tab showed the install steps and a button to copy the link instead.

In use, this blocks Safari entirely: scanning the QR code, opening the link and pasting the code all reach the same screen, so nobody can use the app in Safari, and on that screen it looks as if the app is asking for the code again.

ADR 0014 removed the reason for the block. An iPhone tab that is in a world with an active profile keeps its address carrying them (`?join=<world>.<profile>&theme=`), and an app added to the home screen from that tab starts with them. A join made in Safari is no longer lost.

## Decision

1. **A join link joins everywhere,** an iPhone's browser tab included. It shows the profile picker, or, for a child's link, puts the device on that child (ADR 0015), exactly as on Android. The tab no longer shows the install steps or the "Copiar o link" button; "Como instalar" in the menu still has the steps.
2. **The carry says whether the tab was fixed.** A tab fixed on a child by that child's own link writes `fixed=1` next to `join=`. An app added from it starts on the child and stays fixed. Without `fixed=1`, the carry does not fix anything, as before.
3. **"Como instalar" no longer says "install first".** Another person opens the invite link (or scans the QR code), and adds the app to the home screen from that page, once inside the world.

Nothing else changes: the carry is still used only by an installed app with no world, the start at a join link of the world already joined still goes to the map, and no Firestore rule changes.

## Consequences

- **An iPhone that joins in Safari and is then added to the home screen is two members** in Firestore: one for the tab and one for the app, each with its own anonymous `uid`. A membership grants nothing beyond what the code already grants, and nothing is deleted (`SPEC.md` §5).
- **The carry is the one path from Safari to the app.** If an iPhone version ignores the address a home screen app is added from (ADR 0014, not verified on a device), the app starts empty and the person joins again with the link, as before 0.10.11.
- **`fixed=1` is not security.** Anyone can remove it from an address, as anyone can clear the app's data (ADR 0015, amended in 0.10.13).
- **Tests:** an iPhone tab joins with the general link and shows the picker (it fails without this change); a child's link in an iPhone tab fixes the device, writes `fixed=1`, and an app started with that carry is fixed; `parseCarry` and `carrySearch` read, write and drop `fixed`.
