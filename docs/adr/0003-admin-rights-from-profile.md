# 0003 — Admin rights come from the active profile

- **Status:** Accepted
- **Date:** 2026-10-18
- **Decided by:** product owner
- **Supersedes:** ADR 0001, decision 6, "Roles" (the admin role belonged to the device)

## Context

ADR 0001 gave the admin role to the device (`members/{uid}.role`). A device's identity is its anonymous `uid`, which is lost when the phone is replaced, when the installed app is removed, or when its storage is cleared. A world whose only admin device was lost would have no admin left, and no way to get one back.

## Decision

- **Admin by profile.** A device has admin rights while its active profile is a non-archived adult profile. No role is stored on the device; `members/{uid}` holds only `profileId`.
- **Bootstrap.** The batch that creates a world also creates the creator's adult profile and makes it the creating device's active profile.
- **No world loses its admin:**
  - a profile's `kind` is immutable;
  - adult profiles cannot be archived.

  Every world therefore always keeps at least one adult profile, and so an admin.

## Alternatives considered

- **A. Admin by profile** (chosen). The simplest option; a lost device loses nothing.
- **B. Admin by device, plus an admin recovery code** shown once at world creation. It is stored as a document nobody can read, and the rules check it only when a device promotes itself. It keeps admin rights away from a child who picks an adult profile, at the cost of a little more code and a secret the family must keep. Deferred to the radar.

## Consequences

- A child who picks an adult profile gets admin rights. For example, they could create ad hoc tasks for their own profile without the daily limit and farm rewards. This is accepted under the trust model of ADR 0001. The optional PIN in 0.8 only discourages it, because it locks the interface and not the rules.
- If this abuse becomes real, alternative B is the fix. It does not need a data migration: it adds a role check on top of the profile check.
- Each admin check in the rules costs one extra document read (the active profile), well within the rules' limits.
