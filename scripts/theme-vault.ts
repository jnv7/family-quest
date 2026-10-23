/**
 * The checks on how a theme lays out the vault (SPEC.md §7, docs/plans/0.9.md, 0.9.3).
 * Run by `validate-theme` after the schema, which already guarantees the shapes, the three invite texts
 * and the token noun and art. The depth is a choice made by data: no code looks at the theme id.
 */
import { ThemeValidationError } from './theme-error.ts';

interface Spot {
  x: number;
  y: number;
  width: number;
  height: number;
}

const TIERS = ['low', 'mid', 'high'] as const;

const overlaps = (a: Spot, b: Spot): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function checkThemeVault(
  themeFile: string,
  theme: { vault: { background?: unknown; aspectRatio?: number; spots?: Record<string, Spot> } },
): void {
  const { background, aspectRatio, spots } = theme.vault;

  // The three belong together: spots are placed on a background of known proportions.
  const given = [background !== undefined, aspectRatio !== undefined, spots !== undefined];
  if (given.some(Boolean) && !given.every(Boolean)) {
    const missing = (['background', 'aspectRatio', 'spots'] as const).filter((_name, index) => !given[index]);
    throw new ThemeValidationError(
      themeFile,
      '/vault',
      `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing: background, aspectRatio and spots go together, or none of them`,
    );
  }
  if (spots === undefined) return;

  TIERS.forEach((tier, index) => {
    const spot = spots[tier]!;
    if (spot.x + spot.width > 100 || spot.y + spot.height > 100) {
      throw new ThemeValidationError(themeFile, `/vault/spots/${tier}`, 'lies outside the background (x + width and y + height must be at most 100)');
    }
    for (const earlier of TIERS.slice(0, index)) {
      if (overlaps(spots[earlier]!, spot)) {
        throw new ThemeValidationError(themeFile, `/vault/spots/${tier}`, `overlaps the spot of tier "${earlier}"`);
      }
    }
  });
}
