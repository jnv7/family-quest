import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildThemeManifest, readThemes } from './theme-manifests';

const options = { base: '/family-quest/', description: 'Descrição' };
const themes = readThemes('src/themes');

describe('theme manifests', () => {
  it('finds the themes that have a theme.json, and skips the empty folder', () => {
    expect(themes.map((t) => t.theme.id).sort()).toEqual(['minimal', 'minimal-farm']);
  });

  it('gives every theme its own id, name, colours and icons', () => {
    const manifests = themes.map(({ theme }) => buildThemeManifest(theme, options));
    expect(new Set(manifests.map((m) => m.id)).size).toBe(manifests.length);
    expect(new Set(manifests.map((m) => m.name)).size).toBe(manifests.length);
    for (const m of manifests) {
      expect(m).toMatchObject({ display: 'standalone', scope: '/family-quest/', lang: 'pt-PT' });
      expect(m.icons.map((i) => i.purpose).sort()).toEqual(['any', 'any', 'maskable']);
    }
  });

  it('takes the name and colours from the theme', () => {
    const farm = themes.find((t) => t.theme.id === 'minimal-farm')!;
    const manifest = buildThemeManifest(farm.theme, options);
    expect(manifest.name).toBe(farm.theme.install.name);
    expect(manifest.theme_color).toBe(farm.theme.install.themeColor);
    expect(manifest.icons[0]?.src).toBe('themes/minimal-farm/icon-192.png');
  });

  it('starts on the base path with the theme in the query, always inside its scope', () => {
    for (const { theme } of themes) {
      const manifest = buildThemeManifest(theme, options);
      expect(manifest.start_url).toBe(`/family-quest/?theme=${theme.id}`);
      expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    }
  });

  it('has every icon file on disk', () => {
    for (const { dir, theme } of themes) {
      for (const icon of Object.values(theme.install.icons)) expect(existsSync(`${dir}/${icon.image}`), icon.image).toBe(true);
    }
    expect(readFileSync('src/themes/minimal/theme.json', 'utf8')).toContain('"install"');
  });
});
