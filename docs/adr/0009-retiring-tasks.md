# 0009 — Retiring an open task

- **Status:** Proposed (tech lead, 2026-10-23), awaiting the product owner
- **Date:** 2026-10-23
- **Decided by:** product owner (the feature, and who can retire: decisions D8 and D10 in `docs/plans/0.8.md`); the data and rules design is the tech lead's proposal
- **Refines:** `SPEC.md` §4, §5 and §6 ("Retiring a task")

## Context

Nothing can be deleted, a task never reopens, and the rules allow no cancel. So a task created by mistake stays on the `board` forever (finding A9 in `docs/plans/0.8.md`). The product owner decided that an open task can be retired:

- an adult can retire any open task;
- a child can retire only an ad hoc task they created for themselves.

## Decision

1. **A third status, `retired`.** It is reachable only from `open`. Like `done`, it never changes again: every update rule already requires `status == 'open'`.
2. **Two optional fields, written only when retiring:**
   - `retiredAt`, a timestamp;
   - `retiredBy`, the `profileId` of whoever retired it, which is the device's active profile.

   They are absent on every other task, so no migration is needed.
3. **The rule.** It accepts only the change of `status` from `open` to `retired`, with exactly those two fields, when either:
   - the device is admin; or
   - the device is the owner, the task is `adhoc`, and `createdBy == profileId` (the child made it for themselves).
4. **Nothing is earned.** A retired task has no `tokens`, no reward and no `weekKey`. An open task has earned nothing, so nothing earned is lost (`SPEC.md` §2).
5. **Recurring tasks.** A retired recurring task keeps its deterministic id, so the same period is never generated again. Generation treats `retired` as neither open nor done, so the next period creates its task as usual.
6. **Hidden everywhere.** Every list in the interface leaves out retired tasks. They still count towards a child's daily ad hoc limit, so creating and retiring is not a way around it.

## Consequences

- **Older clients.** A 0.8 client never sees a retired task in its own lists, which read only `open` tasks. The adults' view on 0.8 lists every task of a profile, so it must tolerate an unknown status. 0.9 decoders accept `retired`, and the app updates itself on its next start (ADR 0004).
- **Deployment.** This is part of the same rules deploy as ADR 0008.
- **Tests.** The rules tests cover:
  - an admin retires anyone's open task;
  - a child retires their own self-created ad hoc task;
  - a child cannot retire a task given by an adult, or a recurring one;
  - nobody retires a `done` or `retired` task, or changes anything else at the same time;
  - a retired task can never be completed.
- **Not done.** Bringing a retired task back, and retiring a recurring definition (deactivating it already stops it).
