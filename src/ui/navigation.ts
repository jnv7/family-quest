/** Where the current route lives. The app talks to this instead of `location`, so tests can run several devices. */
export interface Navigation {
  /** The current hash, such as `#/board`. */
  hash(): string;
  /** Goes to a hash, keeping history. Listeners are told asynchronously, like `hashchange`. */
  push(hash: string): void;
  /** Goes to a hash without adding to history. Listeners are not told. */
  replace(hash: string): void;
  onChange(listener: () => void): () => void;
}

/** The browser's address bar. */
export function browserNavigation(): Navigation {
  return {
    hash: () => location.hash,
    push: (hash) => {
      location.hash = hash;
    },
    replace: (hash) => history.replaceState(null, '', hash),
    onChange(listener) {
      window.addEventListener('hashchange', listener);
      return () => window.removeEventListener('hashchange', listener);
    },
  };
}

/** A private address bar for one device in a test. */
export function memoryNavigation(initialHash = ''): Navigation {
  let current = initialHash;
  const listeners = new Set<() => void>();
  return {
    hash: () => current,
    push(hash) {
      if (hash === current) return;
      current = hash;
      queueMicrotask(() => listeners.forEach((listener) => listener()));
    },
    replace(hash) {
      current = hash;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
