import { installIconPath, manifestPath } from '../theme/installPaths';
import type { Theme } from '../theme/types';

function link(doc: Document, rel: string): HTMLLinkElement {
  let element = doc.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = doc.createElement('link');
    element.rel = rel;
    doc.head.append(element);
  }
  return element;
}

function meta(doc: Document, name: string): HTMLMetaElement {
  let element = doc.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!element) {
    element = doc.createElement('meta');
    element.name = name;
    doc.head.append(element);
  }
  return element;
}

/**
 * Makes the page look like the theme: the title (the name the installed app has), the manifest and icon an
 * installation would use, and the colours. Called once the theme is known (from
 * a join link, the choice when creating a world, or the world itself), never
 * from the bare address, so the app is never installed with the wrong name.
 * iOS never updates an installed icon, hence this has to happen before installing.
 * `assetBase` is the app's base path, such as `/family-quest/`. `options.manifest` is false on iOS.
 */
export function applyThemeToPage(doc: Document, theme: Theme, assetBase: string, options: { manifest?: boolean } = {}): void {
  doc.title = theme.install.name;
  // An iPhone's home screen app starts at the address it was added from only without a manifest (ADR 0014).
  if (options.manifest ?? true) link(doc, 'manifest').href = `${assetBase}${manifestPath(theme.id)}`;
  link(doc, 'apple-touch-icon').href = `${assetBase}${installIconPath(theme.id, 'apple')}`;
  meta(doc, 'apple-mobile-web-app-title').content = theme.install.name;
  meta(doc, 'theme-color').content = theme.install.themeColor;
}
