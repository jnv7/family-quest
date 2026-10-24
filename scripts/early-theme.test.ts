// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { earlyThemeData, earlyThemeScript } from './early-theme';

const data = earlyThemeData({ base: '/family-quest/', themesDir: 'src/themes', installName: 'Family Quest', themeColor: '#1f2a44' });

/** Runs the inline script the way the browser does: against the page, the address and the storage. */
function run(options: { search?: string; hash?: string; storage?: Record<string, string> | 'broken'; ios?: boolean }) {
  const storage = options.storage;
  const localStorage =
    storage === 'broken'
      ? { getItem: () => { throw new Error('blocked'); } }
      : { getItem: (key: string) => (storage ?? {})[key] ?? null };
  const navigator = { userAgent: options.ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' : 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux', maxTouchPoints: 5 };
  new Function('document', 'location', 'localStorage', 'navigator', earlyThemeScript(data))(document, { search: options.search ?? '', hash: options.hash ?? '' }, localStorage, navigator);
  const attr = (selector: string, name: string) => document.head.querySelector(selector)?.getAttribute(name);
  return {
    title: document.title,
    iosTitle: attr('meta[name="apple-mobile-web-app-title"]', 'content'),
    color: attr('meta[name="theme-color"]', 'content'),
    manifest: attr('link[rel="manifest"]', 'href'),
    icon: attr('link[rel="apple-touch-icon"]', 'href'),
  };
}

beforeEach(() => {
  document.head.replaceChildren();
  document.title = '';
});

const WORLD = 'a'.repeat(24);

describe('the early theme script', () => {
  it('keeps the generic page at the bare address', () => {
    expect(run({})).toEqual({
      title: 'Family Quest',
      iosTitle: 'Family Quest',
      color: '#1f2a44',
      manifest: '/family-quest/manifest.webmanifest',
      icon: '/family-quest/icons/apple-touch-icon.png',
    });
  });

  it('names the page after the installed app of the theme in the launch address', () => {
    const page = run({ search: '?theme=pirates' });
    expect(page).toMatchObject({ title: data.themes['pirates']!.name, iosTitle: data.themes['pirates']!.name });
    expect(page.manifest).toBe('/family-quest/manifest-pirates.webmanifest');
    expect(page.icon).toBe('/family-quest/themes/pirates/apple-touch-icon.png');
    expect(page.color).toBe(data.themes['pirates']!.themeColor);
  });

  it('takes the theme of a join link, and of the world this device remembers', () => {
    expect(run({ hash: `#/join/${WORLD}/minimal-farm` }).manifest).toBe('/family-quest/manifest-minimal-farm.webmanifest');
    document.head.replaceChildren();
    expect(run({ storage: { 'familyQuest.worldId': WORLD, 'familyQuest.themeId': 'minimal' } }).manifest).toBe('/family-quest/manifest-minimal.webmanifest');
  });

  it('does not use a remembered theme without its world, an unknown theme, or unreadable storage', () => {
    for (const options of [
      { storage: { 'familyQuest.themeId': 'pirates' } },
      { search: '?theme=nothing-like-it' },
      { hash: `#/join/${WORLD}/__proto__` },
      { storage: 'broken' as const },
    ]) {
      document.head.replaceChildren();
      expect(run(options).manifest, JSON.stringify(options)).toBe('/family-quest/manifest.webmanifest');
    }
  });

  it('writes no manifest on an iPhone, so a home screen app starts at the address it was added from', () => {
    const page = run({ search: '?theme=pirates', ios: true });
    expect(page.manifest).toBeUndefined();
    expect(page).toMatchObject({ title: 'Ilha dos Piratas', iosTitle: 'Ilha dos Piratas', icon: '/family-quest/themes/pirates/apple-touch-icon.png' });
  });

  it('calls the pirate app "Ilha dos Piratas"', () => {
    expect(data.themes['pirates']!.name).toBe('Ilha dos Piratas');
  });
});
