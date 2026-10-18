# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses the versioning described in `GOVERNANCE.md` §3.

## [Unreleased]

### Changed

- Admin rights come from the device's active adult profile instead of a role stored on the device (ADR 0003). Creating a world also creates the creator's adult profile. Adult profiles cannot be archived, and a profile's kind never changes.

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
