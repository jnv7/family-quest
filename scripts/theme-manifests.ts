/**
 * One web app manifest per theme (ADR 0005): the installed app's name and icon
 * follow the world's theme. Generated at build time from each `theme.json`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { INSTALL_ICONS, installIconPath, manifestPath, type InstallIcon } from '../src/theme/installPaths.ts';

interface ThemeInstall {
  id: string;
  install: {
    name: string;
    themeColor: string;
    backgroundColor: string;
    icons: Record<InstallIcon, { image: string }>;
  };
}

const ICON_SIZES: Record<InstallIcon, { sizes: string; purpose: string }> = {
  small: { sizes: '192x192', purpose: 'any' },
  large: { sizes: '512x512', purpose: 'any' },
  maskable: { sizes: '512x512', purpose: 'maskable' },
  apple: { sizes: '180x180', purpose: 'any' },
};

/**
 * The manifest of a theme. It has its own `id`, so each theme installs as its
 * own app, and it starts on `?theme=<id>`, so the installed app looks right from
 * its first frame, before it knows any world. A manifest without `start_url` was
 * tried, to let the installed app start on the join link, but Chrome refuses to
 * install it (`start-url-not-valid`); the "paste" button covers joining (ADR 0005).
 */
export function buildThemeManifest(theme: ThemeInstall, options: { base: string; description: string }) {
  const { base, description } = options;
  const { install } = theme;
  return {
    id: `${base}themes/${theme.id}`,
    name: install.name,
    short_name: install.name,
    description,
    lang: 'pt-PT',
    start_url: `${base}?theme=${theme.id}`,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    theme_color: install.themeColor,
    background_color: install.backgroundColor,
    // The iOS icon is declared in the page (`apple-touch-icon`), not in the manifest.
    icons: INSTALL_ICONS.filter((icon) => icon !== 'apple').map((icon) => ({
      src: installIconPath(theme.id, icon),
      type: 'image/png',
      ...ICON_SIZES[icon],
    })),
  };
}

/** The themes under `themesDir` that have a `theme.json`; other folders are skipped. */
export function readThemes(themesDir: string): Array<{ dir: string; theme: ThemeInstall }> {
  return readdirSync(themesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(themesDir, entry.name, 'theme.json')))
    .map((entry) => {
      const dir = join(themesDir, entry.name);
      return { dir, theme: JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8')) as ThemeInstall };
    });
}

/** Emits `manifest-{themeId}.webmanifest` and the theme's icons into the build. */
export function themeManifests(options: { base: string; themesDir: string; description: string }): Plugin {
  return {
    name: 'family-quest:theme-manifests',
    generateBundle() {
      for (const { dir, theme } of readThemes(options.themesDir)) {
        for (const icon of INSTALL_ICONS) {
          this.emitFile({
            type: 'asset',
            fileName: installIconPath(theme.id, icon),
            source: readFileSync(join(dir, theme.install.icons[icon].image)),
          });
        }
        this.emitFile({
          type: 'asset',
          fileName: manifestPath(theme.id),
          source: JSON.stringify(buildThemeManifest(theme, options)),
        });
      }
    },
  };
}
