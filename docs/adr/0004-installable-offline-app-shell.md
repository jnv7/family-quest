# 0004 — Installable app and offline app shell

- **Status:** Accepted
- **Date:** 2026-10-19
- **Proposed by:** developer, following the proposal in `docs/architecture.md` §7 and the 0.2.4 delivery in `ROADMAP.md`
- **Accepted by:** product owner, 2026-10-19, on the tech lead's review

## Context

The app is installed on the home screen and has to open with no network (`SPEC.md` §2, §10; ADR 0001). Firestore already keeps its own offline data cache, so the missing piece is the app itself: its HTML, scripts, styles and icons. The roadmap asks for installability in 0.2 because on iOS an app installed later gets separate storage and everyone would have to join again.

## Decisions

1. **`vite-plugin-pwa` in `generateSW` mode** produces the service worker and the manifest at build time, and registers the worker with a small script.
2. **Precache the app shell only:** the built HTML, scripts, styles and icons (and, from later releases, the bundled themes' art). Nothing else is cached by the worker. Firestore and Auth are other origins, so the worker never sees their traffic; Firestore keeps its own cache.
3. **New versions take over as soon as they are installed** (`skipWaiting` and `clientsClaim`). The page that is open is not reloaded, so a child is never interrupted; the next launch runs the new version. Old caches are removed.
4. **Interface text in the manifest comes from the locale file** (`app.installName`, `app.installDescription`), like all interface text. The iOS home screen name is injected at build time from the same key.
5. **Neutral icons** in `public/icons/`, generated from one SVG. They carry no theme vocabulary.

## Alternatives considered

- **A hand-written service worker.** No dependency, but it means maintaining a precache list and a cache-versioning scheme by hand, and a stale cache is the classic way an offline app breaks.
- **Using Workbox directly, without the plugin.** The same code to maintain, with none of the Vite integration (hashed file names, base path).
- **No service worker, only a manifest.** The app would be installable but would not open offline.

## Consequences

- A development dependency with a large tree (Workbox). It is not shipped to the browser; the worker it generates is small.
- The first launch of a device needs the network; offline start works from the second load on.
- After a deployment, a device that is open keeps the old version until its next launch. A page that loads code lazily could ask for a file the new version no longer has; the app loads everything it needs at start-up, so this does not happen today. The only dynamic imports (`src/main.ts`, the data adapters) run during start-up, before the service worker checks for updates. Rule: no dynamic `import()` may run after start-up without revisiting this ADR.
- On iOS the installed app has its own storage, separate from the browser. Install first, then join.
