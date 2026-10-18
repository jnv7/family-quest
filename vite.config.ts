import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

// GitHub Pages serves the app under /family-quest/ (docs/architecture.md §7).
export default defineConfig({
  base: '/family-quest/',
  define: { __APP_VERSION__: JSON.stringify(version) },
});
