import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateCredits } from './credits';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('CREDITS.md', () => {
  it('is up to date with the credits of every validated theme', () => {
    const themes = JSON.parse(readFileSync('scripts/validated-themes.json', 'utf8')) as string[];
    expect(readFileSync('CREDITS.md', 'utf8')).toBe(generateCredits(themes));
  });

  it('groups by theme and by author, links the licence text, and sorts files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'family-quest-credits-'));
    created.push(dir);
    cpSync('src/themes/minimal', join(dir, 'minimal'), { recursive: true });
    writeFileSync(
      join(dir, 'minimal', 'credits.json'),
      JSON.stringify({
        assets: [
          { file: 'assets/b.webp', author: 'Zed', source: 'https://example.com/z', licence: 'CC0-1.0' },
          { file: 'assets/a.webp', author: 'Zed', source: 'https://example.com/z', licence: 'CC0-1.0' },
          { file: 'assets/c.webp', author: 'Alma', source: 'https://example.com/a', licence: 'MIT' },
        ],
      }),
    );
    const text = generateCredits(['minimal'], dir);
    expect(text.indexOf('### Alma')).toBeLessThan(text.indexOf('### Zed'));
    expect(text.indexOf('assets/a.webp')).toBeLessThan(text.indexOf('assets/b.webp'));
    expect(text).toContain('[CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)');
    expect(text).toContain('[MIT](https://opensource.org/license/mit)');
  });
});
