import { isSingleEmoji } from '../core/emoji';
import { DataStoreError } from './DataStore';

/**
 * Throws `invalid-argument` when `symbol` is not a single emoji. Shared by the adapters, so a
 * refused symbol never reaches a write. Clearing a symbol (`null`) needs no check.
 */
export function assertSymbolAllowed(symbol: string | null | undefined): void {
  if (symbol === null || symbol === undefined) return;
  if (!isSingleEmoji(symbol)) throw new DataStoreError('invalid-argument', 'A profile symbol must be a single emoji');
}
