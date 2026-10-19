# Roadmap

Each release is one minor version, developed on its own `release/0.x` branch (`GOVERNANCE.md` §3 and §8). Partial deliveries inside a release are patches (`0.x.1`, `0.x.2`, ...). A release only starts when the previous one meets its exit criteria and has been closed by the product owner.

The behaviour each release implements is specified in `SPEC.md`.

**Last closed release: 0.2 — Core** (2026-10-19, tag `v0.2`; [release notes](docs/release-notes/0.2.md)). **Current release: 0.3 — Recurrence and alerts**, in progress: all five deliveries done and reviewed; the exit criterion remains ([plan and closing](docs/plans/0.3.md)). The two pilots that follow are planned in [docs/plans/0.4.md](docs/plans/0.4.md) and [docs/plans/0.5.md](docs/plans/0.5.md).

## Release plan

### 0.1 — Foundations (closed)

Scope:

- Vite + strict TypeScript setup, Vitest.
- The `DataStore` interface with both adapters (Firestore and in-memory), plus the neutral schema.
- The theme package format, with the minimal emoji theme and an empty pirate theme folder.
- Neutral interface text in `src/i18n/pt-PT.json`.
- Firestore rules and their emulator tests.
- A GitHub Action that builds, tests and publishes to Pages.
- `lint:theme-leak` and `validate-theme`. In this release, `validate-theme` runs against the minimal theme only; the pirate theme joins validation in 0.6.

Exit criteria:

- domain and rules tests pass in CI;
- the start page opens on a phone over HTTPS.

### 0.2 — Core (closed)

Deliveries:

- **0.2.1 — World and profiles (done):** join link and QR code, Netflix-style profile picker.
- **0.2.2 — Map and `board` (done):** creating ad hoc tasks.
- **0.2.3 — `checkin` (done):** the verification question and the "I think I did better" button.
- **0.2.4 — Installable and offline (done):** web app manifest and a service worker that caches the app shell; the installed app's name and icon follow the world's theme, and the app offers to install itself (moved here from the radar by the developer, and accepted afterwards by the product owner on the tech lead's review, 2026-10-19; delivered as patches 0.2.4 and 0.2.5).

The app is installable from this release on. Installing it later would move it to separate storage on iOS and force everyone to join again.

Exit criteria:

- two devices stay in sync;
- airplane mode creates no duplicates;
- the installed app opens offline;
- a second minimal theme works without touching code or data;
- the product owner uses the app for a whole day without touching the code.

### 0.3 — Recurrence and alerts

Scope:

- daily, weekly and monthly tasks, generated on app open and on profile switch;
- ad hoc tasks from adults;
- planning `big` tasks with a day and a trigger;
- a visual alert for the day before and the day of a planned task.

Exit criteria: a second adult creates an ad hoc task without help.

### 0.4 — Adult pilot (7 days)

No new features; fixes only.

Exit criteria:

- the app is opened before dinner on 5 of the 7 days;
- no completion is lost.

### 0.5 — Children pilot (7 days), without rewards

Fixes only.

Exit criteria:

- the children use the app on at least 5 of 7 days without being called;
- completing a task takes less than 10 seconds;
- nobody describes it as "more work";
- the number of tasks the children create does not grow artificially.

**If this pilot fails, 0.6 is not built.**

### 0.6 — Rewards

Deliveries:

- **0.6.1 — Reward generation and the `vault`.**
- **0.6.2 — Opening:** opening day, `party`, pending collectibles and the reserve.

Exit criteria:

- the draw simulation is within its margin;
- opening the same reward on two devices yields a single collectible;
- a real family Sunday goes by without touching the code.

### 0.7 — `showcase`, `home` and art

Scope: each person's `home`, the `showcase`, and final art (Kenney assets under CC0, plus the children's drawings).

Exit criteria:

- licences are checked and `CREDITS.md` is complete;
- the map loads in under 3 seconds on Wi-Fi.

### 0.8 — Avatar and hardening

Scope:

- layered avatar;
- optional PIN per profile;
- polish of the PWA install experience;
- JSON export;
- a final review of the rules and of usage against the free quotas.

## Radar

Ideas that are outside the current release. They are neither implemented on own initiative nor discarded; the product owner reviews them and decides what moves into a release.

| Idea | Origin |
| --- | --- |
| Theme text layer 3: a theme may reword any neutral message by key and define terms used only in its own texts (`{#term}`), validated by `validate-theme` (ADR 0006) | Product owner, 2026-10-19 |
| Per-locale theme texts: move layers 2 and 3 of each theme into `src/themes/{themeId}/locales/{locale}.json` when a second locale arrives (ADR 0006) | Product owner, 2026-10-19 |
| Move the default theme id out of `src/main.ts` into a single configuration value (ADR 0006) | Spec review, 2026-10-19 |
| Due dates on tasks, and rescheduling without penalty; with them, decide what happens to open recurring tasks from past periods (today they stay on the `board` and block new copies) | Deferred by the product owner, 2026-10-18 |
| An admin can revoke a device (remove a member), for a leaked join code | Spec review, 2026-10-18 |
| Device-bound admin rights with an admin recovery code, so a child picking an adult profile does not get admin rights (alternative B in ADR 0003) | Deferred by the product owner, 2026-10-18 |
| Weekly guaranteed minimum (`ruleset.guarantee`) | `SPEC.md` §13 |
| Switching the theme of an existing world | `SPEC.md` §14 |
| Family meter and paired tasks | `SPEC.md` §14 |
| API integration (`origin: api`) | `SPEC.md` §14 |
