// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createInstaller, detectPlatform } from './install';

function fakeWindow(userAgent: string, extra: Record<string, unknown> = {}, standalone = false): Window {
  const listeners = new Map<string, Array<(event: Event) => void>>();
  return {
    navigator: { userAgent, platform: 'Linux', maxTouchPoints: 5, ...extra },
    matchMedia: () => ({ matches: standalone }),
    addEventListener: (type: string, listener: (event: Event) => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    dispatch: (type: string, event: Event) => listeners.get(type)?.forEach((listener) => listener(event)),
  } as unknown as Window;
}

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/130 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130 Safari/537.36';

describe('detectPlatform', () => {
  it('knows Android, iPhone and the rest', () => {
    expect(detectPlatform(fakeWindow(ANDROID))).toMatchObject({ isAndroid: true, isIos: false });
    expect(detectPlatform(fakeWindow(IPHONE))).toMatchObject({ isAndroid: false, isIos: true });
    expect(detectPlatform(fakeWindow(DESKTOP))).toMatchObject({ isAndroid: false, isIos: false });
  });

  it('knows an installed app', () => {
    expect(detectPlatform(fakeWindow(ANDROID, {}, true)).isStandalone).toBe(true);
    expect(detectPlatform(fakeWindow(IPHONE, { standalone: true })).isStandalone).toBe(true);
  });
});

describe('Installer.mode', () => {
  it('is android on Android until the browser offers its dialog, then prompt', () => {
    const win = fakeWindow(ANDROID) as Window & { dispatch(type: string, event: Event): void };
    const installer = createInstaller(win);
    expect(installer.mode()).toBe('android');
    win.dispatch('beforeinstallprompt', Object.assign(new Event('beforeinstallprompt'), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) }));
    expect(installer.mode()).toBe('prompt');
    win.dispatch('appinstalled', new Event('appinstalled'));
    expect(installer.mode()).toBe('installed');
  });

  it('is ios on iPhone, installed when standalone, and none elsewhere', () => {
    expect(createInstaller(fakeWindow(IPHONE)).mode()).toBe('ios');
    expect(createInstaller(fakeWindow(ANDROID, {}, true)).mode()).toBe('installed');
    expect(createInstaller(fakeWindow(DESKTOP)).mode()).toBe('none');
  });
});
