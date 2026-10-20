import { DataStoreError } from './DataStore';

/** Resolves the emoji a profile of a world may choose, from the world's theme id; null if the theme is unknown. */
export type ProfileSymbols = (themeId: string) => readonly string[] | null;

/**
 * Throws `invalid-argument` when `symbol` is not one of the theme's `profileSymbols`. Shared by the
 * adapters, so a refused symbol never reaches a write. Clearing a symbol (`null`) needs no check.
 */
export function assertSymbolAllowed(symbols: readonly string[] | null, symbol: string | null | undefined): void {
  if (symbol === null || symbol === undefined) return;
  if (symbols === null) throw new DataStoreError('invalid-argument', 'The theme of this world is unknown, so no symbol can be chosen');
  if (!symbols.includes(symbol)) throw new DataStoreError('invalid-argument', 'The symbol is not one of the theme\'s profile symbols');
}
