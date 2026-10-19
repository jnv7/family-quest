/**
 * Where the build puts each theme's installable files. Shared by the build
 * (`scripts/theme-manifests.ts`) and the running app, so it has no imports.
 */
export type InstallIcon = 'small' | 'large' | 'maskable' | 'apple';

const ICON_FILES: Record<InstallIcon, string> = {
  small: 'icon-192.png',
  large: 'icon-512.png',
  maskable: 'icon-maskable-512.png',
  apple: 'apple-touch-icon.png',
};

export const INSTALL_ICONS = Object.keys(ICON_FILES) as InstallIcon[];

/** Path of a theme's web app manifest, relative to the app's base. */
export function manifestPath(themeId: string): string {
  return `manifest-${themeId}.webmanifest`;
}

/** Path of one of a theme's installable icons, relative to the app's base. */
export function installIconPath(themeId: string, icon: InstallIcon): string {
  return `themes/${themeId}/${ICON_FILES[icon]}`;
}
