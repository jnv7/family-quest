# 0007 — Big tasks that do not repeat

- **Status:** Accepted
- **Date:** 2026-10-22
- **Decided by:** product owner (the feature, when it is built, and no end date for the plan). The data and rules design is the developer's proposal, accepted with it.
- **Refines:** `SPEC.md` §6 (planning a big task)

## Context

Until 0.8.9 only a task made from a **big recurring definition** could be planned with a day and a trigger. The single task form lets an adult make a one-off task, and the product owner wants a one-off task to be big too: "painting the fence" is big although it never repeats. A one-off task has no definition to carry `big`, and the rules let only tasks from a big definition hold a plan.

## Decision

1. **A new optional field on the task: `big`.** It is `true` only on an ad hoc task made big, and absent everywhere else. It is stored only when true, so existing documents and older app versions keep working with no migration. A recurring task is big when its definition is, as before.
2. **Rules** (`firebase/firestore.rules`):
   - `big` is an allowed key on create, optional, and when present it is `true` on a task whose `source` is `adhoc`;
   - a plan is valid on a task from a big definition (as before) or on an ad hoc task with `big == true`;
   - `big` is never changed after creation (it is outside every update rule's allowed keys).
3. **Plan range.** A big ad hoc task has no period, so its plan may be any day from today on, with no end (product owner). A task of a definition keeps its end at the last day of its period.
4. **Who sets it.** The single task form offers "big" to adults only, for any chosen profile; a child never sees it. The rules do not restrict it by role, like the other fields an admin chooses; the owner of the task plans it.

## Consequences

- **Rules deploy.** The product owner must publish the rules (`firebase deploy --only firestore:rules`) before a device can create a big one-off task. Until then, creating one is refused and the form's other options keep working. Plans on tasks that already exist are unchanged.
- **Tests.** `firebase/tests/firestore.rules.test.ts` covers the new cases (create big, refuse `big: false` and a big recurring task, plan only on big tasks, `big` immutable); CI runs them with the emulator.
- **Documentation.** `SPEC.md` (task table, rules, form), `docs/architecture.md` and `CHANGELOG.md`.
- **Not done.** Making an existing task big afterwards, and a plan end for one-off tasks, are not part of this decision.
