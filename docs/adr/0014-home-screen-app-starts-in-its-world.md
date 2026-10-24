# 0014 — A home screen app on iPhone starts in its world

- **Status:** Accepted (product owner, 2026-10-24)
- **Date:** 2026-10-24
- **Decided by:** the developer's proposal, for the request: someone who is already in a world in Safari on an iPhone adds the page to the home screen, and the app should open already in that world, with no new join and no new choice of profile
- **Refines:** ADR 0005 (the themed install flow)

## Context

On an iPhone, an app on the home screen has storage of its own, apart from Safari's: its sign-in, its remembered world and its theme are not shared. So an app added from a Safari tab in which the world is open starts empty, and the person has to join again and choose a profile (ADR 0005 says the same of a join made in Safari).

The only thing that crosses from Safari to the new app is the **address of the page when it was added**, and only if the page has no web app manifest: with a manifest, the app starts at the manifest's `start_url`, which is the same for everybody (`?theme=<id>`). The legacy `apple-mobile-web-app-capable` meta, which the page already has, is enough for iOS to make it a standalone app.

## Decision

1. **On iOS, the page has no manifest link.** The inline script of ADR 0013 and `applyThemeToPage` leave it out on an iPhone or iPad. The name, the icon and the colour come from the `apple-mobile-web-app-title`, `apple-touch-icon` and `theme-color` tags, as before. Other platforms keep the manifest, which they need to install.
2. **A browser tab on iOS keeps its address carrying where it is.** While the device is in a world with an active profile, the page address has `?join=<worldId>.<profileId>` and `?theme=<themeId>` (`history.replaceState`, so nothing reloads and no history is added). Without a world or a profile, the carry is taken out. Only the iOS browser tab does this.
3. **The installed app reads the carry once.** A device with no world, outside an iOS browser tab, that starts with a carry joins the world (`joinWorld`), takes the profile (`chooseProfile`), remembers the world, and opens on the map. It then takes the carry out of its address. Any failure (unknown world, an archived profile, no connection) leaves the usual start, which is the start page.
4. **A start at a join link to the world the device is already in** goes to the map (or the profile picker, if it has no profile), not through the join again. This covers an app added from a join link, which is then started at that same address every time.
5. **A join link opened in Safari** also works as a source: the app added from it starts at that link, and the installed app joins as it does from a pasted link (ADR 0005), then asks who the person is. The text of that screen now says so, and keeps the paste as the fallback.

## Consequences

- **Not verified on a device.** What iOS starts a home screen app at depends on its version. This ADR assumes it is the page's address when there is no manifest. If an iPhone ignores it, nothing is lost: the app starts as before, and the join screen offers the paste.
- **The ids in the address.** The world code is no more exposed than in a join link, and anyone who has it can already join and choose any profile (ADR 0003, ADR 0005). The address of a Safari tab stays on the device. The profile is not a secret.
- **An iPhone page has no manifest,** so the browser cannot offer its own install features there (there are none on iOS Safari); `Installer.mode()` for iOS stays `ios`.
- **Tests:** the carry is read and written in `routes.test.ts`; the early script writes no manifest on iOS; `app.test.ts` covers the written carry in an iPhone browser tab (and nowhere else), an installed app that starts in its world with its profile, the cases that must not use it, the failure fallback, and a start at the join link of the world already joined.
