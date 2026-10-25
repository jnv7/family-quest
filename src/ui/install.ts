/** Offering the installation of the app (ADR 0005). */

export interface Platform {
  /** iPhone or iPad: there is no install API, so the person is shown how. */
  isIos: boolean;
  /** An Android phone or tablet. */
  isAndroid: boolean;
  /** Running as an installed app, not in a browser tab. */
  isStandalone: boolean;
}

export type InstallMode =
  /** Already installed: nothing to offer. */
  | 'installed'
  /** The browser can show its own install dialog (Android, desktop Chrome). */
  | 'prompt'
  /** iOS in a browser: show the steps (Share → Add to Home Screen). */
  | 'ios'
  /** Android in a browser that has not offered its dialog (yet): show the steps of the browser's menu. */
  | 'android'
  /** Nothing can be offered here. */
  | 'none';

export interface Installer {
  platform: Platform;
  mode(): InstallMode;
  /** Shows the browser's install dialog; only valid in `prompt` mode. */
  prompt(): Promise<void>;
  onChange(listener: () => void): () => void;
}

/** The event Chrome fires when the app can be installed; not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function detectPlatform(win: Window): Platform {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  const isIpadOs = nav.platform === 'MacIntel' && nav.maxTouchPoints > 1; // iPadOS reports itself as a Mac
  return {
    isIos: /iPhone|iPad|iPod/.test(nav.userAgent) || isIpadOs,
    isAndroid: /Android/.test(nav.userAgent),
    isStandalone: nav.standalone === true || win.matchMedia?.('(display-mode: standalone)').matches === true,
  };
}

/**
 * Listens for the browser's install event as soon as it is created, because the
 * event can fire before any screen exists. Create it once, at start-up.
 */
export function createInstaller(win: Window): Installer {
  const platform = detectPlatform(win);
  const listeners = new Set<() => void>();
  let deferred: BeforeInstallPromptEvent | null = null;
  let installed = platform.isStandalone;
  const changed = () => listeners.forEach((listener) => listener());

  win.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep it for our own button
    deferred = event as BeforeInstallPromptEvent;
    changed();
  });
  win.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    changed();
  });

  return {
    platform,
    mode() {
      if (installed) return 'installed';
      if (deferred) return 'prompt';
      if (platform.isIos) return 'ios';
      return platform.isAndroid ? 'android' : 'none';
    },
    async prompt() {
      const event = deferred;
      if (!event) return;
      deferred = null; // an event can be used once
      await event.prompt();
      await event.userChoice;
      changed();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
