# Contributing

Project-specific engineering conduct. The generic rules are in `GOVERNANCE.md`, and the product is specified in `SPEC.md`.

## Language

- Everything in the repository is written in English: code, identifiers, comments, docs, ADRs, commit messages, issues and PRs.
- Visible interface text is European Portuguese and lives only in locale files:
  - `src/i18n/pt-PT.json` for neutral text;
  - `src/themes/{themeId}/theme.json` for themed text.
- No interface string is hard-coded in TypeScript.

## Coding standards

- TypeScript in strict mode. Vite, no UI framework. Modular Firebase SDK installed from npm.
- **`src/core/`** holds pure domain logic: no Firebase, no DOM, no clock or randomness read directly (inject them).
- **Data access** goes only through the `DataStore` interface (`src/data/`), which has two adapters: Firestore and in-memory.
- **Theme independence:** no theme vocabulary outside `src/themes/`. Code uses the neutral glossary in `SPEC.md` §3.
- **Dates and weeks** are always computed in `Europe/Lisbon`.
- **Offline:** no Firestore transactions for anything that must work offline. Use `writeBatch` with deterministic ids (`SPEC.md` §10).
- **Deletions:** nothing that a user earned is ever deleted, and no document type is deletable.
- **No secrets** in the repository. The `firebaseConfig` and the Firebase project id are public by design; security lives in the Firestore rules.

## Testing policy

- **Domain logic** in `src/core/` has unit tests (Vitest).
- **Firestore rules** have emulator tests (`@firebase/rules-unit-testing`) for every rule in `SPEC.md` §5, including the negative cases in §11. The Firestore emulator needs a Java runtime, so CI is the authoritative run of these tests; running them locally is optional and needs JDK 21 or later. Domain tests need only Node.
- **Before every commit:** `npm test`, `npm run lint:theme-leak` and `npm run validate-theme` pass. CI runs the same checks.
- **Bugs:** a fix comes with a test that fails without it.

## Git conventions

- `main` holds only closed releases. Each release is developed on `release/0.x` (see `ROADMAP.md`).
- Commit messages are in English, imperative mood, with a short subject line (for example `Add ISO week key for Europe/Lisbon`).
- Each commit contains one change, and is pushed as soon as its tests pass (`GOVERNANCE.md` §8).
- The product owner publishes the Firestore rules (`firebase deploy --only firestore:rules`). Contributors never deploy them.

## Definition of Done

A change is done only when all of these hold:

1. The code builds, and all tests and checks pass.
2. The documentation it affects is updated in the same change:

   | When | Update |
   | --- | --- |
   | Behaviour, data model or rules change | `SPEC.md` |
   | A major architecture decision is taken (`GOVERNANCE.md` §1) | a new ADR in `docs/adr/`, and its index |
   | Anything user-visible is delivered | `CHANGELOG.md`, under `[Unreleased]` or under the version being delivered |
   | A delivery or release completes, or scope changes | `ROADMAP.md` (current release, and checkboxes or status) |
   | An out-of-scope idea comes up | the radar in `ROADMAP.md` |
   | Setup, scripts or status change | `README.md` |
   | Working rules for Claude Code change | `CLAUDE.md` |

3. The commit is pushed to its `release/0.x` branch.

When a release closes, the steps in `GOVERNANCE.md` §3 apply, including the release notes in `docs/release-notes/0.x.md`.
