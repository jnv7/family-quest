import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createManifest, MANIFEST_ICONS } from './pwa-manifest';

const locale = JSON.parse(readFileSync('src/i18n/pt-PT.json', 'utf8')) as { messages: Record<string, string> };
const manifest = createManifest({
  base: '/family-quest/',
  installName: locale.messages['app.installName']!,
  description: locale.messages['app.installDescription']!,
});

describe('createManifest', () => {
  it('makes the app installable as a standalone app under its base path', () => {
    expect(manifest).toMatchObject({
      display: 'standalone',
      start_url: '/family-quest/',
      scope: '/family-quest/',
      id: '/family-quest/',
      lang: 'pt-PT',
    });
  });

  it('takes its name from the locale file', () => {
    expect(locale.messages['app.installName']).toBeTruthy();
    expect(manifest.name).toBe(locale.messages['app.installName']);
    expect(manifest.short_name).toBe(manifest.name);
    expect(locale.messages['app.installDescription']).toBeTruthy();
    expect(manifest.description).toBe(locale.messages['app.installDescription']);
  });

  it('declares icons that exist, including a maskable one', () => {
    for (const icon of MANIFEST_ICONS) expect(existsSync(`public/${icon.src}`), icon.src).toBe(true);
    expect(manifest.icons?.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(manifest.icons?.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(manifest.icons?.some((i) => i.sizes === '192x192')).toBe(true);
  });

  it('has the iOS home-screen icon', () => {
    expect(existsSync('public/icons/apple-touch-icon.png')).toBe(true);
  });
});
