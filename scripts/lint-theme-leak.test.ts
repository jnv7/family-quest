import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findLeaks } from './lint-theme-leak';

const terms = JSON.parse(readFileSync('scripts/theme-leak-terms.json', 'utf8')) as Record<string, string[]>;
const fixtures = 'scripts/fixtures/theme-leak';

describe('lint-theme-leak', () => {
  it('passes on the repository', () => {
    expect(findLeaks('.', terms)).toEqual([]);
  });

  it('reports file, line and term, ignoring case', () => {
    expect(findLeaks(`${fixtures}/leak`, terms)).toContainEqual({ file: 'src/ui/screen.ts', line: 2, term: 'pirate' });
  });

  it('handles Portuguese accents and capital letters', () => {
    const leaks = findLeaks(`${fixtures}/leak`, terms);
    expect(leaks).toContainEqual({ file: 'src/ui/accents.ts', line: 1, term: 'tripulação' });
    expect(leaks).toContainEqual({ file: 'src/ui/accents.ts', line: 2, term: 'baús' });
  });

  it('matches whole words only, and skips src/themes/', () => {
    expect(findLeaks(`${fixtures}/clean`, terms)).toEqual([]);
  });
});
