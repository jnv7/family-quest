import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests: pure domain and in-memory adapter. No emulator, no network.
export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify({ version: 'test', builtAt: Date.parse('2026-10-24T12:00:00Z'), commit: 'test' }) },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.emulator.test.ts'],
    // In CI, failures also appear as annotations on the commit.
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  },
});
