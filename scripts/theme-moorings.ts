/**
 * The checks on a theme's moorings and profile symbols (SPEC.md §7 and §8, docs/plans/0.7.md, 0.7.5).
 * Run by `validate-theme` after the schema, which already guarantees the shapes, sizes above zero,
 * at least 12 symbols and no duplicates.
 */
import { ThemeValidationError } from './theme-error.ts';

interface Spot {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface KindMoorings {
  spots: Spot[];
  symbolAt: { x: number; y: number; size: number };
}

const overlaps = (a: Spot, b: Spot): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function checkThemeMoorings(themeFile: string, theme: { map: { aspectRatio: number; moorings?: Record<string, KindMoorings> }; profileSymbols: string[] }): void {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  theme.profileSymbols.forEach((symbol, index) => {
    const graphemes = [...segmenter.segment(symbol)];
    if (graphemes.length !== 1 || !/\p{Extended_Pictographic}/u.test(symbol)) {
      throw new ThemeValidationError(themeFile, `/profileSymbols/${index}`, `"${symbol}" must be a single emoji`);
    }
  });

  for (const [kind, moorings] of Object.entries(theme.map.moorings ?? {})) {
    const base = `/map/moorings/${kind}`;
    moorings.spots.forEach((spot, index) => {
      if (spot.x + spot.width > 100 || spot.y + spot.height > 100) {
        throw new ThemeValidationError(themeFile, `${base}/spots/${index}`, 'lies outside the map (x + width and y + height must be at most 100)');
      }
      for (let earlier = 0; earlier < index; earlier++) {
        if (overlaps(moorings.spots[earlier]!, spot)) {
          throw new ThemeValidationError(themeFile, `${base}/spots/${index}`, `overlaps spot ${earlier} of the same kind`);
        }
      }
    });

    // The symbol is a square: `size` is a share of the spot's width, so its height, as a share of
    // the spot's height, depends on the proportions of the spot on the map.
    const { x, y, size } = moorings.symbolAt;
    moorings.spots.forEach((spot, index) => {
      const halfWidth = size / 2;
      const halfHeight = ((size / 2) * (spot.width * theme.map.aspectRatio)) / spot.height;
      if (x - halfWidth < 0 || x + halfWidth > 100 || y - halfHeight < 0 || y + halfHeight > 100) {
        throw new ThemeValidationError(themeFile, `${base}/symbolAt`, `does not fit inside spot ${index}`);
      }
    });
  }
}
