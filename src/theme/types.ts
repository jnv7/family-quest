/** Types of the theme package files. They mirror `schemas/*.schema.json`; `validate-theme` enforces the schemas. */
import type { Tier } from '../core/model';
import type { Role } from './placeholders';

export type Gender = 'm' | 'f';

export interface Noun {
  singular: string;
  plural: string;
  gender: Gender;
}

export type Art = { image: string } | { emoji: string };

export interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
  art: Art;
  /** Where the active profile's symbol goes over this art, when the art is the profile kind's `homeVariants` art. */
  symbolAt?: SymbolAt;
  transition: { kind: 'move' | 'fade' | 'none'; durationMs: number };
}

export type PlaceRole = 'board' | 'checkin' | 'home' | 'vault' | 'showcase';

/** A fixed spot on the map, in percent of the map like a place. */
export interface Spot {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a boat shows its profile's symbol: centre and size, in percent of the spot (size is a share of its width). */
export interface SymbolAt {
  x: number;
  y: number;
  size: number;
}

/** Spots where the engine moors one boat per profile of a kind (SPEC.md §7). */
export interface KindMoorings {
  spots: Spot[];
  symbolAt: SymbolAt;
}

export type ThemeMoorings = Partial<Record<'adult' | 'child', KindMoorings>>;

/** How the installed app looks (ADR 0005). Icon paths are relative to the theme's folder. */
export interface Install {
  name: string;
  themeColor: string;
  backgroundColor: string;
  icons: Record<'small' | 'large' | 'maskable' | 'apple', { image: string }>;
}

/**
 * How the vault lays out the three tiers. Without `background`, `aspectRatio` and `spots` (all three or none)
 * the engine stacks the tiers from the entrance (`low`) to the deep end (`high`), top to bottom.
 */
export interface ThemeVault {
  /** One short line per tier that invites going deeper. */
  invite: Record<Tier, string>;
  background?: Art;
  aspectRatio?: number;
  spots?: Record<Tier, Spot>;
}

export interface ThemeFile {
  $schema: string;
  id: string;
  name: string;
  locale: 'pt-PT';
  roles: Record<Role, Noun>;
  tiers: Record<Tier, string>;
  /** Art of an unopened reward: the tier is visible before opening. */
  rewardArt: Record<Tier, Art>;
  /** Art of one token, shown in the balance, the prices and the earned row. */
  tokenArt: Art;
  vault: ThemeVault;
  map: { background: Art; aspectRatio: number; moorings?: ThemeMoorings };
  /** Emoji suggested first when a profile chooses its symbol: at least 12, unique, one emoji each. */
  profileSymbols: string[];
  /** Where a profile's symbol goes over its `homeVariants` art on the home, per kind; without it the symbol is shown by the name. */
  homeSymbolAt?: Partial<Record<'adult' | 'child', SymbolAt>>;
  places: Record<PlaceRole, Place>;
  homeVariants: { adult: Art; child: Art };
  install: Install;
  character: {
    art: Art;
    lines: { greeting: string[]; congrats: string[]; doubt: string[]; farewell: string[] };
  };
}

export interface CatalogSlot {
  slot: string;
  tier: Tier;
  name: string;
  art: Art;
}

export interface Catalog {
  $schema: string;
  slots: CatalogSlot[];
}

/** A loaded theme: `theme.json` plus its catalogue. */
export interface Theme extends ThemeFile {
  catalog: Catalog;
}

export interface LocaleFile {
  $schema: string;
  locale: 'pt-PT';
  messages: Record<string, string>;
}

