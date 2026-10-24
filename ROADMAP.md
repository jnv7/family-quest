# Roadmap

Each release is one minor version, developed on its own `release/0.x` branch (`GOVERNANCE.md` §3 and §8). Partial deliveries inside a release are patches (`0.x.1`, `0.x.2`, ...). A release only starts when the previous one meets its exit criteria and has been closed by the product owner.

The behaviour each release implements is specified in `SPEC.md`.

**Last closed release: 0.9 — Rewards that last** (2026-10-23, tag `v0.9`; [release notes](docs/release-notes/0.9.md)). **Current release:** 0.10 — Settings and configuration ([product brief](docs/plans/0.10-product-brief.md)), on `release/0.10`.

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

Scope: each person's `home`, the `showcase`, and final art: Kenney assets under CC0, and emoji, chosen by the children from a short list (product owner, 2026-10-20: no children's drawings in this release); and moorings on the map, with one boat per child showing their chosen symbol on the sail (product owner, 2026-10-20). Delivery plan in [docs/plans/0.7.md](docs/plans/0.7.md).

Exit criteria:

- licences are checked and `CREDITS.md` is complete;
- the map loads in under 3 seconds on Wi-Fi.

### 0.8 — Usability

Decided by the product owner on 2026-10-21. Delivery plan: [docs/plans/0.8.md](docs/plans/0.8.md).

Scope:

- one form to create tasks (once or repeating, for one or more people);
- one task card everywhere;
- the character asks the question, and "undo" for 4 seconds after done;
- a `board` alert for due, overdue-planned and new tasks;
- the crew flows, with a tavern of 10 places;
- names as labels;
- the adults' view of tasks per child;
- one look and feel.

Exit criteria:

- every delivery accepted by the tech lead;
- the product owner reviews every screen on a phone and finds no friction they want fixed before 0.9;
- still at most 2 taps from the map to a completed task.

### 0.9 — Rewards that last

Decided by the product owner on 2026-10-21; the reward model was changed by the product owner on 2026-10-23, replacing reward pieces. Product brief: [docs/plans/0.9-product-brief.md](docs/plans/0.9-product-brief.md). Retiring a task is specified in `SPEC.md` §6. The delivery plan is to be written by the tech lead before 0.8 closes.

Scope:

- tokens: a completed task earns tokens by its level (defaults 1, 2, 4), and no longer a reward;
- the `vault`: a person spends tokens to open a reward of the tier they choose (defaults 5, 12, 25), on any day, with the balance shown only there;
- no opening day and no tier odds; a child's self-created task is `low`;
- tokens per level, prices per tier and `partySize` set by an adult in management;
- a pirate catalogue of at least 8 collectibles per tier;
- retiring an open task from the `checkin` and the adults' view.

Both changes need new Firestore rules, an ADR and a rules deploy by the product owner.

Exit criteria:

- rules tests for tokens and retiring;
- two devices of the same profile never spend the same tokens;
- a real family week with tokens, without touching the code.

### 0.10 — Settings and configuration

Noted by the product owner on 2026-10-21; scope decided on 2026-10-24. Product brief: [docs/plans/0.10-product-brief.md](docs/plans/0.10-product-brief.md). The delivery plan is to be written by the tech lead.

Scope:

- a settings menu behind a gear in the map's top right corner, with "Trocar de perfil" last;
- management split into three screens for adults: people (with renaming a profile), tasks (one-off and repeating together), and the game's rules (tokens, limits including `pendingDays`, and restarting the world);
- restarting says "mundo", never the theme's word;
- "Como jogar", opened by itself once per profile and device, and "Como instalar";
- the version and build date in the menu, with "Atualizar" when a newer version is published;
- the installed app's theme icon and name checked on both phones; the pirate app becomes "Ilha dos Piratas", with the parrot's face as its icon.

Exit criteria:

- every exit criterion in the product brief (§9);
- the product owner reviews the menu and every settings screen on a phone.

### Later — Avatar and hardening (not yet planned)

To be reviewed by the product owner after 0.9. Candidate scope:

- layered avatar;
- optional PIN per profile;
- polish of the PWA install experience;
- JSON export;
- a final review of the rules and of usage against the free quotas.

## Radar

Ideas that are outside the current release. They are neither implemented on own initiative nor discarded; the product owner reviews them and decides what moves into a release.

| Idea | Origin |
| --- | --- |
| Children's drawings as theme art, with consent, a licence for the public repository, metadata stripped and a privacy check (`SPEC.md` §8) | Deferred by the product owner, 2026-10-20 |
| Theme text layer 3: a theme may reword any neutral message by key and define terms used only in its own texts (`{#term}`), validated by `validate-theme` (ADR 0006) | Product owner, 2026-10-19 |
| Per-locale theme texts: move layers 2 and 3 of each theme into `src/themes/{themeId}/locales/{locale}.json` when a second locale arrives (ADR 0006) | Product owner, 2026-10-19 |
| Move the default theme id out of `src/main.ts` into a single configuration value (ADR 0006) | Spec review, 2026-10-19 |
| Due dates on tasks, and rescheduling without penalty; with them, decide what happens to open recurring tasks from past periods (today they stay on the `board` and block new copies) | Deferred by the product owner, 2026-10-18 |
| An admin can revoke a device (remove a member), for a leaked join code | Spec review, 2026-10-18 |
| Device-bound admin rights with an admin recovery code, so a child picking an adult profile does not get admin rights (alternative B in ADR 0003) | Deferred by the product owner, 2026-10-18 |
| Three identical collectibles make a "super" one, to give repeats a value; still to decide: how the three are kept (never deleted), which ones can take part, and the art (`docs/plans/0.9-product-brief.md` §7) | Product owner, 2026-10-23 |
| Remove the 0.8 completion path from the rules (a task completed with no `tokens`, and its reward made from the task) once no device runs 0.8 (ADR 0008 §6) | Product owner, 2026-10-23 |
| Weekly guaranteed minimum (`ruleset.guarantee`) | `SPEC.md` §13 |
| Switching the theme of an existing world | `SPEC.md` §14 |
| Family meter and paired tasks | `SPEC.md` §14 |
| API integration (`origin: api`) | `SPEC.md` §14 |
