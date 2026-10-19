/**
 * The web app manifest of the installed app. Its visible text, the name under
 * the icon and the description, comes from the locale file (CONTRIBUTING.md, Language), so the
 * caller passes it in. Run from `vite.config.ts`, hence no other imports.
 */
import type { ManifestOptions } from 'vite-plugin-pwa';

/** Icons are generated from `public/icons/icon.svg`; see `public/icons/README.md`. */
export const MANIFEST_ICONS = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
] as const;

export const THEME_COLOR = '#1f2a44';
export const BACKGROUND_COLOR = '#ffffff';

export function createManifest(options: { base: string; installName: string; description: string }): Partial<ManifestOptions> {
  const { base, installName, description } = options;
  return {
    id: base,
    name: installName,
    short_name: installName,
    description,
    lang: 'pt-PT',
    start_url: base,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    theme_color: THEME_COLOR,
    background_color: BACKGROUND_COLOR,
    icons: MANIFEST_ICONS.map((icon) => ({ ...icon })),
  };
}
