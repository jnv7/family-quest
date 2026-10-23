# family-quest

A family game that encourages planning, cooperation and task resolution.

**Status: pre-release.** Releases 0.1 to 0.9 are closed.

Family Quest is a PWA where each family member completes their daily, weekly, monthly and ad hoc tasks on their phone, and earns rewards in a themed collection game. It runs on GitHub Pages with Firebase (free Spark plan) and works offline.

## Documents

| File | Contents |
| --- | --- |
| [SPEC.md](SPEC.md) | Product and technical specification |
| [ROADMAP.md](ROADMAP.md) | Release plan and idea radar |
| [CHANGELOG.md](CHANGELOG.md) | What each version delivered |
| [docs/release-notes/](docs/release-notes/) | What each closed release means for its users |
| [docs/architecture.md](docs/architecture.md) | How the code is built: layers, data flow, adapters, themes |
| [docs/plans/](docs/plans/) | Delivery plan of the current release |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Coding, testing and git conventions; Definition of Done |
| [GOVERNANCE.md](GOVERNANCE.md) | Generic project rules |
| [CLAUDE.md](CLAUDE.md) | Context for Claude Code sessions |

## Install and run

Requires Node 24.

```sh
npm ci
npm run typecheck
npm test
npm run dev      # the app on a local server, using the real Firebase project
VITE_DATA=memory npm run dev   # the same, with no Firebase: one device, data kept in memory
npm run build    # production build, as published to GitHub Pages
```

The Firestore rules tests (`npm run test:rules`) and the Firestore adapter tests (`npm run test:emulator`) need Java for the emulators, so they run in CI. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Installing on a phone

Open the app's address in the browser, then:

- **iPhone (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app.

The installed app takes the name and icon of the family's theme. Install before joining a family: on iOS the installed app keeps its own storage, separate from the browser. The first launch needs the network; after that the app opens offline.

## Licence

[MIT](LICENSE)
