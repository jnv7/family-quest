import { defineConfig } from 'vitest/config';

// Firestore rules tests. Run through `npm run test:rules`, which starts the emulator.
export default defineConfig({
  test: {
    include: ['firebase/tests/**/*.test.ts'],
    // In CI, failures also appear as annotations on the commit.
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
