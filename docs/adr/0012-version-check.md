# 0012 — Showing the version and loading a newer one

- **Status:** Accepted (product owner, 2026-10-24)
- **Date:** 2026-10-24
- **Decided by:** product owner (the behaviour: `docs/plans/0.10-product-brief.md` §7); the mechanism is the tech lead's proposal, accepted with it
- **Refines:** ADR 0004 (installable app and offline app shell)

## Context

The service worker is registered with `registerType: 'autoUpdate'` (ADR 0004). A new version installs itself in the background and takes over the cache, but the page in use is not reloaded. An installed app that stays open, or comes back from the background, keeps running the old code until it is closed for good, and nobody can tell which version is running.

The brief asks for three things, with no cost and within GitHub Pages:

- the running version and its build date in the menu;
- an "Atualizar" button when a newer version is published;
- nothing at all when offline.

## Options

- **A. A published version file (recommended).** Each build writes `version.json` next to the app, and the app reads it without any cache. It is a plain fetch: it can be tested with a fake, works the same on every browser, and does not depend on when the service worker decides to look.
- **B. Only the service worker's own update events.** Use `registration.update()` and listen for a new worker. This avoids one file, but each browser decides when the check really happens, the old page cannot tell the version of the new worker, and on iOS the events are unreliable in an installed app. That makes it hard to test, and hard to show "Versão x".

## Decision

### 1. One build identity, in two places

`vite.config.ts` computes, once per build:

```ts
const build = { version, builtAt: Date.now(), commit: process.env.GITHUB_SHA?.slice(0, 7) ?? 'local' };
```

- **In the code:** it is injected as `__APP_BUILD__`, the way `__APP_VERSION__` is injected today. `__APP_VERSION__` is replaced by `__APP_BUILD__.version`.
- **As a file:** a small Vite plugin writes the same object as `version.json` (`generateBundle`, `emitFile`).
- **Never cached:** `version.json` must not enter the service worker's precache. `globPatterns` does not include `json`, and a comment in `vite.config.ts` says why.

### 2. Checking

`src/ui/updates.ts` creates an `Updater`. It is injected into the app like the `Installer`, so tests pass a fake.

- It checks once when the app starts, and again each time the menu opens, but at most once a minute.
- The check is `fetch(\`${assetBase}version.json?t=${Date.now()}\`, { cache: 'no-store' })`:
  - `cache: 'no-store'` skips the browser cache;
  - `?t=` skips the cache in front of GitHub Pages.
- **What counts as newer** is decided by a pure function in `src/core/`:

  ```ts
  isNewerBuild(running: Build, published: Build): boolean // published.builtAt > running.builtAt
  ```

  So an older file (for example, a cache in between) never offers to go back.
- **Any failure is silent:** offline, a bad response, a timeout of 5 s, or JSON that does not parse. There is no button, no error and no log in the interface, and the next check tries again.
- **Development:** in `vite dev` the updater does nothing.

### 3. Updating

When "Atualizar" is tapped:

1. call `registration.update()` and, if a new worker is installing or waiting, wait for `controllerchange`, for at most 10 s;
2. then `location.reload()`.

Without a service worker, it only reloads.

**Nothing is lost:**

- Firestore keeps its queued writes in its persistent cache (`SPEC.md` §10);
- the button is only in the menu, which opens on the map, and leaving the `checkin` already writes any completion still waiting for its 4 s of undo.

### 4. The interface

The menu's footer shows "Versão {version} · {date}", with the date of `builtAt` in Lisbon as `dd/mm/aaaa`, and "Atualizar" when the check says newer. Nothing on the map changes.

## Consequences

- **A delay of up to a few minutes.** Right after a deploy, GitHub Pages may need a few minutes before it serves the new `version.json`, so "Atualizar" can take that long to appear.
- **Every deploy counts as a new build.** A push to `release/0.x` without a version bump is still a newer build (`builtAt`), and the footer shows the same version with a newer date. That is correct: what is published is newer.
- **Cost.** One small request when the app opens and when the menu opens. It stays within GitHub Pages and has nothing to do with Firebase.
- **Tests:**
  - `isNewerBuild` and the date format;
  - the updater with a fake `fetch`: newer, same, older, offline, and broken JSON;
  - the menu footer with a fake updater: the button only when newer, and tapping it calls `apply`;
  - a build test that `dist/version.json` exists, matches `__APP_BUILD__`, and is not in the precache manifest.

## Amendment (0.10.10, 2026-10-24): "Atualizar" no longer depends on the service worker

The product owner found that "Atualizar" did nothing. §3 asked the service worker to update, waited for it to take over, and reloaded. But `version.json` is read under a new address each time (`?t=`), while `sw.js` and `index.html` are not, and GitHub Pages can serve the old ones for some minutes after a deploy. The app then knew a newer build existed, the worker found nothing to update, and the reload came back as the old build.

§3 is replaced by:

1. unregister the service worker and delete its caches;
2. load the page again from the network under a new address, the same one plus `?v=<time>`, with the hash and the theme kept, so no cache in between can answer for the old page. Once loaded, the app takes `?v=` out of the address.

Nothing is lost: Firestore's own persistent cache and the device's memory of its world are not touched. The new page registers a fresh worker, which caches the new shell as usual. This only runs when the person taps the button, after a check that has just proved there is a connection. The rest of the ADR holds.
