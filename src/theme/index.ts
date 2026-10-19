import type { Catalog, Theme, ThemeFile } from './types';

const themeFiles = import.meta.glob<ThemeFile>('../themes/*/theme.json', { eager: true, import: 'default' });
const catalogFiles = import.meta.glob<Catalog>('../themes/*/catalog.json', { eager: true, import: 'default' });

const assetUrls = import.meta.glob<string>('../themes/*/assets/**/*', { eager: true, query: '?url', import: 'default' });

/** The URL of an image of the theme, given its path in `theme.json` (such as `assets/map.webp`). */
export function assetUrl(themeId: string, path: string): string {
  const url = assetUrls[`../themes/${themeId}/${path}`];
  if (!url) throw new Error(`Theme "${themeId}" has no asset "${path}"`);
  return url;
}

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

/** Every bundled theme, in a stable order. */
export function listThemes(): Theme[] {
  return [...themes.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function hasTheme(themeId: string): boolean {
  return themes.has(themeId);
}

export function loadTheme(themeId: string): Theme {
  const theme = themes.get(themeId);
  if (!theme) throw new Error(`Unknown theme "${themeId}"`);
  return theme;
}

export { formatMessage, renderNoun, type MessageParams } from './format';
export type { Theme } from './types';
