# Family Quest — context for Claude Code

@GOVERNANCE.md
@CONTRIBUTING.md

A web app (PWA) for one family: daily, weekly, monthly and ad hoc tasks, completed on the phone, with rewards in a themed collection game. A static frontend on GitHub Pages, with data in Firebase (Spark plan, no cost).

**The full specification is in `SPEC.md`; read it before writing code.** How the code is built is in `docs/architecture.md`. The release plan is in `ROADMAP.md`, with the current release's deliveries in `docs/plans/`. Architecture decisions are in `docs/adr/`. This file holds only the working rules.

## Non-negotiable rules

1. **A theme is a skin.** A theme changes only looks and words, never behaviour (ADR 0006, `docs/architecture.md` §6).
   - **Vocabulary:** nothing outside `src/themes/` may contain theme vocabulary (entity names, texts, ids, collection names or Firestore rules). Code uses the neutral glossary in `SPEC.md` §3, and `npm run lint:theme-leak` must pass.
   - **No branching:** no code branches on a specific theme id.
   - **Data only:** themes are data only.
   - **Text:** all visible text comes from the locale files and the theme.
2. **Public repository.** Never write secrets, service account keys, passwords, people's names, ages or any personal family data here. The `firebaseConfig` is public by design; security lives in the Firestore rules.
3. **No cost.** Spark plan: no Cloud Functions, no Cloud Storage. If anything asks for billing, stop and ask.
4. **Local-first.** Everything works offline and syncs later. Firestore transactions do not work offline: use `writeBatch` with deterministic ids (`SPEC.md` §10).
5. **Nothing earned is deleted.** No deletion of rewards or collectibles.
6. **No friction.** Completing a task takes at most 2 taps from the map (3 for a task with a verification question: done, then the answer). Never show counts, rankings or comparisons between people. Each person completes only their own tasks, and a completed task never reopens.
7. **Language.** Every repository artefact is in English. The interface is in European Portuguese, and its text lives only in locale files (`src/i18n/`, and `theme.json` in each theme).

## Keeping documentation current

Documentation is updated in the same change as the code, following the Definition of Done table in `CONTRIBUTING.md`. In particular:

- update `CHANGELOG.md` with every delivery;
- update `ROADMAP.md` when a delivery completes or an out-of-scope idea comes up (add it to the radar);
- write an ADR for every major decision.

## Working with the product owner

- Conversation is in Portuguese. Be direct. If a decision in `SPEC.md` looks wrong or inconsistent, say so and propose an alternative instead of silently following it.
- Items tagged **[proposal]** in `SPEC.md` are not decisions and may change. Items tagged **[decided]** change only with the product owner.
- Do not create accounts or introduce credentials. The product owner publishes the Firestore rules (`firebase deploy --only firestore:rules`).
- Do not add plugin systems, frameworks or mechanics outside the scope of the current release.
