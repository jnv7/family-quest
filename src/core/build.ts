import type { Millis } from './model';

/** What one build of the app is, written at build time (ADR 0012 §1). */
export interface Build {
  /** The `version` of `package.json`. */
  version: string;
  /** When the build was made. */
  builtAt: Millis;
  /** The short commit id, or `local` outside CI. */
  commit: string;
}

/** Whether `published` is a build made after the running one, so an older file (a cache in between) never offers to go back. */
export function isNewerBuild(running: Build, published: Build): boolean {
  return published.builtAt > running.builtAt;
}
