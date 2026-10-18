import { describe, expect, it } from 'vitest';
import { findViolations } from './lint-imports';

describe('lint-imports', () => {
  it('reports a firebase import outside the Firestore adapter, with file and line', () => {
    expect(findViolations('scripts/fixtures/imports-leak')).toEqual([
      {
        file: 'src/ui/screen.ts',
        line: 1,
        text: "import { getFirestore } from 'firebase/firestore';",
      },
    ]);
  });

  it('accepts firebase imports inside the Firestore adapter only', () => {
    expect(findViolations('scripts/fixtures/imports-ok')).toEqual([]);
  });

  it('passes on the repository', () => {
    expect(findViolations('.')).toEqual([]);
  });
});
