# 0013 — The page is themed from its first line

- **Status:** Accepted (product owner, 2026-10-24)
- **Date:** 2026-10-24
- **Decided by:** the developer's proposal; the plan for 0.10 foresaw it (`docs/plans/0.10.md`, delivery 0.10.6, "what to look at first if a phone fails") and asked for an ADR
- **Refines:** ADR 0005 (the themed install flow)

## Context

ADR 0005 makes the installed app carry its theme's name and icon: one manifest per theme, with the theme applied to the page before installing. `applyThemeToPage` does that once the app has loaded and the theme is known.

On an iPhone, adding the app to the home screen then showed the right icon (the parrot) but the name "Family Quest". The page that the browser first parses is generic: it has the generic manifest link, the generic `apple-mobile-web-app-title`, and an empty title that the app fills with "Missões {@world.of}". iOS reads the name from what it parsed, and from the manifest it fetched when the page loaded, so a script that runs only after the app has loaded can be too late. The icon is read when the person adds the app, which is why it was right and the name was not.

The page title was also "Missões na ilha", which is not the name the installed app has.

## Decision

1. **A small inline script is the first thing in `<head>`** (`scripts/early-theme.ts`). Before anything else is parsed, it chooses the theme from what already says so, the same sources ADR 0005 trusts:
   - the launch address of an installed app (`?theme=`);
   - a join link (`#/join/<world>/<theme>`);
   - the world this device remembers, with its remembered theme.

   It then writes the title, `apple-mobile-web-app-title`, the theme colour, the manifest link and the `apple-touch-icon` link. With no known theme, or on any failure, it writes the generic page.
2. **No static copy.** `index.html` and the build no longer carry a generic manifest link, title meta, icon link or theme colour; the script is the only writer, so there is no duplicate to choose between. The theme data it needs (name, colour, paths) is read from each `theme.json` at build time and written into the script, so no code looks at a theme id.
3. **The page title is the installed app's name** (`theme.install.name`, "Ilha dos Piratas" in the pirate theme), at the first paint and afterwards (`applyThemeToPage`). The generic title is "Family Quest" (`app.installName`).
4. **Nothing else changes.** The manifests, the icons, the offering of the install only once a theme is known, and the rule that the name never comes from a family's own world name stay as in ADR 0005.

## Consequences

- **A theme known only later** (for example, someone who creates a world and picks a theme on the create screen) is still applied by `applyThemeToPage` when it becomes known, as before. The inline script covers every start where the theme is already known.
- **iOS keeps its limit:** an icon and name already on a home screen never change, so the app has to be removed and added again to get the new ones.
- **Not verified on a device by the developer.** The cause above is the likely one, from how iOS reads a page; the check on a real iPhone is the product owner's (`docs/plans/0.10.md`, 0.10.6).
- **Tests:** the script runs against a fake page and address (generic, `?theme=`, join link, remembered world, unknown theme, broken storage); the build test checks that the script comes first and that no generic tag is left in `dist/index.html`.
