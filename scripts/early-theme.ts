/**
 * The page looks like its theme from the first paint (ADR 0013). Browsers, and iOS above all, read the name and
 * icon of an installed app from the page as it was parsed, so a script that runs only once the app has loaded can
 * be too late. A tiny inline script at the very start of `<head>` therefore picks the theme from what is already
 * known (the address, or the remembered world) and writes the title, the manifest, the icon and the colour, before
 * anything else in the page. `applyThemeToPage` keeps them right afterwards, when the theme becomes known later.
 */
import type { Plugin } from 'vite';
import { installIconPath, manifestPath } from '../src/theme/installPaths.ts';
import { readThemes } from './theme-manifests.ts';

export interface EarlyPage {
  name: string;
  themeColor: string;
  manifest: string;
  appleIcon: string;
}

export interface EarlyThemeData {
  /** What the page is before any theme is known: the generic app. */
  generic: EarlyPage;
  /** Per theme id. */
  themes: Record<string, EarlyPage>;
}

export interface EarlyThemeOptions {
  base: string;
  themesDir: string;
  installName: string;
  themeColor: string;
}

export function earlyThemeData(options: EarlyThemeOptions): EarlyThemeData {
  const { base, themesDir, installName, themeColor } = options;
  const themes: Record<string, EarlyPage> = {};
  for (const { theme } of readThemes(themesDir)) {
    themes[theme.id] = {
      name: theme.install.name,
      themeColor: theme.install.themeColor,
      manifest: `${base}${manifestPath(theme.id)}`,
      appleIcon: `${base}${installIconPath(theme.id, 'apple')}`,
    };
  }
  return {
    generic: { name: installName, themeColor, manifest: `${base}manifest.webmanifest`, appleIcon: `${base}icons/apple-touch-icon.png` },
    themes,
  };
}

/**
 * The classic script, as text. A theme is known early only from places that already say so (ADR 0005): the launch
 * address of an installed app (`?theme=`), a join link (`#/join/<world>/<theme>`), or the world this device
 * remembers (its theme is remembered with it). Anything unknown, or any failure, leaves the generic page.
 */
export function earlyThemeScript(data: EarlyThemeData): string {
  return `(function(d,data){
var page=data.generic;
try{
var id=null,m=/[?&]theme=([a-z][a-z0-9-]*)/.exec(location.search);
if(m)id=m[1];
if(!id){m=/#\\/join\\/[A-Za-z0-9]+\\/([a-z][a-z0-9-]*)/.exec(location.hash);if(m)id=m[1]}
if(!id){try{if(localStorage.getItem('familyQuest.worldId'))id=localStorage.getItem('familyQuest.themeId')}catch(e){}}
if(id&&Object.prototype.hasOwnProperty.call(data.themes,id))page=data.themes[id];
}catch(e){}
d.title=page.name;
function put(tag,key,value,attrs){var e=d.createElement(tag);for(var k in attrs)e.setAttribute(k,attrs[k]);e.setAttribute(key,value);d.head.appendChild(e)}
put('meta','content',page.name,{name:'apple-mobile-web-app-title'});
put('meta','content',page.themeColor,{name:'theme-color'});
put('link','href',page.manifest,{rel:'manifest'});
put('link','href',page.appleIcon,{rel:'apple-touch-icon'});
})(document,${JSON.stringify(data)});`;
}

/** Puts the script first in `<head>`, and takes out the generic tags it replaces. */
export function earlyTheme(options: EarlyThemeOptions): Plugin[] {
  const source = earlyThemeScript(earlyThemeData(options));
  return [
    {
      name: 'family-quest:early-theme',
      transformIndexHtml: () => [{ tag: 'script', children: source, injectTo: 'head-prepend' }],
    },
    {
      // The PWA plugin adds a generic manifest link to the page; the script above writes the right one instead.
      name: 'family-quest:no-static-manifest-link',
      enforce: 'post', // like the PWA plugin, and listed after it, so it runs after it
      transformIndexHtml: { order: 'post', handler: (html: string) => html.replace(/<link rel="manifest"[^>]*>/g, '') },
    },
  ];
}
