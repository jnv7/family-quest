# Governance — Golden Rules for Software Projects

**Purpose:** governance principles and delivery discipline that do not depend on any specific project. Drop this file at the root of any new software project, next to its first ADR.

**Audience:** developers and architects — including Claude Code sessions — working on this or any other project that adopts these rules.

Anything specific to one concrete project (stack, domain, its own architecture decisions) is documented in that project, never in this file.

---

## 1. Architecture decision governance

- Major architecture decisions are always validated with the product owner before being implemented. Developers can and should propose, with a trade-off analysis, but do not decide alone.
- What counts as a "major decision" (non-exhaustive, grows by precedent): choice of stack/language, choice of persistence mechanism, contracts/boundaries between layers, identification schemes (primary keys, ID namespaces), persistent data formats, any change that breaks compatibility with existing data or contracts.
- When a technical proposal deviates from one of the principles in section 2, this is flagged explicitly to the product owner before proceeding — never worked around silently for convenience.
- Each accepted major decision is recorded as an ADR in `docs/adr/`.

## 2. Always-applicable software engineering principles

They apply by default. If one is not applicable, or applying it would imply effort/cost disproportionate to the benefit, this is validated with the product owner — it is not worked around silently.

- **Modularity / separation of concerns** — every module has a clear reason to exist.
- **Layer independence** — e.g. the presentation layer never accesses another layer's storage directly; it communicates through an explicit contract.
- **SRP (Single Responsibility Principle)** — each component changes for a single reason.
- **Abstraction of implementations** — program against contracts/interfaces, not against the concrete details of one specific implementation, when this does not imply premature over-engineering.
- **Configuration in plain text, readable and versionable** — parameters and business rules live in human-readable files (YAML/JSON/TOML), never obfuscated or binary by default.
- **Secrets never in plain text in the repository** — distinct from the previous point: credentials, keys and tokens never enter versioned files in plain text; they live in environment variables or a secrets manager.
- **Testability by construction** — code written to be testable (pure functions where possible, injectable dependencies), not tested after the fact by accident.
- **Explicit failure, never silent** — an unsupported or unexpected state fails clearly and legibly; it is never ignored or masked.

This list is designed to grow. Candidate principles are proposed with a justification, not added out of habit.

## 3. Versioning and delivery cadence

- A new product starts at `0.x` — there has never been a delivery considered "1.0".
- Each major unit of work (epic/phase, defined by the product owner and by roadmap order) corresponds to a **minor** version (`0.1`, `0.2`, `0.3`, ...). The next minor is not started while the current one is not complete or explicitly discontinued.
- **One release = one minor version = one branch** (`release/0.x`, §8). A release is identified only by its version number. A project does not keep a parallel numbering for its releases (such as `R0`, `R1`, `Phase 2`); a release may have a descriptive title (e.g. "0.2 — Core"), but the version is its only identifier in specs, roadmap, changelog, branches and tags. Partial deliveries inside a release are its patches (`0.2.1`, `0.2.2`, ...), never sub-labels such as `R1a`.
- Each partial, testable, functional delivery inside that minor is a **patch** (`0.1.1`, `0.1.2`, ...).
- Intermediate builds may exist below the patch level when needed, without each one being a "delivery" in the roadmap sense.
- When the whole scope defined for a minor is complete, that version is marked a **release candidate** before being considered closed.
- A release candidate is concluded when the product owner says so, and closing it is a single step: the release branch is merged into the default branch (§8); the release is tagged `v0.x`; release notes for the minor are written in `docs/release-notes/0.x.md`, for the product's users rather than as a copy of the changelog; the documentation is brought to the closed state; and the release branch is deleted. The next minor's branch starts only after that.
- Underlying principle: frequent, regular deliveries of always-testable functionality — never a "big bang" without intermediate milestones.
- Every delivery is recorded in `CHANGELOG.md`.

## 4. Roadmap and idea radar

- Work is always done in the order defined by the product owner, focused on what contributes to the current minor/release.
- Any idea, suggestion or improvement that comes up during work and does not fit the scope of the current minor is **neither implemented on own initiative nor discarded** — it is recorded in the project's roadmap/radar.
- The radar is reviewed periodically (cadence set by the product owner) to decide what moves into the next minor.
- A future minor is typically a subset of what was already on the radar, plus new items that only become clear at that point — the radar is never treated as complete or closed.

## 5. Roles

- **Product owner:** global architecture, product vision, priorities, roadmap order, validation of major architecture decisions, subjective acceptance criteria.
- **Senior developer/architect (including Claude Code):** implementation, tests, technical feasibility analysis, well-founded architecture proposals for validation, disciplined application of the principles in section 2, and explicit flagging whenever a deviation from those principles seems necessary.

## 6. Language

- The working conversation may happen in any language, but **every artifact is written in international English**: source code, identifiers, comments, documentation, ADRs, configuration keys, test names, commit messages, and issue/PR text.
- This applies from the first file of the project. Content received in another language is translated when it enters the repository.

## 7. Documentation

- Documentation is part of the work, not a follow-up: a change is not done until the documentation it affects is created or updated in the same change (see the Definition of Done in `CONTRIBUTING.md`).
- Every project creates from its first day, and keeps current, at minimum: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `ROADMAP.md`, `CHANGELOG.md`, `docs/adr/` and a `LICENSE` (chosen by the product owner, never assumed).
- Documentation records the *why* and the current state; it does not restate what the code already says.

## 8. Branching, commits and publishing

- Each new release — each new `0.x` minor version — is developed on its own new branch, named `release/0.x` (e.g. `release/0.1`), created from the default branch. Deliveries inside the release (`0.1.1`, `0.1.2`, ...) are commits on that branch.
- Whenever a piece of development is completed and its tests pass, it is committed and published (pushed to the remote), without waiting to be asked. A commit contains only what belongs to that change.
- Never commit or publish with failing tests, and never include secrets.
- When a release is closed (§3), its branch is merged into the default branch with a merge commit, never squashed or rebased, so every delivery stays visible in the history; then the branch is deleted, locally and on the remote.
- Rewriting published history (force push, amending published commits) requires explicit approval from the product owner.
- Every project has a remote from its first day: the repository is created (private unless the product owner decides otherwise) and `origin` is set before the first publish.
