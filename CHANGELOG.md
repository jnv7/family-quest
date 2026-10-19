# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses the versioning described in `GOVERNANCE.md` §3.

## [Unreleased]

## [0.2.5] — 2026-10-19

Completes 0.2.4 with two items from the radar (moved there by the developer, and accepted afterwards by the product owner), and delivers the theme of the world.

### Added

- The theme belongs to the world: it is chosen when the world is created (when there is more than one theme), fixed for it, and followed by every device. The names, texts and page colours change with it, and the next launch has the right names from the first frame.
- A second minimal theme, "Tema quinta" (`minimal-farm`), with other names, genders, emoji art and icons, to prove a theme works without touching code or data.
- The installed app follows the world's theme (ADR 0005): one manifest per theme, with its own id, name, colours and icons, built from a new `install` block in `theme.json` (`validate-theme` checks it). The installed app starts on `?theme=<id>`, so it looks right from its first frame.
- The join link carries the theme id (`#/join/<worldId>/<themeId>`), so a joining device looks like the world before it joins.
- An install offer inside the app, only once the theme is known and never from the bare address: a button on Android and desktop Chrome, and the steps with the theme's app name on iOS. Hidden when already installed. It appears when inviting, in the map bar and on its own screen.
- On iOS, in a browser tab, a join link does not join (the installed app has its own storage): it explains, offers the steps and copies the link. A "paste" button joins from the clipboard in the installed app.

### Changed

- `theme.schema.json` has a required `install` block.
- A manifest without `start_url` was tried and dropped: Chrome refuses to install it (`start-url-not-valid`).

## [0.2.4] — 2026-10-19

### Added

- The app is installable (web app manifest, icons, iOS home screen name) and opens with no network: a service worker caches the app shell (ADR 0004, proposed).
- Neutral app icons in `public/icons/`.

### Changed

- Checking the device's membership at launch reads the local cache first, so starting the app offline does not wait for the network to give up.

## [0.2.3] — 2026-10-19

### Added

- The `checkin`, where a task is completed in two taps from the map: the place, then the task's own button ("done", or "yes" when the task has a question). The theme's character greets, congratulates, answers kindly to a "no" and says goodbye when there is nothing left.
- A task with a question shows it with "yes" and "no". "No" leaves the task open and records nothing (the proposal in `SPEC.md` §6, still to be confirmed).
- "I think I did better, I want to talk to my parents" on each open task; the completion keeps the flag.

### Changed

- A child creating a task only names it. The difficulty, the verification question and "for whom" are for adults only (`SPEC.md` §6).

### Fixed

- Fields meant to be hidden (such as "for whom" for a child) were still visible, because a style rule overrode the `hidden` attribute.
- When the tasks could not be loaded, the board threw the person back to the map without a word, so no task could be created. It now stays on screen with a message and a "try again" button, and the same applies to the new task form.
- A failed load of the world's profiles no longer makes the device forget its world. Only losing access does.

## [0.2.2] — 2026-10-19

### Added

- The map, the main screen after choosing a profile: five places laid out by the theme, with the theme's tap animation. Only the `board` leads somewhere yet; the other places are shown dimmed.
- The `board`: the open tasks of the active profile, oldest first.
- Creating ad hoc tasks: an adult creates for any profile, a child for themselves, with an optional verification question. A child can create three a day (Lisbon time), and tasks an adult creates for them do not count; no counts are shown.
- Interface text for these screens in `src/i18n/pt-PT.json`.

### Changed

- The placeholder screen after choosing a profile is replaced by the map (route `map`).
- The interface reads the current route through an injected `Navigation`, so tests can run several devices at once.

## [0.2.1] — 2026-10-18

### Added

- World and profiles:
  - create a world, which shows the join link, a QR code and the code to type;
  - join with a link, a scanned QR code, or a typed code;
  - Netflix-style profile picker, and switching profile later;
  - management for admins: create profiles, archive and reactivate child profiles, show the invitation again;
  - a device that already belongs to a world skips the start page.
- Interface text for these screens in `src/i18n/pt-PT.json`.

### Changed

- The Firestore adapter now points at the real Firebase project instead of placeholder values (`src/data/firestore/config.ts`).

## [0.1.9] — 2026-10-18

### Fixed

- The Firestore adapter read the clock after an asynchronous cache read, so `createdAt`, `doneAt` and the completion week could be later than the moment of the tap. They are now fixed at the call. This also made the task order test flaky in CI.

### Changed

- Admin rights come from the device's active adult profile instead of a role stored on the device (ADR 0003). Creating a world also creates the creator's adult profile. Adult profiles cannot be archived, and a profile's kind never changes.

## [0.1.8] — 2026-10-18

### Added

- Start page with the app name, an "under construction" text and the version, all text from the locale file and the minimal theme (`index.html`, `src/main.ts`).
- Vite build for GitHub Pages (`npm run dev`, `npm run build`, `npm run preview`) and a CI job that publishes `main` and `release/*` to Pages.

## [0.1.7] — 2026-10-18

### Added

- `npm run lint:theme-leak`: fails when theme vocabulary appears outside `src/themes/`, matching whole words in any case and with Portuguese accents. The forbidden terms live in `scripts/theme-leak-terms.json`. It runs in CI.

## [0.1.6] — 2026-10-18

### Added

- Theme module: `loadTheme` and `formatMessage`, which fills neutral messages with the theme's names and derives Portuguese articles and contractions from each noun's gender (`src/theme/`).
- Minimal theme (emoji art, three slots per tier) and the start page messages in `src/i18n/pt-PT.json`. An empty folder is reserved for the pirate theme.
- `npm run validate-theme`, with the five checks of `docs/architecture.md` §6 and a broken fixture for each; it runs in CI.

## [0.1.5] — 2026-10-18

### Added

- Firestore `DataStore` adapter: persistent multi-tab cache, converters that skip documents with an unknown `schemaVersion`, error mapping, and a placeholder `firebaseConfig` (`src/data/firestore/`).
- `npm run test:emulator`, which runs the shared contract suite against the Firestore and Auth emulators in CI.
- `npm run lint:imports`, which fails if a file outside `src/data/firestore/` imports `firebase/*`.
- Composite indexes for the task queries.

## [0.1.4] — 2026-10-18

### Added

- In-memory `DataStore` adapter, with a shared backend that enforces the same checks as the Firestore rules at the level of intents (`src/data/memory/`).
- Contract test suite that every adapter must pass, run here against the memory adapter (`src/data/datastore.contract.ts`).
- `randomId` for generated document ids.

## [0.1.3] — 2026-10-18

### Added

- Unbiased random integers by rejection sampling, with the random source injected, and 28-character random world ids (`src/core/random.ts`). `Clock` and `RandomInt` types in the model.

## [0.1.2] — 2026-10-18

### Added

- Calendar functions for `Europe/Lisbon`: date, ISO week, month, weekday and period keys, tested across both daylight saving changes and the 2026-W53 year turn (`src/core/calendar.ts`).

## [0.1.1] — 2026-10-18

### Added

- Domain model of every stored document (`src/core/model.ts`).
- `DataStore` interface, with its write and observer semantics (`src/data/DataStore.ts`).
- Firestore security rules, with emulator tests run in CI.
- JSON Schemas for theme, catalogue and locale files.
- Architecture guide, the delivery plan for 0.1, and ADR 0002 (data access contract).
- CI workflow: type check, unit tests and rules tests.
- Project documentation:
  - specification;
  - governance rules, contributing guide and Claude Code context;
  - roadmap and idea radar;
  - ADR 0001 with the founding decisions.
