# 0006 — A theme is a skin, and interface text has three layers

- **Status:** Accepted
- **Date:** 2026-10-19
- **Decided by:** product owner (principle and layers). The mechanism for layer 3 is a tech lead proposal, to be confirmed when it is built.
- **Refines:** ADR 0001, decision 7 (theme independence)

## Context

ADR 0001 kept theme vocabulary out of the engine. As themes grow (installed app name and icon, theme-specific wording, more than one language later), it must stay clear that a theme can change how the game looks and speaks, but never how it works. Otherwise every new theme would become a code change.

## Decision

1. **A theme is a skin:**
   - **Same game:** it changes appearance and words only. Mechanics, screens, rules, data and the ruleset are the same for every theme.
   - **No code:** a theme is data validated by the schemas in `schemas/`. No code branches on a specific theme id.
   - **New theme = new folder:** adding a theme is adding a folder, with no code change and no data migration.
2. **Three layers of interface text:**

   | Layer | Content | Where |
   | --- | --- | --- |
   | 1 | Neutral messages, with placeholders for themed nouns | `src/i18n/{locale}.json` |
   | 2 | Theme vocabulary: role nouns with gender, tier names, catalogue names, character lines | The theme package |
   | 3 (future) | Theme-specific wording: overrides of layer 1 messages by key, plus terms that exist only in that theme | The theme package |

3. **Layer 3 cannot add behaviour.** Overrides use existing keys only, and theme terms are usable only in the theme's own texts. The engine never asks for a key or term that layer 1 does not define.
4. **Locales.** When a second locale arrives, each theme's texts (layers 2 and 3) move into one file per locale inside the theme. The structural part of `theme.json` stays language-neutral.

## Consequences

- A theme that needs a new visual capability gets it through a new schema field, added for all themes at once.
- `validate-theme` grows with layer 3: it checks override keys, override parameters and theme terms.
- A default theme id may appear in exactly one configuration value. Today `src/main.ts` holds it as a constant; this is acceptable until worlds always carry their theme, and it must not spread.
- Layer 3 and per-locale files are not built now; they are on the radar in `ROADMAP.md`.
