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
  transition: { kind: 'move' | 'fade' | 'none'; durationMs: number };
}

export type PlaceRole = 'board' | 'checkin' | 'home' | 'vault' | 'showcase';

export interface ThemeFile {
  $schema: string;
  id: string;
  name: string;
  locale: 'pt-PT';
  roles: Record<Role, Noun>;
  tiers: Record<Tier, string>;
  map: { background: Art; aspectRatio: number };
  places: Record<PlaceRole, Place>;
  homeVariants: { adult: Art; child: Art };
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

