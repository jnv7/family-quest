# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses the versioning described in `GOVERNANCE.md` §3.

## [Unreleased]

## [0.9.6] — 2026-10-23

### Added

- Retiring an open task (ADR 0009). A task card has a "⋯" button at its far corner, shown only when the active profile may retire it (`canRetire`: an adult any open task, a child only an ad hoc task made for themselves). It opens a menu with "Retirar tarefa"; choosing it asks once in the card ("Retirar? Não volta a aparecer."), and confirming calls `retireTask`. The card leaves through the observers. It is in the check-in (own tasks) and in the adults' view (any open task of a profile), never on the board and never next to "Feito", so it adds no tap to completing a task.
- Retired tasks are hidden everywhere (the lists only read open tasks, and the adults' view's finished list reads only done ones). A retired recurring task is not generated again for its period and the next period creates its task as usual; one created today and retired still counts for a child's daily limit. Tests cover each.

## [0.9.5] — 2026-10-23

### Changed

- **The switch to tokens.** Completing a task earns tokens by its level (1, 2 and 4 by default), computed by `tokensFor` and written with `completeTask`; no reward is created. After "Feito" the check-in shows the tokens as a row of icons, with the number only in its text alternative for screen readers. Undo and "Não" still write nothing. A child's own task is now `low`, so it earns 1.
- **The vault is rewritten.** From top to bottom: the balance of the active profile (the one place a count is shown), "Já encontrados" (rewards from before 0.9, which open for free on any day, with "Abrir todos" for two or more), the depth, what has just been revealed, and the recent ones. The depth shows the three tiers as the theme lays them out, each with its art, invite line and price. A tier the balance covers can be chosen (it rises a little) and bought with "Abrir por N"; one it does not cover is dimmed and does nothing. The reveal offers the party controls (with who leaves when it is full, and a line when it is above its size), "Enviar para" the reserve, and "Mais tarde". When the server refuses a purchase because the tokens were spent on another device, the reveal goes away and a line says so.
- The weekly opening of rewards is gone: the vault no longer groups by week or waits for an opening day.

### Removed

- `completeTaskWithReward`, `drawTier`, `tierOddsFor`, `oddsProblem`, `canOpen`, `weekRange`, `weekRelation`, and `openingDay` and `tierOdds` from `Ruleset` (stored worlds keep them; nothing reads them). The contract suite now stores a reward from before 0.9 through a seed hook of each adapter, since nothing creates one.

## [0.9.4] — 2026-10-23

### Added

- Management has a "Recompensas" section (`src/ui/screens/tokenRules.ts`): six whole-number fields, the tokens each task level earns and the price of each tier, each beside the token icon. Saving runs `tokenRulesProblem` and says in one line what is wrong ("Os preços têm de subir: baixo < médio < alto."). It writes only the world's `tokensPerLevel` and `tokenPrices`, so it changes what is earned or bought from then on.
- Management has a party size field (1–10) beside the reserve size (`src/ui/screens/partySize.ts`). Lowering it takes nobody out of a party: a party above the size shows `party.overFull` when something tries to join, and can still lose members.

### Removed

- The reward odds section (`odds.ts`) and `worlds.setTierOdds`, with their tests. The stored `tierOdds` keep their last values, so completion draws as before until 0.9.5.

## [0.9.3] — 2026-10-23

### Added

- The theme package for tokens, with no visible change in the app yet. The schema (`schemas/theme.schema.json`) and `src/theme/types.ts` gain the `token` role (singular, plural and gender, so `{@token}`, `{@token.plural}` and the other forms work), `tokenArt`, and `vault`: an `invite` line per tier, and optionally a `background` with its `aspectRatio` and one `spot` per tier. `validate-theme` checks the three parts of the depth come together, lie within the background and do not overlap (`scripts/theme-vault.ts`); a vault background is budgeted like the map.
- Pirate theme: `tocha`/`tochas` (f) with 🔥, the three spots from the cave mouth to its deep end on a new SVG background made for this repository (MIT, in `credits.json`), invite texts, and 12 new collectibles (4 per tier, 8 per tier in all). Minimal themes: `moeda`/`moedas` 🪙 and `grão`/`grãos` 🌾, with the tiers stacked.
- `lint:theme-leak` also reports `tocha`, `tochas`, `torch` and `torches` outside `src/themes/`, with a test.

## [0.9.2] — 2026-10-23

### Added

- Domain for tokens and retiring, with no visible change: `src/core/tokens.ts` (`tokensFor`, `priceOf`, `canAfford`, `tokenRulesProblem`, `isPartySize`), `canRetire` in `src/core/tasks.ts`, `Ruleset.tokensPerLevel` (1/2/4) and `tokenPrices` (5/12/25), `Task.tokens`, `retiredAt`, `retiredBy`, status `retired`, `Reward.price`, and the limits `tokensPerLevelMax`, `tokenPriceMax` and `partySizeMax`. `checkPartyChange` reports `too-many` only when someone joins a party above the size.
- `DataStore`: `tasks.completeTask` (tokens, one batch with `increment()` on the profile), `tasks.retireTask`, `tokens.observeBalance` and `tokens.buyReward` (one batch: price, bought reward created opened, collectible), `worlds.setTokenRules` and `worlds.setPartySize`, in both adapters. The 0.8 completion is kept as `completeTaskWithReward`, which the check-in still calls.
- The memory adapter applies balances as server-side increments and has `setOnline` (tests only): an offline device sees its own writes on the state it left, and its batches commit in order when it returns. The Firestore decoders accept retired tasks, fill in the token rules of worlds stored before 0.9, and leave the balance out of `Profile`.
- Contract tests for earning, buying, the refused double spend of two offline devices of one profile (the exit criterion), the sum of two offline completions, retiring, and the new management values; the Firestore emulator suite runs them with `disableNetwork` and `enableNetwork`.

## [0.9.1] — 2026-10-23

### Changed

- `firebase/firestore.rules` for tokens and retiring (ADR 0008 and 0009), with no change in `src/`, so the app behaves as 0.8. A profile's `tokens` change only by `increment()` in the batch that completes the task named in `tokensFrom` (by that task's `tokens`, 1–10) or creates the reward named in `tokensFor` (by its `price`, 1–200), and never below 0. A reward may now be bought (created opened, with a `price`, together with its collectible). A task may move from `open` to `retired`, by an admin or by the owner on an ad hoc task they made for themselves. The party size is checked only when `partyIds` changes, and a party above a lowered size may only lose members. The 0.8 completion path is kept, and never together with tokens.
- New rules tests for earning, the 0.8 path, spending (including a double spend), the party above a lowered size and retiring. **The product owner must publish the rules** (`firebase deploy --only firestore:rules`) before 0.9.5 is pushed.

## [0.8.10] — 2026-10-22

### Added

- Big tasks that do not repeat (ADR 0007, the product owner's request). An adult can make a one-off task "big" in the single task form, and its owner can plan it like a task of a big definition, on any day from today on (no end). The task gets an optional `big: true` field, stored only when true; `validatePlan` and `createAdhocTask` (both adapters, with the contract suite) know it. The `firestore.rules` change lets a plan sit on a big ad hoc task, allows `big` on create (ad hoc only) and keeps it immutable, with new rules tests. **The product owner must publish the rules** (`firebase deploy --only firestore:rules`) before devices can create such a task.

## [0.8.9] — 2026-10-21

### Changed (product owner's review of 0.8, 2026-10-21)

- The `board` cannot complete anything: its "Concluir" button is gone (a task is completed only in the `checkin`), and with it the highlighted-task route (`#/checkin/<taskId>`).
- No "?" chip on task cards.
- The question comes after "done": a task with a question first shows "Feito", and then the character asks it in the bubble, with "Sim" (completes, with the 4 seconds to undo) and "Não" (the character answers kindly and the card goes back to "Feito"). A task with a question therefore takes three taps from the map; `SPEC.md` and `CLAUDE.md` now say so.
- The profile picker shows the profile's emoji in place of the picture (the initial when there is none), with the name alone and no boat.
- "Tarefas por perfil": tapping the chosen profile again deselects it.

## [0.8.8] — 2026-10-21

### Changed

- One look and feel. Every screen has the same top bar (`src/ui/bar.ts`): back on the left, the title, and at most one action on the right (the `board` has "Nova tarefa", management has the invite link); the "Voltar" buttons at the bottom are gone. The map keeps its own bar.
- The vault names weeks "Esta semana", "Semana passada", or the days ("19–25 out.", month names from the locale file), never an ISO week number (`weekRange` and `weekRelation` in `src/core/calendar.ts`), and offers "Abrir todos" when two or more can be opened; the reveals then stand one after the other.
- The profile picker shows each profile with the art of its kind and its symbol.
- Touch targets of at least 48 px in the lists, labels and group text at 16 px, a little more contrast on small text, and `prefers-reduced-motion` turns every animation and transition off.
- Words: "Trazer de volta" for bringing a collectible back from the reserve, "Fechar" for closing a reveal; the same verb for the same act (Concluir on the `board`, Feito in the `checkin`, Abrir, Enviar).

## [0.8.7] — 2026-10-21

### Added

- The adults' view of the family: management has "Tarefas por perfil". An admin picks a profile and sees its open tasks as the same read-only cards the profile sees, and what it finished in the last 7 days as a list with the day (`doneRecently` in `src/core/tasks.ts`). No counts, rankings or totals. It uses `observeTasks`, which adults may already read under the current rules, and is also where a task made by mistake is found. A child device is sent away from management as before.

## [0.8.6] — 2026-10-21

### Changed

- Names as labels: every collectible card (`home`, vault reveal and recent list, `showcase` detail) shows its name as a tag attached to the art: the nickname with the catalogue name small under it, or the catalogue name with a dashed "dar um nome" tag for whoever may name it. Tapping the tag edits it in place (Enter or leaving the field saves, Escape cancels, empty text clears it, `LIMITS.nickname` applies). At the reveal in the vault the tag reads "dá-lhe um nome". The separate "Mudar o nome" button is gone; an admin still renames from the showcase detail, and a child cannot rename another person's.

## [0.8.5] — 2026-10-21

### Changed

- The crew, end to end. `showcaseSize` is now 10 for new worlds, and management has a "Lugares {@reserve.in}" control (a whole number from 1 to 30) that writes the world's `ruleset`, so an existing world created with 30 can be set to 10. `DataStore`: `worlds.setShowcaseSize`, with both adapters and the contract suite (admin only, `invalid-argument` outside 1–30 before any write). No rules change: an admin may already update `ruleset`.
- A collectible beyond the newest `showcaseSize` of the reserve goes to "another island": it is no longer shown or offered anywhere, stays stored, and no screen says it is about to leave or shows a count.
- Words: moving a collectible to the reserve now says `{@reserve...}` (not `{@showcase...}`), and the pirate theme's `roles.reserve` is the tavern, so children read the same place for both (data only, ADR 0006).

## [0.8.4] — 2026-10-21

### Changed

- The board alert on the map (`boardAlert` in `src/core/alerts.ts`, replacing `planAlert`) has three neutral states, strongest first: `due` (a task planned for today, or for a day that has passed and is still open), `new` (an open task the profile has not seen: an ad hoc task made by someone else, or the first task of a recurring definition made since; daily repeats of a known definition are not new) and `soon` (planned for tomorrow). Never a number. New cards carry a "novo" marker on the `board` and in the `checkin`, and the `new` bubble shows a dot.
- "Last seen" is a per-device, per-profile time kept in `localStorage` (`fq.lastSeen.{worldId}.{profileId}`, through `WorldMemory`), set when the `board` or the `checkin` shows the list; with no value, nothing is new. No data or rules change.
- Task cards for a plan that is today or past use `planned-due`, and tomorrow's `planned-soon`.

## [0.8.3] — 2026-10-21

### Changed

- The character asks the question: a task with a question shows the character's small portrait and a speech bubble with the question and "Sim" / "Não" inside it (still two taps from the map). "Não" still makes the main bubble say a `doubt` line and leaves the task open.
- Undo for 4 seconds: after "Feito" or "Sim" the card shows "Desfazer" while the character already congratulates. The completion and its reward are written when the 4 seconds end, at once when the page is hidden (`visibilitychange`, `pagehide`) or the check-in is left, and "Desfazer" writes nothing, so nothing is ever reopened in the data. Delayed calls go through `AppContext.later`, which tests replace.

## [0.8.2] — 2026-10-21

### Changed

- One task card (`src/ui/taskCard.ts`) on the `board` and in the `checkin`: the title, large, then chips ("↻" and how it repeats, the plan, "?" when there is a question), with the one action first, in front of the title as the product owner asked in 0.7. The `board` action is now "Concluir", which opens the `checkin` (`#/checkin/<taskId>`) with that task highlighted; the plan control of a big task is a secondary link.
- One order everywhere: `sortForBoard` (`src/core/tasks.ts`) puts tasks planned for today or for a past day first, then tomorrow's, then new ones, then the rest, oldest first. The "new" group is filled in 0.8.4.

## [0.8.1] — 2026-10-21

### Changed

- One way to create a task (`src/ui/screens/taskForm.ts`, route `#/new-task[/<defId>]`), opened from the `board` and from management, and in edit mode for a recurring definition. An adult chooses who it is for with chips (each profile with its symbol, plus "Todos"; nothing is chosen by default), how often it repeats (once, daily, weekly, monthly), the difficulty, an optional question (collapsed) and, when it repeats, whether it is a big task. A child sees only the title. Once creates one ad hoc task per chosen profile ("Todos" means every active profile now); repeating creates one definition ("Todos" keeps `assignedTo: []`, which includes future profiles, and the form says so). Editing a definition does not offer "once". Management keeps only the list of definitions. `newTask.ts` and the creation half of `taskDefs.ts` are gone.

## [0.7.6] — 2026-10-21

Closes release 0.7.

### Added

- Load time: the product owner measured the first, uncached load on a phone and the installed app, and accepted it as under the 3 seconds of the exit criterion; no change was needed. The numbers were not recorded in the repository.
- For 0.8 to compare, the production build of this release: app code 132.5 kB (51.6 kB gzip), the Firestore SDK chunk 634.0 kB (187.5 kB gzip), the `collection` chunk 5.4 kB, the stylesheet 9.0 kB (2.5 kB gzip), and a service worker precache of 34 entries, 1029.8 KiB (the pirate map is 94 kB, the other pirate art 35 kB).

## [0.7.5] — 2026-10-20

### Added

- Moorings: a theme may declare spots on the map per profile kind, and the engine moors one boat (`homeVariants[kind]`) at each, one per non-archived profile, in creation order. Only the active profile's own boat opens their `home`; the others are decoration and show no name, count or collectible. A theme without moorings looks as before.
- Profile symbols: each profile can have one emoji from the theme's `profileSymbols` (every theme now has at least 12), shown on the sail of its boat. The owner chooses it in the `home`, and an admin can choose it when creating a profile. `DataStore`: `worlds.setProfileSymbol`, and `symbol` in `CreateProfileInput`, with both adapters and the contract suite. `Avatar` gains `symbol` (null when absent, no schema version change, no rules change).
- `validate-theme`: spots inside the map and not overlapping, `symbolAt` inside its spot, and each symbol a single emoji.
- The pirate theme moors up to eight children at a T-shaped pier, with the example boats removed from the map image; the child boat is a small ship with a plain sail that carries the symbol.

### Changed (product owner's review, 2026-10-20)

- Any emoji can be a symbol, not only the theme's: the `home` has a button under the boat that opens a panel with every emoji (the theme's `profileSymbols` become the suggestions shown first), and the chosen emoji goes onto the sail of the boat on the `home` at once (`homeSymbolAt` in the theme says where). The symbol is the avatar for now, so the empty "avatar" place is gone.
- The plan alert is a speech bubble with dots above the place, not over its art (bigger and bouncing for today, small for tomorrow), instead of a glowing rectangle.
- There is no reserve list on the profile: a collectible sent away leaves the `home` and is seen with the others in the `showcase`, so the "reserve" name no longer confuses. Nothing is deleted. The panel offers the theme's suggestions and then the animals and plants only, with larger squares.
- The adults' symbols show on the big ship at the pier for everyone, children included (`symbolAt` on the place, new and optional in the theme): up to three share the sail.
- The `party` list says what it is. Map places have bigger art and a quieter name; the pirate parrot and lighthouse are larger.

- The `checkin` and the `board` lists are cards that stand out from the page. In the `checkin` the button that completes a task is in front of it, and "I think I did better" is no longer a button: a static line before the list says to talk to the parents (`talkFlag` stays in the data, unset by the interface).
- From the `showcase`, a person can bring one of their own collectibles back into the party (and choose who leaves if it is full).

### Fixed

- A theme's picture of the map was drawn at 12% opacity, as the faint backdrop meant for emoji; images are now shown in full. Map places no longer have a border, and their art fits above the name.

## [0.7.4] — 2026-10-20

### Added

- Final art for the pirate theme, with no data change (slot ids and the theme id are untouched; the collectibles keep their emoji art for now): a painted map of one island with a pier, a path network and a forest, built from Kenney's Pirate Pack tiles (CC0); a lighthouse, cave, tavern and parrot, three chests (wood, silver, gold) for the rewards and an old pirate for the check-in, drawn for this repository as SVG (MIT); and a large ship with plain golden sails for adults and a rowing boat for children, from the Pirate Pack. The map shows a T-shaped pier with the adults' ship and two moored rowing boats. Credits are listed and `CREDITS.md` is regenerated.
- The showcase is now a "taberna" (the former "bar"), with the gender updated.

### Changed

- The map places have no panel behind their art any more; the name carries the contrast. This is the only change outside the theme, and it applies to every theme.

## [0.7.3] — 2026-10-20

### Added

- `npm run art:prepare`: turns source images kept outside the repository into the theme's `webp` art, fitted to the budget of their kind and with all metadata stripped.
- `credits.json` for every theme (schema `schemas/credits.schema.json`), and `CREDITS.md`, generated by `npm run credits` and checked in CI.
- `validate-theme` now checks the image files: formats, credits, licences, budgets (map, places and other art, collectibles, theme total) and EXIF/XMP metadata, naming the file that fails.

### Fixed

- The install icons of both minimal themes carried EXIF and XMP metadata (a generator's default tags, nothing personal); they were re-encoded without it.

## [0.7.2] — 2026-10-20

### Added

- The `showcase` place: a grid of the latest collectibles that went to the reserve, from everyone, newest first, up to `showcaseSize`. A tap shows one larger, with its name and tier name. It shows no owner, no date and no count. An admin can rename any item there (moderation).
- `DataStore`: `collectibles.observeShowcase` and `ShowcaseItem`, which has no owner field, in both adapters and the contract suite.

## [0.7.1] — 2026-10-20

### Added

- The `home` place: the profile with the theme's look for its kind, an empty labelled place for the avatar (0.8), the party, the pending collectibles and the reserve. A collectible can be renamed, sent to the reserve in one tap, or brought back, asking who leaves when the party is full. No counts, no comparisons.
- Admins can rename any collectible (moderation), without deleting anything.
- Domain: `displayName` and `collectionOf` (`src/core/collection.ts`), and the nickname rules. `DataStore`: `collectibles.setNickname`, with both adapters and the contract suite.

### Changed

- The choices to join the party are shared by the `vault` and the `home` (`src/ui/party.ts`).

## [0.6.4] — 2026-10-20

Closes release 0.6.

### Added

- The pirate theme package (id `pirates`; only its visible texts are Portuguese), as data only: names with gender, tier names, the lighthouse sage's lines, a catalogue of four collectibles per tier, and emoji placeholder art with lighthouse icons for the installed app. The product owner wrote the approved texts; the final art replaces the emoji in 0.7 with no data migration. It is offered when creating a world and joins `validate-theme`.

## [0.6.3] — 2026-10-20

Completes the scope of release 0.6.

### Added

- Party, pending and reserve. After a reveal, a new collectible can join the party at once, or wait ("later"). With a full party the screen asks who leaves, and that one goes to the reserve. A "recent" section in the `vault` lists the pending collectibles with the same choices. Nothing offers to delete or release a collectible.
- The automatic move: when the app opens, after a profile switch, and when the `vault` opens, pending collectibles older than `pendingDays` (counted in Lisbon days) go to the reserve, silently. The party is not rewritten by it.
- Domain: `addDays` (calendar arithmetic in UTC, tested across month and year ends and both daylight saving changes), `collectibleState`, `pendingToReserve` and `checkPartyChange` (party size, duplicates, ownership, and `toReserve`/`fromReserve` consistent with the new party).
- `DataStore`: `collectibles.arrangeParty` in one batch, with both adapters and the contract suite. The adapter runs the checks first and refuses with `invalid-argument` before any write.

## [0.6.2] — 2026-10-20

### Added

- Opening rewards. In the `vault`, a reward whose week is closed, or whose week is the current one from the opening day on (Sunday by default, Lisbon time), has an "open" button; before that it says, calmly, from which weekday it opens. Opening draws a catalogue slot of the reward's tier, plays a short neutral reveal (the same in every theme) and shows the collectible with its name and the theme's tier name. Each person opens only their own.
- One batch opens a reward and creates its collectible, so two devices of the same profile opening the same reward end with a single collectible: the second batch is refused, and its screen follows the true state.
- Domain: `canOpen`, tested across the opening day, a skipped Sunday, the daylight saving change and the turn of the year.
- `DataStore`: `rewards.openReward` and `collectibles.observeCollectibles`, with both adapters and the contract suite. `observeCollectibles` comes one delivery earlier than the plan listed, because the acceptance of opening reads the collectible. Any member can read collectibles, as the rules say (the showcase lists other people's); the interface never shows the owner.

## [0.6.1] — 2026-10-19

### Added

- Rewards are born with the completion. Completing a task now draws the reward's tier from the world's odds for the task's level, using `crypto`, and creates the reward in the same batch. The check-in says it went to the vault, still at two taps from the map. Tasks completed before this release produce no reward.
- The `vault` is a place on the map: it lists the person's own unopened rewards, grouped by week, each with the theme's art for its tier. It shows no counts for anyone else and compares nothing. Opening comes in 0.6.2.
- Reward odds in management: an admin edits, for each task level, the chance of each tier (integers that sum to 100). Existing worlds keep the odds they were created with, so this is how they receive new ones.
- Themes have a new required block, `rewardArt`, with the art of an unopened reward per tier. Both bundled themes carry emoji placeholders.
- Domain: `tierOddsFor`, `drawTier`, `drawSlot` and `oddsProblem`, with the draw simulation (10,000 draws per level, chi-square below 13.82).
- `DataStore`: `rewardTier` in `CompleteTaskInput`, `rewards.observeUnopenedRewards` and `worlds.setTierOdds`, with both adapters and the contract suite.

### Changed

- `SPEC.md`: the odds of the `low` and `high` levels are decided; the tier is visible before opening.

## [0.5.0] — 2026-10-20

Release 0.5: Children pilot. No code changes. The exit criteria were met, according to the product owner.

## [0.4.0] — 2026-10-20

Release 0.4: Adult pilot. No code changes. The exit criteria were met, according to the product owner.

## [0.3.5] — 2026-10-19

Completes the scope of release 0.3.

### Added

- The visual alert. The board place on the map glows softly when a planned task is due: strongly for today, gently for tomorrow (today wins). On the board, those tasks get a marker on their side. The effect is neutral, the same in every theme, respects reduced motion, and has no text and no notification. It goes out when the task is done or the plan is cleared.
- Domain: `planAlert` and `taskPlanAlert`, with the day turn-over tested in Lisbon time.

## [0.3.4] — 2026-10-19

### Added

- Planning big tasks. On the board, an open task from a big definition has a "plan" button: pick a day (from today to the last day of its week or month) and a trigger, written or chosen from three suggestions. The plan can be changed or cleared at will, with no penalty and no record.
- `setPlan` in the `DataStore` contract, with both adapters and the contract suite. Only the owner can set it, only on an open task from a big definition, and a day outside the period or a bad trigger is refused with `invalid-argument` before any write.
- Domain: `validatePlan` and `lastDayOfPeriod`. A task of a past period has no day left, so it cannot be planned.

## [0.3.3] — 2026-10-19

### Added

- Recurring tasks now appear. When the app opens, and after every profile switch, the device waits up to 5 seconds for the profile's tasks to come from the server (so it never generates from an empty cache), then creates the day's, week's or month's tasks the profile is due, once. Opening the app again creates nothing.
- `createRecurringTasks` and `whenTasksSynced` in the `DataStore` contract, with both adapters and the contract suite: one write per task, so one refusal never blocks the others; a refusal by the rules (another device got there first, or the definition changed) is silent.

### Changed

- The board and the check-in show at most one open task per recurring definition, the oldest; the others stay stored and appear as the first is completed (`visibleOpenTasks`).

## [0.3.2] — 2026-10-19

### Added

- The generation rule, as pure domain code (`recurringTasksToCreate`): which recurring tasks a profile needs now, for the current day, week or month in Europe/Lisbon. An overdue task completed today covers today; a second open task per definition is never planned; it is idempotent. Nothing creates the tasks yet (0.3.3).

## [0.3.1] — 2026-10-19

First delivery of release 0.3.

### Added

- Management has a "recurring tasks" section (admins only): list the definitions with the inactive ones dimmed, create and edit them (title, cadence, level, for whom, optional question, "big"), and deactivate or reactivate them. There is no delete.
- Data access for definitions: `TaskDefStore` in the `DataStore` contract (`observeTaskDefs`, `createTaskDef`, `updateTaskDef`), with the Firestore and memory adapters and the shared contract suite. A title or question over its limit is refused with `invalid-argument` before any write; a device on a child profile gets `permission-denied`.
- `taskDefProblem` in the domain, the one field check both adapters use.

## [0.2.6] — 2026-10-19

Closes release 0.2.

### Changed

- Creating ad hoc tasks uses the single definition of admin (`isAdmin`): an archived adult profile is not an admin.

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
