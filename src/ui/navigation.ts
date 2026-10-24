/** Where the current route lives. The app talks to this instead of `location`, so tests can run several devices. */
export interface Navigation {
  /** The current hash, such as `#/board`. */
  hash(): string;
  /** Goes to a hash, keeping history. Listeners are told asynchronously, like `hashchange`. */
  push(hash: string): void;
  /** Goes to a hash without adding to history. Listeners are not told. */
  replace(hash: string): void;
  onChange(listener: () => void): () => void;
  /**
   * Adds a history entry for an overlay on the current screen, so the system back gesture closes the
   * overlay instead of leaving the screen. `onBack` runs when the person goes back.
   *
   * The returned function ends the overlay from the app and removes the entry, without calling `onBack`.
   * With `keepEntry` the entry stays in history instead: the next `replace` turns it into the screen the
   * person is going to, so back from there returns to the screen under the overlay in one step.
   */
  pushOverlay(onBack: () => void): (options?: { keepEntry?: boolean }) => void;
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
    pushOverlay(onBack) {
      // The hash stays the same, so `hashchange` never fires and the screen is not drawn again.
      history.pushState({ overlay: true }, '', location.hash);
      const onPop = () => {
        window.removeEventListener('popstate', onPop);
        onBack();
      };
      window.addEventListener('popstate', onPop);
      return ({ keepEntry = false } = {}) => {
        window.removeEventListener('popstate', onPop); // before going back, so our own `back()` is not mistaken for the person's
        if (!keepEntry) history.back();
      };
    },
  };
}

/** A private address bar for one device in a test, with a test-only `back()` for the back gesture. */
export function memoryNavigation(initialHash = ''): Navigation & { back(): void } {
  interface Entry {
    hash: string;
    onBack?: (() => void) | undefined;
  }
  const entries: Entry[] = [{ hash: initialHash }];
  const current = () => entries[entries.length - 1]!;
  const listeners = new Set<() => void>();
  const tell = () => queueMicrotask(() => listeners.forEach((listener) => listener()));
  return {
    hash: () => current().hash,
    push(hash) {
      if (hash === current().hash) return;
      entries.push({ hash });
      tell();
    },
    replace(hash) {
      entries[entries.length - 1] = { hash };
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pushOverlay(onBack) {
      const entry: Entry = { hash: current().hash, onBack };
      entries.push(entry);
      return ({ keepEntry = false } = {}) => {
        entry.onBack = undefined;
        const index = entries.indexOf(entry);
        if (!keepEntry && index >= 0) entries.splice(index, 1);
      };
    },
    back() {
      if (entries.length === 1) return;
      const left = entries.pop()!;
      if (left.onBack) left.onBack();
      else tell();
    },
  };
}
