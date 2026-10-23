# Specification — Family Quest

Last revised: 2026-10-23.

Tags: **[decided]** came from the product owner; **[proposal]** is a design suggestion that may change; **[open]** is still to be decided.

The release plan and the radar of future ideas live in `ROADMAP.md`. Architecture decisions are recorded in `docs/adr/`.

## 1. Goal and scope

A PWA for a family of adults and children. Each person has tasks (daily, weekly, monthly or ad hoc), completes them on their phone and earns tokens, which they spend on rewards in a themed collection game (from 0.9). The game teaches time planning and managing a scarce resource (open a cheap reward now, or save for a rarer one), without pressure and without comparing people.

- Devices: Android phones (children) and iPhones (adults), with the app installed on the home screen. **[decided]**
- Hosting: GitHub Pages (static, public repository) + Firebase Spark (Firestore and anonymous Authentication). **[decided]**
- The first theme is called "Piratas do Farol". It is only a theme package; the system itself has no themed name. **[decided]**
- A world (one family) uses a single theme, fixed at creation. Switching themes is future work. **[decided]**

## 2. Cross-cutting requirements

- **Theme independence.** See section 8 and rule 1 in `CLAUDE.md`. **[decided]**
- **Local-first.** Works offline; syncs on its own. **[decided]**
- **No cost:** Spark plan; no Cloud Functions, no Cloud Storage. **[decided]**
- **No friction.** Completing a task takes at most 2 taps from the map; a task with a verification question takes a third, to answer it (product owner, 2026-10-21). Alerts are visual (a speech bubble with dots appears on a place of the map, as if it wanted to say something), with no scolding text and no push notifications. **[decided]**
- **No comparison.** No screen shows counts, rankings or who owns a collectible to other people. **[decided]**
  - **One deliberate exception: your own balance** (product owner, 2026-10-23; from 0.9). The active profile's own token balance is shown as a number at the top of the `vault`, and nowhere else. It is never shown to anyone else, nor in the adults' view. **[decided]**
- **Nothing earned is lost.** Rewards and collectibles are never deleted. No document in the system is deletable. Spending tokens deletes nothing: every token earned is recorded on its done task, and every token spent on the reward it bought (ADR 0008). **[decided]**
  - **One deliberate exception in reach, not in data** (product owner, 2026-10-21): a collectible that drops out of the `showcase` "leaves for another island". It stays stored, but it can no longer be seen or brought back (section 6). **[decided]**
  - **Retiring a task** (from 0.9) hides an open task that earned nothing. It is a status change, not a deletion (section 6).
- **Public repository data:** code and art only. No family data. **[decided]**
- **Language.** Every repository artefact (code, docs, comments, commits) is in English. The user interface is in European Portuguese, and its text lives only in locale files (section 8). **[decided]**
- **Collaboration between people** (family meter, paired tasks) is out of scope for v1. Do not build it. **[decided]**

## 3. Neutral glossary

These names are the only ones allowed in code, ids, collections and rules. The theme gives them visible names. A theme may give the same visible name to more than one role; that is a theme decision and has no effect on the code.

| Name in code | Role | In the "Piratas do Farol" theme |
| --- | --- | --- |
| `world` | A family; groups profiles and data | Ilha |
| `profile` | A person inside the world | Pirata |
| `board` | Map place showing today's tasks | Papagaio na doca |
| `checkin` | Place where a task is completed; its character asks the question | Farol e velho sábio |
| `home` | Each person's own place: avatar and party | Barco |
| `vault` | Where a person spends tokens to open a reward of the tier they choose, and opens rewards from before 0.9 | Gruta do tesouro |
| `showcase` | The latest collectibles moved to the reserve | Bar |
| `reward` | What is opened in the `vault`; it has a `tier` and yields one collectible. From 0.9 it is bought with tokens; before 0.9 a completed task produced one | Baú |
| `token` | Unit earned by completing a task and spent in the `vault` (from 0.9) | Tocha |
| `collectible` | What comes out of a reward | Marujo |
| `party` | The collectibles (`partySize`, 5 by default) that accompany a profile | Tripulação |
| `reserve` | Collectibles that are not in the `party` | Ilha |
| `tier` | Rarity: `low`, `mid`, `high` | Baixo, médio, alto |
| `slot` | Stable identifier of a collectible in the theme catalogue | — |

## 4. Data model (Firestore)

All collections live under `worlds/{worldId}`. Every document has `schemaVersion` (number) and `createdAt`. Dates stored as text are `YYYY-MM-DD` in `Europe/Lisbon`. World ids are random, 24 characters or more, and act as the access code (section 5).

### `worlds/{worldId}`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string | World name |
| `themeId` | string | Immutable after creation |
| `createdBy` | string | Creator's `uid` |
| `ruleset` | map | See below; configuration, not code |

`ruleset` (defaults):

- `partySize`: 5. **[decided]** From 0.9 an admin can change it in management (1 to 10). Lowering it never removes anyone from a `party`: a `party` above the new size keeps its members, and nobody can join it until it is below the size. **[decided]** (product owner, 2026-10-23)
- `showcaseSize`: 10. **[decided]** (product owner, 2026-10-21; it was 30.) An admin can change it in management (0.8), which is also how an existing world, created with 30, gets 10.
- `childDailyTaskLimit`: 3 ad hoc tasks created by a child for themselves per day. **[decided]**
- `timezone`: `Europe/Lisbon`; `weekStartsOn`: Monday.
- `pendingDays`: how many days a newly obtained collectible stays in its owner's pending list before moving to the reserve; default 1. **[decided]** (value is configurable)
- `tokensPerLevel` (from 0.9): the tokens a completed task earns, by its `level`: `low` 1, `mid` 2, `high` 4. **[decided]** (product owner, 2026-10-23)
- `tokenPrices` (from 0.9): the price of a reward, by `tier`: `low` 5, `mid` 12, `high` 25. **[decided]** Whole numbers, strictly increasing from `low` to `high`.
- `guarantee`: weekly minimum rule per person. **[open]** Defaults to `null` (off). The code provides the extension point (from 0.9, in `tokensFor`) but implements no rule until the product owner decides.

An admin edits `tokensPerLevel` and `tokenPrices` in management (section 7.8). A change applies only to later completions and purchases. A world created before 0.9 has neither field; it reads them as the defaults until an admin saves them.

`openingDay` and `tierOdds` were removed in 0.9: there is no opening day, and the tier of a reward is chosen, not drawn. Worlds created before 0.9 still store them; the app ignores them.

### `members/{uid}`

A device in the world. `uid` comes from anonymous authentication.

| Field | Type | Notes |
| --- | --- | --- |
| `profileId` | string or null | The device's active profile. Null right after joining; the device chooses it and can switch later |

**Admin rights come from the active profile.** A device is `admin` while its active profile is an adult profile. There is no role stored on the device, so changing or resetting a phone loses nothing: the new device joins and picks the adult profile. **[decided]** (ADR 0003) The consequence is accepted under the trust model: a child who picks an adult profile gets admin rights. A device-bound admin with a recovery code is on the radar.

### `profiles/{profileId}`

| Field | Type | Notes |
| --- | --- | --- |
| `displayName` | string | |
| `kind` | `adult` or `child` | Immutable. Adult profiles carry admin rights (section 5); otherwise `kind` affects only appearance and limits, and the mechanics are the same |
| `avatar` | map | Layers as indices (`body`, `hair`, `outfit`, `accessory`), plus `symbol`: one emoji, any single emoji (the theme only suggests some), or null until chosen. Never an image. A profile read without `symbol` has `symbol: null`. The rules only require `avatar` to be a map, so `symbol` needs no rules change **[decided]** |
| `partyIds` | list of ids | Up to `partySize`; the source of truth for the `party` |
| `archived` | boolean | Profiles are never deleted. Only child profiles can be archived, so a world always keeps at least one adult profile, and therefore an admin |
| `tokens` | integer, optional | From 0.9: the token balance; absent means 0. Changed only with `increment()`, in the batch that completes a task or buys a reward, and never below 0 (ADR 0008). Readable by members like the rest of the profile; shown only to its owner, in the `vault` |
| `tokensFrom`, `tokensFor` | string, optional | From 0.9: the task that last added tokens, and the reward that last spent them. They let the rules check every change of `tokens` against its reason |

### `taskDefs/{defId}` — recurring task definitions

`title`, `cadence` (`daily`, `weekly`, `monthly`), `level` (`low`, `mid`, `high`), `assignedTo` (list of `profileId`; every non-archived profile if empty; archived profiles never get new tasks **[decided]**), `question` (string or null), `big` (boolean; only these can be planned with a day and a trigger), `active`.

### `tasks/{taskId}`

| Field | Type | Notes |
| --- | --- | --- |
| `profileId` | string | Who the task is for |
| `title`, `level`, `question` | | Copied from the definition or written by hand |
| `source` | `recurring` or `adhoc` | |
| `defId` | string or null | Set for recurring tasks |
| `periodKey` | string or null | Period of a recurring task (see below); null for ad hoc |
| `createdBy` | string | `profileId` of the creator |
| `origin` | `app` or `api` | For future integrations |
| `big` | boolean, optional | `true` only on an ad hoc task made big (0.8); absent otherwise, and never changed after creation. A recurring task is big when its `taskDef` is |
| `plan` | map or null | `{date, trigger}`; only tasks from a `big` definition (0.3) and big ad hoc tasks (0.8) |
| `status` | `open`, `done` or (from 0.9) `retired` | A `done` or `retired` task never changes status again |
| `doneAt` | timestamp or null | |
| `answer` | `yes`, `no` or null | Answer to the `question` |
| `talkFlag` | boolean | "I think I did better, I want to talk to my parents" |
| `weekKey` | string or null | `YYYY-Www` of completion; null while open |
| `tokens` | integer, optional | From 0.9: the tokens earned, fixed at completion (`tokensPerLevel[level]` at that moment). Absent on open and retired tasks, and on tasks completed before 0.9 |
| `retiredAt`, `retiredBy` | timestamp and string, optional | From 0.9: set only when the task is retired, with the `profileId` of whoever retired it (ADR 0009) |

Tasks have no due date for now; what counts is completion. **[decided]** Due dates and rescheduling are on the radar.

Recurring task id: `{defId}_{periodKey}_{profileId}`, where `periodKey` is `YYYY-MM-DD` (daily), `YYYY-Www` (weekly, ISO week) or `YYYY-MM` (monthly). The id identifies the period in which the task was generated; a period does not always yield a task (section 6). Ad hoc task id: random.

### `rewards/{rewardId}` and `collectibles/{rewardId}`

A reward and its collectible share one id. **[decided]**

- **Before 0.9**, a completed task produced a `reward` with the task's id. Opening it produces a `collectible` with that same id. One id per task across three collections prevents duplicates without transactions (section 10).
- **From 0.9**, a reward is bought in the `vault` (ADR 0008). It has a random id, and is created already opened, in the same batch that spends its price and creates its collectible.

`rewards`: `profileId`, `weekKey` (of completion before 0.9, of purchase from 0.9), `tier` (drawn at completion before 0.9, chosen from 0.9), `openedAt` (null until opened; set at creation for a bought reward), `price` (only on a bought reward: the tokens it cost).

`collectibles`: `profileId`, `slot`, `tier`, `nickname` (string or null; chosen by the user, survives a theme change), `obtainedWeekKey`, `obtainedAt` (timestamp), `reserveAt` (null while in the `party` or pending; timestamp once it moves to the reserve).

## 5. Identity, access and rules

**Anonymous authentication.** Each device has a `uid`. If the device loses its storage it loses its `uid`: it joins again with the code and picks its profile. No data is lost.

**Creating a world.** In one batch, the device creates `worlds/{worldId}`, the creator's own adult profile, and its `members/{uid}` with that profile active. That makes the creating device admin. The rules allow a membership created with a profile only for the world's `createdBy`, inside that batch. The app then shows the join link and QR code (below).

**Profiles.** An admin creates the profiles of everyone else in the world, through the app, with generated ids. **[decided]**

**Joining a world.** The admin shares a join link, `<app URL>#/join/<worldId>/<themeId>`, also shown as a QR code. The code is in the URL fragment, so it never reaches a server log. The theme id is not secret: it makes the page look like the world before it joins and lets the app offer to install itself with the right name and icon (ADR 0005). On iOS, in a browser tab, the link does not join: the installed app has its own storage, so the person installs first and joins from the installed app, pasting the link in one tap. **[decided]** Typing the code by hand remains possible. The joining device creates its `members/{uid}` with `profileId: null`, which makes it a member. It can then read the profiles, and it picks one. **[decided]**

**Choosing and switching profiles.** It works like Netflix: the device picks a profile and stays on it; it can switch to another profile at any time. The choice is not verified, so security between profiles relies on trust. An optional PIN per profile (0.8) locks the interface only. **[decided]** A second adult gets admin rights by picking their own adult profile. **[decided]**

**Owner and admin.** In the rules:

- the *owner* of a document is the device whose `members/{uid}.profileId` equals the document's `profileId`;
- an *admin* is a device whose active profile is a non-archived adult profile.

**Firestore rules** (file `firebase/firestore.rules`, tested in the emulator). Nothing can be deleted, in any collection.

| Collection | Read | Write |
| --- | --- | --- |
| `worlds` | members | create: any authenticated user, with `createdBy == uid`; update: `admin`, without changing `themeId` or `createdBy` |
| `members` | members | create: only its own `uid`, with `profileId` null, or with the creator's new adult profile inside the world-creating batch; update: the device itself changes only `profileId`, to an existing, non-archived profile |
| `profiles` | members | create: `admin`, or the world's creator for its own adult profile inside the world-creating batch; update: `admin` changes `displayName`, `avatar` and `archived` (archiving only child profiles), never `kind`; the owner updates only `avatar` and `partyIds`, plus (from 0.9) `tokens` by increment, with `tokensFrom` in the batch that completes that task, or with `tokensFor` in the batch that creates that reward, never below 0 (ADR 0008); `partyIds` fits `partySize`, or, above a lowered size, only loses members |
| `taskDefs` | members | `admin` |
| `tasks` | `admin` or the owner | create ad hoc: `admin` for any profile, or the owner for itself with `origin: app` (optionally with `big: true`, only on an ad hoc task); create recurring: the owner only, with an id equal to `{defId}_{periodKey}_{profileId}`, for an active `taskDef` assigned to that profile; every new task has `status: open`; update: only the owner completes (`status` from `open` to `done`, together with `doneAt`, `answer`, `talkFlag`, `weekKey`, and from 0.9 `tokens` from 1 to 10, added to the profile in the same batch); an `admin` retires any open task, and the owner retires an ad hoc task they created for themselves (`status` from `open` to `retired`, with `retiredAt` and `retiredBy`; ADR 0009); and the owner may change `talkFlag` and `plan` on an open task (a plan only on a task from a big definition or a big ad hoc task); an `admin` may change `title`, `level` and `question` on an open task; nobody changes `status` of a `done` or `retired` task, nor `profileId`, `source`, `defId`, `periodKey`, `big`, `createdBy` or `createdAt` |
| `rewards` | `admin` or the owner | create, the owner only and never replacing an existing one: from a task, only in the same batch that moves the task with the same id from `open` to `done` without `tokens` (checked with `get` and `getAfter`), with the same `profileId` and `weekKey` (the 0.8 path, kept for writes queued before 0.9); or bought (from 0.9), with a `price` from 1 to 200 and `openedAt` set, only in the batch that takes that price from the profile's `tokens` and creates its collectible; update: the owner, only `openedAt`, once |
| `collectibles` | members (the `showcase` needs to read other people's; the interface hides the owner) | create: the owner only, never replacing, and only in the same batch that sets `openedAt` on the reward with the same id, or (from 0.9) that creates the bought reward with the same id, with that reward's `tier` and `profileId`; update: the owner, only `nickname` and `reserveAt`; `admin`, only `nickname` (moderation, since the `showcase` shows nicknames to everyone) **[decided]** |

The rule "a `done` task never changes `status`", together with the immutable `createdAt`, is essential. Without it, generating recurring tasks again could overwrite completed tasks (section 6).

The rules cannot count documents, and checking the weekday there would use UTC server time at sync. The daily task limit (and the opening day, until 0.9) is therefore enforced in the client and tested in the domain, and so is the `low` level of a child's own task (from 0.9). The `party` size is enforced in both places: the rules compare the length of `partyIds` with `ruleset.partySize` whenever `partyIds` changes. The reward `tier` (drawn before 0.9, chosen from 0.9) and the collectible `slot` are set in the client and cannot be verified by the rules; like profile choice, this relies on trust. **[decided]** From 0.9 the same holds for the amounts: the rules check that a task's `tokens` and a reward's `price` are within range, not that they equal the current `ruleset`, so a device that was offline while an adult changed the values never sees a completed task reopen (ADR 0008). The rules do guarantee that a balance never goes below 0, that the same tokens are never spent twice, and that only the owner earns or spends.

## 6. Mechanics

**Week.** Monday to Sunday, Lisbon time. `weekKey` uses the ISO week format `YYYY-Www`. The daylight saving change on 25 October 2026 and the turn of the year must be tested. 2026 has 53 ISO weeks, so 1 January 2027 belongs to `2026-W53`.

**Generating recurring tasks.** When the app opens, and when the device switches profile, the client looks at each active `taskDef` that applies to the active profile. It creates the task for the current period, with the deterministic id from section 4, only if both of these hold:

- there is no open task from that `taskDef` for that profile, from any period;
- no task from that `taskDef` for that profile was completed during the current period (the period of its `doneAt`).

There is therefore at most one open task per `taskDef` and profile. Completing an overdue task covers the period in which it is completed. Before writing, it checks the local cache and skips tasks it already has. If the task exists on the server but not in the cache (for example after a reinstall while offline), the write reaches the server as an update and the rules reject it, because `createdAt` and `status` cannot change. That rejection is expected and silent. Opening the app twice in the same period never duplicates a task, and it never reopens a completed one.

**Open recurring tasks from past periods.** **[decided]** A recurring task stays open, and stays on the `board`, until it is completed, even after its period ends. No new copy is created while it is open, and no failure is recorded. This is revisited when due dates are introduced (see the radar in `ROADMAP.md`).

Known edge case: the "no open task" check runs on the local cache, so a device whose cache misses an open task (for example, a fresh install that has not synced yet) can still create a second open task for a new period. The `board` shows only the oldest open task per `taskDef` and profile; any extra task stays stored and appears once the first is completed. **[proposal]**

**One way to create a task** (from 0.8). **[decided]** Adults use a single form, opened from the `board` and from management:

- **For whom:** one or more profiles, or "everyone".
- **Repeats:** once, daily, weekly or monthly.
  - **once:** one ad hoc task per chosen profile ("everyone" means every non-archived profile at that moment);
  - **any repetition:** one `taskDef` with those profiles in `assignedTo` ("everyone" means `assignedTo: []`, which includes future profiles).
- **Other fields:** the difficulty, an optional question and "big" (can be planned). A big task that does not repeat is allowed (ADR 0007): its plan may be any day from today on, with no end, while a task of a big definition can be planned only up to the end of its period.

A child's form keeps only the title. The details are in `docs/plans/0.8.md`, 0.8.1.

**Ad hoc tasks.** An `admin` creates them for any profile. A child creates them only for themselves, within the daily limit. The limit counts the ad hoc tasks the child's profile created for itself whose `createdAt` falls on today's date in Lisbon; tasks created by an admin do not count. **[decided]** A child only gives the task a title: it is always for themselves, with `level` `low` (from 0.9; it was `mid`) and no `question`. **[decided]** (product owner, 2026-10-23: a task a child invents never earns more than the tasks they are given.) An adult may also set the `level`, a `question` and who it is for. An ad hoc task stays open until it is completed.

**Completing.** Each person completes only their own tasks. **[decided]** In one atomic batch, the client:

- moves the task to `done`, with `doneAt`, `answer`, `talkFlag` and the `weekKey` of the completion;
- from 0.9, sets the task's `tokens` to `tokensPerLevel[level]` and adds them to the profile's balance with `increment()` (ADR 0008). A completed task no longer produces a reward. Until 0.9 it created the `reward` with the same id, with a `tier` drawn from `tierOdds[level]`.

Tokens are earned only by completing: "no" to the question, "undo" within the 4 seconds and retiring a task earn nothing. Every balance starts at 0 in 0.9: tasks completed before 0.9 earn nothing, because they already produced rewards. Adults earn and spend tokens like everyone else. **[decided]**

**Undo** (from 0.8). **[decided]** After "done" (or "yes"), the card offers "undo" for 4 seconds, and the batch is written only when they end. If the page is hidden first, it is written at once. Undo within the 4 seconds writes nothing, so a mis-tap never needs a task to be reopened. It adds no tap.

**Verification question.** If the task has a `question`, "done" comes first, and only then the `checkin` character asks it: after "done" the card shows the character's small portrait with the question in a speech bubble, and "yes" and "no" inside the bubble (from 0.8). **[decided]** (product owner, 2026-10-21) Answering "yes" completes the task, so a task with a question takes three taps from the map (the place, "done", "yes"); one without takes two. On "no", the task stays open, the character says a friendly themed line, and no failure is recorded. **[decided]**

**"I think I did better".** **[decided]** (product owner, 2026-10-21) This is no longer a button. The `checkin` shows a static line before the list of tasks ("if you think you did a task better than expected, talk to your parents"), so the conversation happens out loud. The `talkFlag` field and its store operation remain in the data, but the interface does not set it, so it stays `false`. There are no points, states or multipliers.

**Retiring a task** (from 0.9). **[decided]** (product owner, 2026-10-21: a "delete task" button in the `checkin`) An open task can be retired:

- it moves to `retired`, never comes back, gives no reward, and is hidden from every list;
- nothing is deleted from the data, and nothing earned is lost, because an open task has earned nothing.

**[decided]** (product owner, 2026-10-21) Who can retire:

- an adult, any open task, from the `checkin` (their own) or from the adults' view (anyone's);
- a child, only an ad hoc task the child created for themselves, never one given by an adult and never a recurring one, so retiring is not a way to skip chores.

**How it looks:** retiring is a secondary action on the card (behind a "⋯"), never next to "done".

**Recurring tasks:** retiring a recurring task skips only that period. Its id stays taken, so it is not generated again in that period. To stop a recurring task, deactivate its definition.

This needs a rules change (`open → retired`), so it comes with an ADR (0009), rules tests and a rules deploy by the product owner. A retired task still counts towards a child's daily ad hoc limit.

**Board alert** (from 0.8, replacing the 0.3 alert). **[decided]** The `board` place lights up, with no text or number, for the active profile's open tasks. From strongest to weakest:

1. **due:** planned for today, or the planned day has passed;
2. **new:** not yet seen;
3. **soon:** planned for tomorrow.

What counts as **new**: an ad hoc task created by someone else, or the first task of a recurring definition created since the profile last opened the `board` or the `checkin` on this device. Daily repeats of a known definition are not new. The "last seen" time is kept on the device only.

**Spending tokens** (from 0.9). **[decided]** (product owner, 2026-10-23; replaces "reward pieces", which was never built)

- **Any day:** there is no opening day and no weekly ritual.
- **Choosing the tier:** the person chooses one of the three tiers in the `vault` and pays its price (`tokenPrices`). The reward has that `tier`.
- **The draw:** the collectible is drawn uniformly among the theme catalogue's slots of that tier, with repeats allowed. The catalogue is not shown, and nothing says how many collectibles exist.
- **Never below zero, never twice:** a person cannot spend more tokens than they have. Two devices of the same profile, both offline, can never spend the same tokens (ADR 0008). If that happens, the second purchase is refused when it syncs, and that device shows a neutral line saying the tokens had already been spent on another device.
- **One batch:** buying takes the price from the balance, creates the reward (already opened) and creates its collectible, which is pending.
- **Catalogue size:** at least 8 collectibles per tier in the pirate theme. **[decided]**

**Rewards from before 0.9.** **[decided]** Unopened rewards from before 0.9 stay whole, with no migration. They appear in the `vault` as rewards already found, and open for free, on any day. Opening one is one atomic batch that:

- draws a theme catalogue `slot` with the reward's `tier`, uniformly among that tier's slots **[decided]**;
- creates the `collectible` with the same id;
- sets `openedAt` on the reward.

**Party and reserve.** Each collectible is in exactly one of three states:

| State | Condition |
| --- | --- |
| In the `party` | Its id is in the profile's `partyIds`; `reserveAt` is null |
| Pending | Not in `partyIds`; `reserveAt` is null |
| In the `reserve` | `reserveAt` is set |

A newly obtained collectible is pending. It stays in its owner's list, where the owner can put it into the `party` (choosing who leaves if the party is full). After `ruleset.pendingDays` days from `obtainedAt`, the owner's client moves pending collectibles to the reserve the next time it opens, by setting `reserveAt`. A collectible that leaves the `party` goes to the reserve, with `reserveAt` set. The reserve is not a list on the profile: the collectibles in it have been sent away, and everyone sees them in the `showcase` (**[decided]**, product owner, 2026-10-20). The way back is the `showcase`: a person who taps one of their own collectibles there can put it back into the `party` (choosing who leaves if it is full), which clears its `reserveAt`. The item tells nobody else that it is theirs. Nothing is deleted.

**Showcase.** A computed view: the collectibles with `reserveAt` set, ordered by `reserveAt` descending, limited to `showcaseSize` (10), **shared by the whole world** (product owner, 2026-10-21). An adult sets the number in management. It shows the name (`nickname`, or the theme's name for the `slot`) and never the owner. A collectible that drops out of the `showcase` has **left for another island**. It stays stored and is never deleted, but it is no longer shown, and nobody can bring it back (product owner, 2026-10-21). This is part of the game: the tavern only has room for the latest arrivals. **[decided]**

## 7. Screens and flows

The main screen is a **map** with five tappable places. Each tap starts a short animation to that place. The position, drawing and animation of each place belong to the theme. The avatar cannot be moved freely. **[decided]**

**Moorings: the family on the map.** **[decided]** (product owner, 2026-10-20) A theme may declare moorings: fixed spots on the map, per profile `kind`. The engine draws one boat (`homeVariants[kind]`) at each mooring, one per non-archived profile of that kind.

- **Order:** profiles fill the moorings in creation order (`createdAt`, then `id`), so every device draws the same layout.
- **Symbol on the sail:** each boat shows its profile's `avatar.symbol` at the theme's symbol spot (on the sail, in the pirate theme), so each person's boat can be told apart. A profile with no symbol shows its boat without one.
- **Only your own boat opens:** tapping the active profile's own boat opens their `home`, like the `home` place does. The other boats are decoration and do nothing when tapped. They only show that each person is on the island, and never open another person's `home` or `party` (product owner, 2026-10-20). No boat shows a name, count, collectible or party, so `SPEC.md` §2 still holds. The `home` place stays on the map as well.
- **More profiles than moorings:** the extra profiles are not drawn. This is a limit of the theme, not an error. A theme should declare enough moorings (the pirate theme: at least 6 for children).
- **Themes without moorings:** a theme that declares none shows the map exactly as before.

The pirate theme declares moorings for children only, at the pier. Adults keep the large ship, which is the `home` place art. The symbols of the non-archived adults (up to three, in creation order, smaller as they grow in number) are drawn on its sail for everyone, so a child also sees whose ship it is.

1. **First launch.** Create a world (choosing its theme, when there is more than one), which shows the join link and QR code, or join with a link or code. Then pick a profile. Once the theme is known, the app offers to install itself (never from the bare address).
2. **Profile picker.** Netflix-style list of the world's non-archived profiles. Reachable later to switch profile.
3. **`board`.** All open tasks of the active profile, including those from past periods, as task cards (from 0.8 the same card and order as the `checkin`). The order is:
   1. due;
   2. soon;
   3. new (with a "new" marker);
   4. the rest, oldest first.

   The `board` cards have no action: a task is completed only in the `checkin`. This is the entry point for creating a task, with the single task form (adults for any profiles, children for themselves).
4. **`checkin`.** Pick an open task, tap done (with 4 seconds to undo, from 0.8). A task with a question is first marked done, and then asked by the character in a bubble on its card (from 0.8). From 0.9, "⋯" on a card offers to retire it, within the limits in section 6, and a completed task shows the tokens it earned as icons, one per token, with no number **[proposal]**. Each task is a card with its "done" button in front of it (for a task with a question, "yes" and "no" come in a bubble after it). A static line before the list says to talk to the parents about a task done better than expected; it is not a button. The `board` lists its tasks as cards too.
5. **`home`.** The active profile with the theme's look for its kind (`homeVariants`), with the profile's symbol on its sail (the symbol is the avatar for now), a button under it to choose the symbol, its `party` and its pending collectibles; there is no reserve list. Each collectible in the `party` can be renamed (the nickname is trimmed, empty clears it, at most 30 characters). A `party` member is sent away, to the `showcase`, in one tap with no confirmation, because nothing is lost; a pending collectible joins the `party`, and with a full `party` the screen asks who leaves. No counts and no comparisons. The `party` list has a short line saying what it is. The owner chooses or changes the profile's symbol with the button under the boat, which opens a panel with the theme's suggestions first and then the animals and plants, with large squares, and a way to clear it; the chosen emoji goes onto the sail at once. An adult's symbol also shows on the big ship at the pier of the map, where the theme gives a place for it (`symbolAt` on the place). Where the theme does not place the symbol over its art, it is shown next to the name. The layered avatar (0.8) is not started.
6. **`vault`** (from 0.9). **[decided]** (product owner, 2026-10-23)
   - **The balance** of the active profile is at the top, as the token icon and a number: the only place it is shown (section 2).
   - **The depth:** the three tiers are three spots, from the entrance (`low`) to the deep end (`high`), each with its reward art, the theme's line inviting the person to go deeper, and its price. Their placement, art and wording are theme data (section 8); the engine only knows three tiers, ordered `low` to `high`.
     - A tier the person cannot afford is dimmed, still shows its price, and does nothing when tapped.
     - Tapping an affordable tier selects it and shows "open for N" (with the token icon). Tapping that spends the tokens and opens the reward. Tapping elsewhere cancels.
   - **Rewards already found** (from before 0.9) come under the depth, if any, each with its tier art, opening for free.
   - **After opening** the collectible is shown, and its owner chooses:
     - join the `party` (with a full `party`, the screen asks who leaves, and that one goes to the reserve); the name tag can be set right there;
     - let it go, straight to the reserve (the `showcase`);
     - or leave without choosing: it stays pending (`pendingDays`), so it is never lost by accident.
   - **"Recent":** the pending collectibles, with the same choices as the `home`.
7. **`showcase`.** The latest `showcaseSize` (10) from the reserve, from everyone, as a grid of art and name. Tapping one shows it larger, with its name and tier name. It never shows the owner, a date or a count. An admin can also rename any of them (moderation). A person who taps one of their own can bring it back into the `party`. **[decided]**
8. **Management (`admin` only).** Create and archive profiles (optionally choosing the new profile's symbol), list, edit and deactivate `taskDefs` (creating goes through the single task form), edit the tokens per level, the prices per tier, `partySize` (from 0.9; the reward odds editor is gone) and `showcaseSize`, **view tasks per profile** (open tasks, and those done in the last 7 days, as lists with the day, never counts or totals; built in 0.8), show the join link and QR code again. Profiles and worlds are always created through the app, with generated ids, never by editing data by hand. **[decided]**

Adults play like everyone else. The theme can give an adult's `home` a different look (in the pirate theme, a luxury ship).

## 8. Theme package and interface text

**A theme is a skin.** **[decided]** (ADR 0006) It changes only how the game looks and what things are called, never how the game works:

- **Same game:** every theme has the same mechanics, screens, rules, data and `ruleset`.
- **Data only:** a theme is data (JSON and art). It contains no code, and no code branches on which theme is active.
- **New theme = new folder:** adding a theme means adding a folder under `src/themes/`, with no code change and no data migration.
- **Nothing stored refers to theme text:** stored documents keep only `themeId`, `slot` and `tier`, never a themed name or text.

**Interface text has three layers.** **[decided]**

| Layer | Where | Contains | Status |
| --- | --- | --- | --- |
| 1. Neutral messages | `src/i18n/{locale}.json` | Every message the engine shows, with placeholders for themed nouns; no theme vocabulary | In place |
| 2. Theme vocabulary | the theme package | The visible names of the glossary roles (with gender), tier names, catalogue names and the `checkin` character's lines | In place |
| 3. Theme-specific wording | the theme package | Optional rewording of any neutral message in the theme's own voice, using terms that exist only in that theme | Future |

**Rules for layer 3 (future):**

- A theme may override a layer 1 message only by its key.
- A theme may define extra terms, but only for use in its own texts.
- The engine never shows a key or a term that layer 1 does not define, so a theme can change words but never add behaviour.

**Locales (future).** Layer 1 already has one file per locale. When a second locale arrives, each theme's texts (layers 2 and 3) move to one file per locale inside the theme. The structural part of `theme.json` (map, places, art, install data) stays language-neutral.

Folder `src/themes/{themeId}/` with:

- `theme.json` containing:
  - `id`, `name` and `locale` (`pt-PT`);
  - for each glossary role, the singular and plural visible name;
  - for each map place, its position, size and animation;
  - optionally, `map.moorings` per `kind`: a list of spots (`x`, `y`, `width`, `height` in percent of the map, like places), plus where on the boat the profile symbol goes (`symbolAt`: `x`, `y` and `size`, in percent of the spot) (section 7);
  - `profileSymbols`: the emoji suggested first when a profile chooses its symbol, neutral or themed, at least 12, without duplicates (the picker offers every emoji, so this is not a limit);
  - optionally, `homeSymbolAt` per `kind`: where the symbol goes over the `homeVariants` art on the `home` (`x`, `y` and `size`, in percent of the art);
  - `rewardArt`: the art of a reward, per tier;
  - from 0.9, the `token`: its name (a glossary role, with singular, plural and gender) and its icon (`tokenArt`);
  - from 0.9, `vault`: per tier, the line that invites going deeper (`invite`); optionally a background with its aspect ratio and one spot per tier, in percent, like map places. Without spots, the engine stacks the tiers from the entrance (`low`) to the deep end (`high`);
  - `homeVariants` per `kind`;
  - `install`: the name and colours of the installed app and its icons, from which one manifest per theme is built (ADR 0005);
  - the `checkin` character's lines (greeting, congratulations, doubt, farewell), short and fixed in number.
- `catalog`: a list of slots, each with `slot`, `tier`, `name` and art file.
- `assets/`: art.

Interface text that does not belong to a theme lives in locale files under `src/i18n/` (for now only `pt-PT.json`). These strings are neutral; when they need a themed noun, they use a placeholder (for example `{@reward}`) that the theme fills in. No visible interface text is hard-coded in TypeScript. **[decided]**

The engine reads the theme only through a typed `theme` module. A validator (`npm run validate-theme`) checks that the theme has enough slots in each `tier`, that no text is missing, and that every placeholder used in `src/i18n/` has a name in the theme. A collectible stores `slot` and `tier`, never the theme's name, so a new theme changes the look of everything already obtained without migrating data.

Theme art is CC0 (Kenney) or made for this repository, plus emoji; the children choose it from a short list. **[decided]** Every image file is listed with its author, source and licence in the theme's `credits.json` (only `CC0-1.0`, and `MIT` for art made for this repository), and `CREDITS.md` is generated from those files. Art is `webp` (`png` only for install icons), has no EXIF or XMP metadata, and stays within size budgets (map 1080 × 1920 and 400 KB; other art 512 × 512 and 80 KB, collectibles 60 KB; 2.5 MB per theme), all checked by `validate-theme`. **[decided]** If children's drawings are added later (radar), they belong to the theme they were made for, and before they are committed to the public repository they are checked for names, signatures or anything else that identifies the family. **[decided]** **[proposal]** The default theme for tests is a minimal theme (emoji and text), included in the repository.

## 9. Code architecture

```text
src/core/       pure domain: week, task generation, draw, party rules (no Firebase, no DOM)
src/data/       DataStore interface + adapters (firestore, memory)
src/ui/         screens and components (no framework)
src/i18n/       neutral interface text per locale
src/themes/     theme packages
firebase/       firestore.rules, firestore.indexes.json, rules tests
schemas/        JSON Schemas for theme, catalogue and locale files
scripts/        validate-theme, lint:theme-leak and their configuration
firebase.json   Firebase CLI configuration (at the root, where the CLI expects it)
.github/        workflows (build, tests, Pages deployment)
```

`DataStore` exposes intent-based operations (create world, join, list profiles, choose profile, observe a profile's tasks, create task, complete, open reward, move in the `party`...) and returns domain types. The interface and the schema are ready for a different database in the future. **[decided]**

## 10. Offline, concurrency and idempotency

- The app shell is cached by a service worker, so the installed app opens without a network (from 0.2).
- Firestore uses a persistent local cache with multi-tab support (`persistentLocalCache` with `persistentMultipleTabManager`; confirm the exact name in the installed SDK version). Writes are queued and resent automatically.
- **Do not use transactions for anything that must work offline:** they do not run without a network. Completing and opening are `writeBatch` operations. Uniqueness comes from deterministic ids plus "create, never replace" rules (section 5). If two devices complete or open the same task, the second batch is rejected as a whole and the client refreshes its state from the server.
- "Already exists" rejections while generating recurring tasks are expected and silent.
- **Tokens** (from 0.9) are a counter changed only with `increment()`, which the server applies to its own value. Each change is in the batch that justifies it, and the rules refuse a batch whose result is wrong or below 0. So offline devices of the same profile can earn and spend independently, and the server never accepts more spending than there are tokens (ADR 0008).
- A rejected write must never leave the interface in a false state: after a rejection, the screen reflects the server again.

## 11. Tests and verification

- **Domain (Vitest):** week and `periodKey`, including 25 October 2026 and the turn of the year into `2026-W53`; task generation, including no new copy while a task from the same `taskDef` is open, and no new task after an overdue one is completed in the current period; the slot draw; `party`, pending and reserve rules, including a `party` above a lowered `partySize`; from 0.9, tokens per level, prices, affordability and who can retire, and generation after a retired recurring task.
- **Draw simulation:** 10,000 slot draws per tier, checking that every slot of the tier comes out within a margin fixed in the test.
- **Firestore rules** (`@firebase/rules-unit-testing`, emulator). These run in the GitHub Action:
  - a non-member reads nothing;
  - a device writes nothing on documents of a profile that is not its active one;
  - only the owner completes a task, and an `admin` cannot complete someone else's;
  - a `done` task can never return to `open`, by anyone;
  - generating an existing recurring task again is rejected, both for the owner and for an `admin`;
  - a recurring task with an id that does not match its `defId`, `periodKey` and `profileId` is rejected;
  - a `reward` can only be created in the batch that completes its task (without `tokens`), or bought in the batch that spends its price;
  - from 0.9: tokens are earned only in the batch that completes the task, by its `tokens`; a purchase above the balance, the same tokens spent twice, and a device spending another profile's tokens are refused; only the allowed people retire, and a retired task never changes again;
  - `rewards` and `collectibles` are never replaced;
  - only an `admin` writes `taskDefs`;
  - nothing can be deleted.
- **`npm run lint:theme-leak`:** fails if it finds theme vocabulary anywhere in `src/`, `firebase/`, `schemas/` or `.github/` outside `src/themes/`. Documentation is not scanned. The forbidden terms are listed per theme in `scripts/theme-leak-terms.json` (for the pirate theme, for example: baú, bicho, marujo, pirata, farol, papagaio, tripulação, gruta, chest, crew, parrot, lighthouse, pirate, treasure).
- **Two real devices** in releases 0.2, 0.5, 0.6 and 0.9, including airplane mode (in 0.9: two phones of one profile spending the same tokens).
- **Second minimal theme** (emoji and text) working without touching code or data, in 0.2.

## 12. Releases

See `ROADMAP.md`. Each release is a minor version developed on its own `release/0.x` branch. A release only starts once the previous one meets its exit criteria.

## 13. Open decisions

| Topic | Status |
| --- | --- |
| Weekly guaranteed minimum | Off by default |
| Firestore read quota with real-time listeners | Measure in 0.2 against the free limits |

## 14. Out of scope (v1)

Push notifications; trading collectibles between people; family meter and paired tasks; dragging rewards on a grid; changing the theme of an existing world; several worlds per device; API integration (the `origin` field is reserved for it). Ideas that may come later are tracked in the radar in `ROADMAP.md`.
