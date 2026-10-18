import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests: pure domain and in-memory adapter. No emulator, no network.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.emulator.test.ts'],
    // In CI, failures also appear as annotations on the commit.
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  },
});
