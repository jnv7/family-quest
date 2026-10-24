/** The build identity (ADR 0012 §1): computed once per build, injected into the code and published as `version.json`. */
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import type { Build } from '../src/core/build.ts';

export function createBuild(options: { packageJson: string; env?: Record<string, string | undefined>; now?: () => number }): Build {
  const { version } = JSON.parse(readFileSync(options.packageJson, 'utf8')) as { version: string };
  const sha = (options.env ?? process.env).GITHUB_SHA;
  return { version, builtAt: (options.now ?? Date.now)(), commit: sha ? sha.slice(0, 7) : 'local' };
}

/**
 * Writes `version.json` next to the app. It is a plain file the app reads without any cache; it must
 * never enter the service worker's precache, whose `globPatterns` therefore leave `json` out.
 */
export function versionFile(build: Build): Plugin {
  return {
    name: 'family-quest:version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build) });
    },
  };
}
