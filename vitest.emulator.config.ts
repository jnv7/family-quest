import { defineConfig } from 'vitest/config';

// Adapter tests against the Firestore and Auth emulators. Run through `npm run test:emulator`.
export default defineConfig({
  test: {
    include: ['src/**/*.emulator.test.ts'],
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
