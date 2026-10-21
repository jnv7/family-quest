# Architecture

How the code is built. `SPEC.md` says *what* the product does; this document says *how* the code does it. Where the two disagree, `SPEC.md` wins and this document is fixed.

## 1. Layers

```text
src/ui/      screens and components ──┐
                                      ├──> src/data/DataStore.ts (interface)
                                      └──> src/core/  (pure domain)
src/data/firestore/  ──> firebase SDK, src/core/model.ts
src/data/memory/     ──> src/core/model.ts
src/themes/, src/i18n/   data only (JSON + art), read through src/theme/
```

| Folder | May import | Must not import |
| --- | --- | --- |
| `src/core/` | other `src/core/` files | `firebase/*`, DOM APIs, `Date.now()`, `Math.random()`, `crypto` |
| `src/data/firestore/` | `firebase/*`, `src/core/` | `src/ui/` |
| `src/data/memory/` | `src/core/` | `firebase/*`, `src/ui/` |
| `src/theme/` | `src/core/`, theme and locale JSON | `firebase/*`, `src/data/` |
| `src/ui/` | `src/core/`, `src/theme/`, the `DataStore` interface | `firebase/*`, any adapter directly |

`src/main.ts` is the only place that picks an adapter and wires everything together.

The `src/core/` rule is what makes the domain testable: the clock and randomness are passed in as arguments (§4).

## 2. Data flow

**Reading.** The interface renders only from `observe*` callbacks of the `DataStore`. It never keeps its own copy of server data, and it never writes "what it expects" into the screen.

Firestore calls observers immediately with locally pending writes, and calls them again when the server rejects a write (the change is rolled back). Rendering only from observers is therefore enough to meet `SPEC.md` §10, "a rejected write never leaves the interface in a false state".

**Writing.** Every write returns `Write<T>` (`src/data/DataStore.ts`):

- `result` is available at once (for example a generated id);
- `settled` resolves on server acknowledgement, or rejects with a `DataStoreError`.

Offline, `settled` stays pending until the device reconnects, possibly days later. The interface **never awaits `settled` before moving on**. It attaches a handler:

| `error.code` | Meaning | Handling |
| --- | --- | --- |
| `already-exists`, or `permission-denied` on recurring task generation | Expected: another device got there first | Ignore silently |
| `permission-denied` elsewhere | The data changed under us (for example, the task was completed on another device) | Nothing to do; observers already show the server state. Log at `console.warn` |
| `invalid-argument` | A bug: the caller skipped domain validation | `console.error`; fix the caller |
| `unavailable`, `unknown` | Infrastructure | `console.error`, and show a neutral, non-blocking notice |

**Batches.** Multi-document changes (create world + membership; complete task + reward; open reward + collectible; party moves) are a single `writeBatch`. Never use `runTransaction`: it fails offline.

## 3. Ids

| Document | Id | Source |
| --- | --- | --- |
| world | 28 random characters from `[A-Za-z0-9]` | `crypto.getRandomValues`, rejection sampling (no modulo bias) |
| profile, taskDef, ad hoc task | Firestore auto-id (20 characters, `[A-Za-z0-9]`) | `doc(collection(...)).id`, generated offline |
| member | the device's `uid` | anonymous auth |
| recurring task | `{defId}_{periodKey}_{profileId}` | `recurringTaskId()` in `src/core/model.ts` |
| reward, collectible | the task's id | |

Auto-ids never contain `_`, so recurring ids stay unambiguous.

## 4. Time and randomness

- **Clock.** `type Clock = () => Millis`, injected. Production uses `Date.now`.
- **Device clock only.** All timestamps (`createdAt`, `doneAt`, `openedAt`, `obtainedAt`, `reserveAt`) come from the device clock and are stored as Firestore `Timestamp`. Do not use `serverTimestamp()`: it is unknown while offline, and the week of a completion must be fixed when the person taps "done".
- **Calendar.** Calendar keys (`DateKey`, `WeekKey`, `MonthKey`, ISO weekday) are computed by pure functions in `src/core/calendar.ts`, from `(instant: Millis, timeZone: string)`:
  - get the local calendar date with `Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts()`;
  - compute the ISO week from that calendar date with UTC date arithmetic (`Date.UTC`).

  Never add or subtract hours to emulate a timezone: that is exactly what breaks on 25 October. The test table is in `docs/plans/0.1.md`.
- **Randomness.** `type RandomInt = (maxExclusive: number) => number`, injected into `src/core/`. Production uses `crypto.getRandomValues` with rejection sampling; tests use a seeded or scripted sequence.

## 5. Adapters

### Firestore (`src/data/firestore/`)

- **Initialisation:**

  ```ts
  initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  ```

- **Converters** (`converters.ts`). One `encode*` and one `decode*` function per collection do the following:
  - map `Timestamp` ↔ `Millis`, and add `id` from the document id (or drop it when writing);
  - reject documents whose `schemaVersion` they do not know. The document is skipped, and `console.error` is called with its path. It is never silently coerced.
- **Paths.** Collection paths are built in one module (`paths.ts`). No other file writes a path string.
- **Errors.** Firebase errors are mapped to `DataStoreError` codes in one function. `permission-denied` maps to `permission-denied`; `failed-precondition` and `unavailable` map to `unavailable`.
- **Active profile.** The adapter reads the device's membership (`members/{uid}`) to know the active profile, which it needs for `createdBy`. It reads from the local cache first and falls back to the server (`readDoc`). The cache is authoritative for the membership because only this device writes it, and a stale read is harmless: the rules decide. Observing the membership instead was rejected because a listener started right after creating a world or joining can reach the server before the write and fail with `permission-denied`.
- **Reads before writes.** Operations that must read first (`createAdhocTask`, `completeTask`) do so from the cache, so they never wait for the network. They validate in the domain (`invalid-argument`) before writing anything.
- **Rewards.** `completeTask` is one `writeBatch`: the task update and `rewards/{taskId}`, which the rules accept only together; a second device completing the same task has its whole batch refused. The unopened-rewards query uses two equality filters (`profileId`, `openedAt == null`) and sorts in the adapter, so it needs no composite index.
- **Opening.** `openReward` is one `writeBatch` (the reward's `openedAt` and the collectible with the same id). The adapter reads the reward and the membership from the cache first, and refuses a reward that is not the device's or is already opened with `permission-denied`, the code the rules would give, so the screen never shows a false collectible. The opening day is judged by the caller with `canOpen`, not by the adapter.
- **Profile symbols.** `avatar.symbol` is an additive field: a profile read without it has `symbol: null`, and `schemaVersion` stays 1. `setProfileSymbol` and `createProfile` accept any single emoji (`isSingleEmoji` in `src/core/emoji.ts`, by `Intl.Segmenter`) and refuse anything else with `invalid-argument` before any write (`src/data/symbols.ts`); the theme's `profileSymbols` only suggest. The home's picker offers the theme's suggestions and then the animals and plants from `src/ui/emoji.json`, generated from the Unicode `emoji-test.txt` (Unicode terms of use): the fully qualified emoji of the group "Animals & Nature" up to Emoji 14.0, without skin-tone variants. Any single emoji is still accepted by the store. The rules only require `avatar` to be a map, so there is no rules change (one rules test proves the owner can write `avatar.symbol`).
- **Nicknames.** `setNickname` trims the text, turns empty into `null` and refuses more than `LIMITS.nickname` with `invalid-argument` before any write. The rules let the owner and any admin do it (moderation). The domain's `displayName` (`src/core/collection.ts`) throws for a slot the theme lacks; the interface (`nameOf` in `src/ui/party.ts`) reports it and shows the tier name instead of crashing.
- **Showcase.** `observeShowcase` queries `reserveAt != null` ordered by `reserveAt` descending with a limit of `showcaseSize`: an inequality on the field it orders by, served by the automatic single-field index, so no composite index is needed. Each document is mapped to a `ShowcaseItem` in the adapter, so `profileId` never reaches the interface (the rules still let members read it, by design).
- **Party.** `arrangeParty` is one `writeBatch`: `partyIds` on the profile and `reserveAt` on the collectibles. It reads what it needs from the cache first and runs `checkPartyChange`; the profile is not written when its `partyIds` do not change, so the silent move to the reserve cannot overwrite a party another device just edited.
- **Indexes.** The two task queries (open tasks by profile, all tasks by profile) need the composite indexes in `firebase/firestore.indexes.json`. The emulator does not require them, so a new query means a new index in the same change.
- **Joining.** The rules refuse a membership only when the world does not exist (or the device is already a member, which is checked first), so a refused join is reported as `not-found`.

### Memory (`src/data/memory/`)

- **Purpose:** tests, and UI development without Firebase.
- **Structure:** `createMemoryBackend()` is the shared "server". `createMemoryStore(backend, { uid, clock, randomInt })` is one device, so two-device scenarios run in a single test.
- **Invariants:** at the level of `DataStore` operations, it enforces the same checks as `firestore.rules`:
  - admin rights and ownership (an admin-only operation from a device whose active profile is not an adult profile rejects with `permission-denied`);
  - create never replaces;
  - a `done` task never changes;
  - a reward only comes with its task's completion;
  - a collectible only comes with opening its reward.

  This way the contract tests pass on both adapters. The rules tests remain the authority on field-level detail.
- **Asynchrony:** `settled` resolves on a microtask, and observers are called asynchronously, like Firestore.

### Contract tests

`src/data/datastore.contract.ts` exports a test suite that takes a factory of `DataStore`s. It runs against the memory adapter with `npm test`, and against the Firestore adapter with the emulators in CI (`npm run test:emulator`; each device is its own Firebase app, so it has its own anonymous user). Every behaviour of the interface is tested there once, for both adapters.

## 6. Themes and interface text

### A theme is a skin (ADR 0006)

These rules hold for every change; review and CI enforce them:

1. **No branching on themes.** No code outside `src/themes/` compares, switches on, or maps over a specific theme id. Code reads the active theme through `src/theme/` and uses only what the schema defines.
2. **One default, in configuration.** The only theme id named outside `src/themes/` and tests is the default theme, and it lives in one configuration value, not in logic.
3. **Schema-only data.** A theme provides data that the schemas in `schemas/` describe. A field the schema does not define does not exist for the engine. Theme files never contain code, expressions or behaviour flags.
4. **New capability = new schema field.** When a theme needs a new visual capability (for example, a new kind of transition), it is added to the schema and the engine for every theme at once, never for one theme. Example: the map's `moorings` (0.7.5). The theme declares spots, and the engine draws one boat per profile for any theme that declares them.
5. **Stable stored references.** Stored data references a theme only by `themeId`, `slot` and `tier`.

### Text layers

To get a visible string, `formatMessage(theme, key, params)` resolves it as follows:

1. **Today:** the message for `key` comes from `src/i18n/{locale}.json` (layer 1). Its `{@role...}` placeholders are filled from the theme's role nouns (layer 2).
2. **Future (layer 3):** first look for `key` in the theme's own messages, then fall back to `src/i18n/{locale}.json`. A theme term placeholder (proposed syntax: `{#term}`) resolves only from the same theme's terms. `validate-theme` checks that:
   - every overridden key exists in layer 1;
   - an override uses only the runtime parameters that the layer 1 message uses;
   - every `{#term}` is defined.
3. **Errors:** a missing key, role, form or term throws (explicit failure). A raw placeholder is never shown.

Future layout once there is more than one locale:

```text
src/i18n/{locale}.json                      layer 1
src/themes/{themeId}/theme.json             structure only: map, places, art, install, gender of nouns
src/themes/{themeId}/locales/{locale}.json  layers 2 and 3 for that locale
```

### Files

```text
src/themes/{themeId}/theme.json     validated by schemas/theme.schema.json
src/themes/{themeId}/catalog.json   validated by schemas/catalog.schema.json
src/themes/{themeId}/assets/        art referenced from the two files above
src/i18n/pt-PT.json                 validated by schemas/locale.schema.json
src/theme/                          the typed module that loads and formats all of it
```

Themes are bundled at build time (`import.meta.glob('../themes/*/theme.json', { eager: true })`); there is no runtime download.

### Message placeholders (in `src/i18n/pt-PT.json`)

| Syntax | Meaning | Example (pirate theme, `reward` = "baú", m) |
| --- | --- | --- |
| `{name}` | A runtime value passed by the caller | `{name}` → "Rita" |
| `{@reward}` | The role's singular | baú |
| `{@reward.plural}` | The role's plural | baús |
| `{@reward.the}` / `{@reward.thePlural}` | Definite article + noun | o baú / os baús |
| `{@reward.a}` | Indefinite article + noun | um baú |
| `{@reward.of}` / `{@reward.ofPlural}` | "de" + article + noun | do baú / dos baús |
| `{@reward.in}` / `{@reward.inPlural}` | "em" + article + noun | no baú / nos baús |
| `{^...}` | Same as above, first letter upper-cased (also works on `{name}`) | `{^@reward.the}` → O baú |

Articles come from the noun's `gender`:

| `gender` | Article forms |
| --- | --- |
| `m` | o, os, um, do, dos, no, nos |
| `f` | a, as, uma, da, das, na, nas |

A message must never hard-code an article next to a role, so the same message works for every theme.

### `validate-theme` checks

Run for every folder in `src/themes/`; it fails on the first error, with the file and the JSON path.

1. **Schemas.** `theme.json`, `catalog.json` and `src/i18n/pt-PT.json` match their schemas (Ajv, draft 2020-12).
2. **Theme id.** The folder name equals `theme.json` `id`.
3. **Slots:**
   - slot ids are unique;
   - every tier has at least `MIN_SLOTS_PER_TIER` slots (**[proposal]** 3).
4. **Art.** Every `image` path exists in the theme folder.
5. **Placeholders:**
   - every `{@role...}` used in `src/i18n/pt-PT.json` names a known role and form;
   - every `{^...}` wraps a valid placeholder.
6. **Image files** (`scripts/theme-assets.ts`; sizes read from the file bytes by `scripts/image-info.ts`, so no image library is needed to validate):
   - **formats:** raster art is `webp`; `png` only under `assets/icons/`; `svg` is allowed for vector art;
   - **credits:** every file in `assets/` has exactly one entry in the theme's `credits.json` (schema `schemas/credits.schema.json`), and every entry points to an existing file;
   - **licences:** only `CC0-1.0`, and `MIT` for art made for this repository;
   - **budgets:** map background at most 1080 × 1920 and 400 KB; place art, `homeVariants`, character and reward art at most 512 × 512 and 80 KB; collectible art at most 512 × 512 and 60 KB; all the art of a theme at most 2.5 MB. The kind of a file comes from where the theme uses it;
   - **metadata:** no EXIF or XMP in any `webp` or `png`.
7. **Moorings and symbols** (`scripts/theme-moorings.ts`): every spot lies inside the map; spots of one kind do not overlap; `symbolAt` fits inside each spot of its kind (the symbol is a square whose side is `size` percent of the spot's width, so the check uses the map's aspect ratio); every `profileSymbols` entry is a single emoji (`isSingleEmoji`); `homeSymbolAt` and a place's `symbolAt` fit inside the art. At least 12 symbols and no duplicates come from the schema.

Only themes listed in `scripts/validated-themes.json` are checked: both minimal themes and, since 0.6, the pirate theme.

### Art tooling

- `npm run art:prepare -- <folder>` (`scripts/art-prepare.ts`, with `sharp` as a dev dependency) converts downloaded source images, kept outside the repository, into the theme's `assets/`: fitted inside the budget of their kind, as sRGB `webp`, with all metadata stripped, lowering the quality until the file fits. A mapping file `art.json` in that folder says which source becomes which target and of which kind. It does not write credits: the developer adds the new files to `credits.json`.
- `npm run credits` (`scripts/credits.ts`) writes `CREDITS.md` at the repository root from every validated theme's `credits.json`, grouped by theme and by author. CI runs it with `--check`, and a unit test does the same, so the file cannot go stale.

### `lint:theme-leak`

- **Scanned:** every file under `src/` (except `src/themes/`), `firebase/`, `schemas/` and `.github/`.
- **Rule:** case-insensitive, whole-word match against the forbidden terms. These are listed per theme in `scripts/theme-leak-terms.json`, so a new theme adds its own terms.
- **Output:** the file, line and term of every match; exit code 1 if any.

## 7. Environments and configuration

| Mode | How | Use |
| --- | --- | --- |
| Memory | `VITE_DATA=memory npm run dev` | UI development; needs nothing but Node |
| Emulator | `VITE_DATA=emulator`, plus `firebase emulators:start` (needs Java) | Optional local integration |
| Production | default build | GitHub Pages |

- **`firebaseConfig`** lives in `src/data/firestore/config.ts`. It is committed: it is public by design (ADR 0001); the product owner provides the values.
- **Emulator ports:** Firestore 8080, Auth 9099. The project id is `demo-family-quest`, so no real project can be touched by mistake.
- **GitHub Pages.** Vite `base: '/family-quest/'`. The live address is `https://www.jnvasconcelos.com/family-quest/`: the owner's GitHub Pages site has a custom domain, and `jnv7.github.io` redirects to it. The code never hard-codes the address; links are built from `location`. The origin defines each device's local storage, its anonymous sign-in and its installed app. Changing or dropping the custom domain would make every device join again (no data is lost), so treat the domain as stable and decide any change in an ADR. Routing uses the URL hash only (`#/join/<worldId>`, `#/board`, ...); there is no History API, because GitHub Pages cannot rewrite paths.
- **Service worker** (0.2.4, ADR 0004): `vite-plugin-pwa` precaches the app shell and the bundled themes' art. Firestore keeps its own data cache; the service worker never caches Firestore traffic. The manifest is built by `scripts/pwa-manifest.ts`, with its text from the locale file, and the icons are in `public/icons/`. The worker is generated only by `npm run build`, so `npm run dev` never registers one.

## 8. Schema versions

- **Version 1.** Every document is written with `schemaVersion: 1` (`SCHEMA_VERSION` in `src/core/model.ts`). Readers accept only the versions they know.
- **Changing the shape:**
  1. write an ADR;
  2. bump `SCHEMA_VERSION`;
  3. make readers accept both N and N-1;
  4. upgrade a document lazily, the next time its owner writes it.

  There is no bulk migration, because there are no Cloud Functions.
- **Rules.** `firestore.rules` checks `schemaVersion == 1`. The rules change in the same commit as `SCHEMA_VERSION`.

## 9. Interface

No framework (`CONTRIBUTING.md`). `src/main.ts` picks the adapter and calls `startApp` (`src/ui/app.ts`).

- **Screens** are functions `(ctx, root, params) => Dispose` in `src/ui/screens/`. A screen builds its elements with `h()` (`src/ui/dom.ts`), subscribes to observers, and returns the function that stops them. The router calls it on every route change.
- **`AppContext`** (`src/ui/context.ts`) is everything a screen may use: the `DataStore`, the theme, `text()`, `go()`, `notify()` and `settle()`. `settle()` applies the table in §2 to a write's late verdict.
- **Observer failures.** A screen never leaves, or forgets the world, because an observer failed. `observeWithRetry` (`src/ui/observe.ts`) shows a message with a retry button, and the details go to `console.error`. Only `permission-denied` on the world's own data (the device is no longer a member) clears the remembered world.
- **Rendering.** Screens render from observers only. Who the device is (`observeSelf`, `src/ui/self.ts`) comes from the memberships and profiles, so a refused profile choice sends the device back to the picker by itself.
- **Routes** are hash routes (`src/ui/routes.ts`): `#/`, `#/create`, `#/join[/<worldId>[/<themeId>]]`, `#/install`, `#/profiles`, `#/map`, `#/board`, `#/checkin`, `#/vault`, `#/home`, `#/showcase`, `#/new-task`, `#/manage`, `#/share`. Unknown hashes are the start page. Screens that need a world send the device to the start page if it has none. The route `map` is the main screen, and each of its five places has its own route.
- **Navigation** (`src/ui/navigation.ts`) is injected, so the app never touches `location` directly. The browser version uses the address bar; the in-memory version gives each device of a test its own, so several devices can run in one test.
- **The theme is dynamic.** `ctx.theme` is whatever the theme currently is, and `ctx.setTheme()` changes it and redraws. It is set from a join link, from the choice when creating a world, from the launch address (`?theme=`) of an installed app, and from the world itself, which wins and is remembered by `WorldMemory` so the next launch has the right names from the first frame. `applyThemeToPage` swaps the page's manifest, iOS icon and name, and colours.
- **Installing** (ADR 0005). `src/ui/install.ts` detects the platform and keeps the browser's install event from the moment the app starts; `src/ui/installOffer.ts` draws the offer (a button, or the iOS steps) only once the theme is known. One manifest per theme is built by `scripts/theme-manifests.ts`, with the paths in `src/theme/installPaths.ts` shared with the app.
- **The map** (`src/ui/screens/map.ts`) places the five places where `theme.json` says, in percent of the map. A place without a destination yet is drawn dimmed and disabled. Tapping one plays the theme's transition (`src/ui/transition.ts`: `move`, `fade` or `none`, skipped when the person prefers reduced motion) and then navigates. Art is an emoji or an image from the theme's folder (`src/ui/art.ts`).
- **The check-in** (`src/ui/screens/checkin.ts`) puts the completing action on the task itself, which is how a completion stays at two taps from the map. The character's lines come from the theme and are picked with the injected `randomInt` (`src/ui/lines.ts`).
- **The draw.** `src/core/draw.ts` is pure (`tierOddsFor`, `drawTier`, `drawSlot`); the screens pass the injected `randomInt`, which production builds from `crypto.getRandomValues`. The check-in draws the reward's tier when a task is completed; the `vault` lists the unopened rewards by week, with `theme.rewardArt`, opens them (drawing the slot with `drawSlot`) and draws the reveal from the collectibles the store reports, so a device that lost the race shows the winner's collectible; management edits the world's `tierOdds` (`src/ui/screens/odds.ts`), validated with the rule `drawTier` uses.
- **Moorings.** `mooredBoats` (`src/core/moorings.ts`) turns the world's profiles into boats: non-archived profiles of each kind that has moorings, in `createdAt` then `id` order, one per spot, the extras left out. A boat carries no profile id and no name. The map (`src/ui/screens/map.ts`) draws them from the profiles that `observeSelf` already reports, after the theme has rendered, and puts them before the places in the DOM. Only the active profile's own boat is a button (it opens the `home`); the others are `aria-hidden` with `pointer-events: none`. A theme without moorings gets no extra element, so its map is as before. A place with `symbolAt` (the big ship) draws its art in a slot and puts over it the symbols of the non-archived profiles of the kind whose `homeVariants` art it is (up to three, in creation order, smaller as they grow in number), so everyone sees the adults' symbols on the big ship.
- **Party controls.** `src/ui/party.ts` holds the choices shared by the `vault` and the `home` (join, who leaves, to the reserve); every move is one `arrangeParty`.
- **The reserve.** `src/ui/reserve.ts` moves old pending collectibles to the reserve. A keeper started by the app does it once after the app opens and after every profile switch, whichever screen is showing; the `vault` does it again when it opens.
- **Ad hoc task limit.** The child's daily limit is a pure function in `src/core/tasks.ts`. The form (`src/ui/screens/newTask.ts`) combines three observers (the world's ruleset, who the device is, and the profile's own tasks) and only enables the button when the rule allows it. It shows no counts, only a friendly message when the limit is reached.
- **Which world.** The device remembers its world id in `localStorage` (`src/ui/worldMemory.ts`; memory only if storage is blocked). On launch, a remembered world skips the start page: if the membership is gone the id is forgotten, and if the membership cannot be checked (offline, nothing cached) the device trusts the saved world.
- **QR code.** `qrcode-generator` computes the module matrix; `src/ui/qr.ts` draws it as an SVG element. Black on white in any colour scheme, so phones can scan it.
- **Tests.** Screen tests run in `happy-dom` against the memory adapter, with several devices sharing one backend (`src/ui/app.test.ts`).
- **Running without Firebase.** `VITE_DATA=memory npm run dev` uses the memory adapter for a single device.

## 10. Things the rules cannot guarantee

The client and the domain tests enforce these (`SPEC.md` §5):

- the child daily ad hoc limit;
- the opening day;
- the fairness of the tier and slot draws;
- the "one open task per definition" generation rule;
- that `partyIds` reference the profile's own collectibles.

The rules do enforce the party size (list length against `ruleset.partySize`).
