# 0002 — Data access contract and write semantics

- **Status:** Accepted
- **Date:** 2026-10-18
- **Proposed by:** tech lead
- **Accepted by:** product owner, 2026-10-18

## Context

The app is local-first (ADR 0001, decision 5): writes happen offline, and the server may reject them hours later. The interface must never show a state the server refused (`SPEC.md` §10). A less experienced developer will implement the adapters and the UI, so the contract between the layers has to make the correct behaviour the easy one.

## Decisions

1. **Render from observers only.** The UI shows data only from `observe*` callbacks of the `DataStore`, never from its own copy. Firestore already rolls back rejected local writes in its observers, so this alone keeps the screen honest.
2. **Writes return `{ result, settled }`.** The write is applied locally at once, and `result` (for example a generated id) is available immediately. `settled` reports the server's verdict later. The UI never waits for `settled` to move on.
3. **Typed errors.** Every failure is a `DataStoreError` with a small fixed set of codes. Expected rejections (duplicate recurring generation) are handled silently and on purpose; everything else is reported.
4. **Device-clock timestamps.**
   - **Decision:** timestamps come from the device clock, and the week of a completion is computed on the device. `serverTimestamp()` is not used.
   - **Reason:** it is unknown while offline. The rules cannot verify time either way, so this does not weaken security.
5. **Two adapters, one contract suite.** The in-memory adapter enforces the same operation-level checks as the rules. One shared contract test suite runs against both adapters: the memory adapter locally, and the Firestore adapter against the emulator in CI.
6. **Interface text grammar.** Neutral messages refer to themed nouns through placeholders. The engine derives Portuguese articles and contractions from each noun's gender, so a message never hard-codes an article next to a themed noun (`docs/architecture.md` §6).

## Alternatives considered

- **Awaiting writes before updating the screen.** Rejected: offline, the screen would wait forever.
- **Optimistic UI state kept by the screens.** Rejected: every screen would need its own rollback logic, which is the most likely place for "false state" bugs.
- **A mock of the Firestore SDK** instead of an in-memory adapter. Rejected: it tests calls, not behaviour, and it would not exercise two devices.

## Consequences

- Adding an operation means changing three places in the same change: the interface, both adapters and the contract suite.
- The device clock can be wrong. A completion with a wrong clock lands in the wrong week. This is accepted under the trust model of ADR 0001.
- Every themed noun in a theme needs a `gender`.
