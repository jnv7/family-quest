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

- **Converters.** One `FirestoreDataConverter` per collection does the following:
  - maps `Timestamp` ↔ `Millis` and adds `id` from the document id;
  - rejects documents whose `schemaVersion` it does not know. The document is skipped, and `console.error` is called with its path. It is never silently coerced.
- **Paths.** Collection paths are built in one module (`paths.ts`). No other file writes a path string.
- **Errors.** Firebase errors are mapped to `DataStoreError` codes in one function. `permission-denied` maps to `permission-denied`; `failed-precondition` and `unavailable` map to `unavailable`.
- **Active profile.** The adapter reads the device's membership (`members/{uid}`) to know the active profile, which it needs for `createdBy` and to know whose tasks to complete. It keeps the membership observed while a world is open.

### Memory (`src/data/memory/`)

- **Purpose:** tests, and UI development without Firebase.
- **Structure:** `createMemoryBackend()` is the shared "server". `createMemoryStore(backend, { uid, clock })` is one device, so two-device scenarios run in a single test.
- **Invariants:** at the level of `DataStore` operations, it enforces the same checks as `firestore.rules`:
  - admin rights and ownership (an admin-only operation from a device whose active profile is not an adult profile rejects with `permission-denied`);
  - create never replaces;
  - a `done` task never changes;
  - a reward only comes with its task's completion;
  - a collectible only comes with opening its reward.

  This way the contract tests pass on both adapters. The rules tests remain the authority on field-level detail.
- **Asynchrony:** `settled` resolves on a microtask, and observers are called asynchronously, like Firestore.

### Contract tests

`src/data/datastore.contract.ts` exports a test suite that takes a factory of `DataStore`s. It runs against the memory adapter with `npm test`, and against the Firestore adapter with the emulator in CI (the auth emulator is needed too). Every behaviour of the interface is tested there once, for both adapters.

## 6. Themes and interface text

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
| `{^...}` | Same as above, first letter upper-cased | `{^@reward.the}` → O baú |

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

Until 0.6, only themes listed in `scripts/validated-themes.json` are checked (the minimal theme). The pirate theme joins in 0.6.

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
- **GitHub Pages.** Vite `base: '/family-quest/'`. Routing uses the URL hash only (`#/join/<worldId>`, `#/board`, ...); there is no History API, because GitHub Pages cannot rewrite paths.
- **Service worker** (0.2): `vite-plugin-pwa` (**[proposal]**), precaching the app shell and the bundled themes. Firestore keeps its own data cache; the service worker never caches Firestore traffic.

## 8. Schema versions

- **Version 1.** Every document is written with `schemaVersion: 1` (`SCHEMA_VERSION` in `src/core/model.ts`). Readers accept only the versions they know.
- **Changing the shape:**
  1. write an ADR;
  2. bump `SCHEMA_VERSION`;
  3. make readers accept both N and N-1;
  4. upgrade a document lazily, the next time its owner writes it.

  There is no bulk migration, because there are no Cloud Functions.
- **Rules.** `firestore.rules` checks `schemaVersion == 1`. The rules change in the same commit as `SCHEMA_VERSION`.

## 9. Things the rules cannot guarantee

The client and the domain tests enforce these (`SPEC.md` §5):

- the child daily ad hoc limit;
- the opening day;
- the fairness of the tier and slot draws;
- the "one open task per definition" generation rule;
- that `partyIds` reference the profile's own collectibles.

The rules do enforce the party size (list length against `ruleset.partySize`).
