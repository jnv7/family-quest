import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createBuild, versionFile } from './scripts/build-info.ts';
import { createManifest } from './scripts/pwa-manifest.ts';
import { themeManifests } from './scripts/theme-manifests.ts';

const build = createBuild({ packageJson: 'package.json' });
const { messages } = JSON.parse(readFileSync('src/i18n/pt-PT.json', 'utf8')) as { messages: Record<string, string> };
const installName = messages['app.installName'];
const installDescription = messages['app.installDescription'];
if (!installName || !installDescription) throw new Error('Missing "app.installName" or "app.installDescription" in src/i18n/pt-PT.json');

// GitHub Pages serves the app under /family-quest/ (docs/architecture.md §7).
const BASE = '/family-quest/';

/** The name iOS shows under the home screen icon; its text comes from the locale file like every other. */
const iosTitle: Plugin = {
  name: 'family-quest:ios-title',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: installName }, injectTo: 'head' }],
};

export default defineConfig({
  base: BASE,
  define: { __APP_BUILD__: JSON.stringify(build) },
  plugins: [
    iosTitle,
    versionFile(build),
    themeManifests({ base: BASE, themesDir: 'src/themes', description: installDescription }),
    VitePWA({
      // The new version takes over as soon as it is installed. The page in use is not reloaded.
      registerType: 'autoUpdate',
      injectRegister: 'script',
      manifest: createManifest({ base: BASE, installName, description: installDescription }),
      workbox: {
        // The app shell and the bundled themes. Firestore and Auth are other origins: never cached here.
        // `json` is left out on purpose: `version.json` must always come from the network (ADR 0012).
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
