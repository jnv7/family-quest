# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses the versioning described in `GOVERNANCE.md` §3.

## [Unreleased]

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
