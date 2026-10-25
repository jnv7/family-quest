# 0015 — The join link, with an optional child profile

- **Status:** Accepted (product owner, 2026-10-24)
- **Date:** 2026-10-24
- **Decided by:** product owner (the invite per child: `docs/plans/0.10-product-brief.md` §2.4); the format and the mechanism are the tech lead's proposal
- **Refines:** ADR 0005 (the themed install flow) and ADR 0014 (a home screen app starts in its world). It replaces neither.

## Context

The join link is a contract: links and QR codes already shared (printed, in chats) depend on its format, and so do older versions of the app that are still installed. Today it is `<app URL>#/join/<worldId>/<themeId>`, and the theme part is optional.

The product owner wants one link per child, which opens the app already on that child's profile on a new phone (brief §2.4).

## Decision

### 1. The format

```text
<app URL>#/join/<worldId>                                 the bare code (typed by hand)
<app URL>#/join/<worldId>/<themeId>                       the general invite (unchanged)
<app URL>#/join/<worldId>/<themeId>/<profileId>           the invite of one child (new)
```

- **Parts are positional and optional from the right.** A profile part needs the theme part before it. The app always writes both, so `joinLink` never writes a profile without a theme.
- **Ids only.** `profileId` is the profile's random document id, letters and digits. Never a name or anything else personal.
- **Forward compatibility.** From now on, the parsers (`parseHash`, `parseJoinInput`) accept and ignore any part after the ones they know, so a later part never makes 0.10 refuse a link. An unknown or malformed profile part is treated as no profile.
- **Older versions.** A version before 0.10.12 that opens the link joins and shows the profile picker, because `parseHash` reads only three parts. Pasting the longer link in such a version is refused, because `parseJoinInput` anchors at the theme part. That is accepted by the product owner: "Atualizar" brings every phone up to date.

### 2. A shortcut, not a login

The profile part only saves the choice in the profile picker, on the device's first entry. It gives no right the general link does not give: anyone with the world code can already join and pick any profile (ADR 0003). That is why no Firestore rule changes, and the world id stays the only access code.

### 3. When the profile part is used

The profile part is used only when all of these hold. Otherwise it is ignored, with no message, and the device does what the general link does.

1. **The device has no active profile in that world.** It is joining now, or it is a member that never chose a profile. A device that already has an active profile in that world goes to the map with its own profile, as today (ADR 0014, point 4). A sibling's link never switches anyone.
2. **The profile exists, is not archived, and is a child profile.** Adult profiles get no personal link (brief §2.4), because a link would hand out admin rights directly (ADR 0003). An adult id in a link falls back to the picker, as an unknown id does.
3. **Choosing it succeeds** (`chooseProfile(…).settled`). If the rules refuse it, for example because the profile was archived in between, the device shows the picker.

### 4. One mechanism for the link and for the carry

There is a single function in `src/ui/joining.ts`:

```ts
/** Joins `worldId` and, if `profileId` qualifies (§3), makes it the active profile.
 *  Resolves to where the app should go next. */
joinAndChoose(ctx, worldId, profileId: ProfileId | null, options: { childOnly: boolean }): Promise<'map' | 'profiles'>
```

Three paths call it:

- **The join screen,** for a link opened or pasted (`childOnly: true`).
- **ADR 0014's carry,** `adoptCarry` (`childOnly: false`). The carry is the same device's own profile, adults included, so ADR 0014 keeps its behaviour, but now through the same code.
- **On iPhone,** with "install first, then open the link" (ADR 0005), there are two ways in:
  - the "Copiar" button of the join screen in Safari copies the **whole** link, profile included;
  - an app added from the link starts at it (ADR 0014, point 5), and the join route carries the profile.

Either way the installed app reaches the join screen with the profile.

To know the profile's kind before choosing it, `WorldStore` gains a one-shot read, like `getMembership`:

```ts
/** The profile, read from the server when online (from the cache otherwise), or null if it does not exist. Members only. */
getProfile(worldId: WorldId, profileId: ProfileId): Promise<Profile | null>;
```

## Consequences

- **No rules change and no deploy.** If testing shows that one is needed, it needs a new ADR and a deploy by the product owner (brief §2.4).
- **The invite per child** lives in Pessoas. The general invite in Pessoas and in `share` is unchanged.
- **Tests:**
  - `routes.test.ts`: each of the three formats, both ways; extra parts ignored; a profile part with other characters is ignored; `joinLink` never writes a profile without a theme;
  - the contract tests of `getProfile` in both adapters;
  - `app.test.ts`: every case of §3, and the iPhone copy and paste.
- **Documentation:** `SPEC.md` §5 and §7, `docs/architecture.md` (routes), `CHANGELOG.md`.

## Amendment (0.10.13, product owner, 2026-10-25): a device entered by a child's link stays on that child

§2 said the profile part "only saves the choice in the profile picker" and the device could still switch profile. For a device that **entered by a child's own link**, that changes, and only for that case:

1. **When it applies.** When `joinAndChoose` chooses the profile of a child's link (`fix: true`: the join screen, a pasted link, a start at a child's link). It does not apply to the general link, to an adult's profile, to a device that already had a profile, nor to ADR 0014's carry (`fix: false`), which is the device's own choice.
2. **What it does.** The device remembers, in its own storage (`WorldMemory`, key `fq.lockedProfile.{worldId}`), the profile it is fixed on. While that profile is the active one and is not archived, the menu has no "Trocar de perfil" and the `profiles` route leads to the map.
3. **How it ends.** Only by clearing the app's data (the product owner's choice). It also falls by itself, so the device is never left without a way out, when the profile is archived or is no longer the active one, and with the world, if the device leaves it.
4. **What it is not.** Not security: nothing is stored in Firestore and no rule changes. Anyone with the world code can still join on another device and choose any profile (ADR 0003). The PIN in "Later" stays the real protection.
5. **Tests:** `app.test.ts` covers the fixed device (no menu item, the picker address leads to the map, it stays fixed after a restart), the cases that must not fix it (the general link, a picked profile, a sibling's link on a device with a profile, the carry), a member with no profile that the link chooses, and the fall when the profile is archived; `worldMemory.test.ts` covers the lock.
