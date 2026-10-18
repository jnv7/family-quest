import type { Catalog, Theme, ThemeFile } from './types';

const themeFiles = import.meta.glob<ThemeFile>('../themes/*/theme.json', { eager: true, import: 'default' });
const catalogFiles = import.meta.glob<Catalog>('../themes/*/catalog.json', { eager: true, import: 'default' });

const folderOf = (path: string): string => path.split('/').at(-2) ?? '';

/**
 * Themes are bundled at build time. The files are trusted here: `npm run
 * validate-theme` checks them against their schemas in CI.
 */
const themes = new Map<string, Theme>();
for (const [path, file] of Object.entries(themeFiles)) {
  const catalog = Object.entries(catalogFiles).find(([p]) => folderOf(p) === folderOf(path))?.[1];
  if (!catalog) throw new Error(`Theme "${folderOf(path)}" has no catalog.json`);
  themes.set(folderOf(path), { ...file, catalog });
}

export function loadTheme(themeId: string): Theme {
  const theme = themes.get(themeId);
  if (!theme) throw new Error(`Unknown theme "${themeId}"`);
  return theme;
}

export { formatMessage, renderNoun, type MessageParams } from './format';
export type { Theme } from './types';
